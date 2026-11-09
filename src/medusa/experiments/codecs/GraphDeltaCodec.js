'use strict';

/**
 * Approach D — Shared State with Graph-Delta Communication Codec (`graph-delta-v1`).
 *
 * Maintains an authoritative, versioned `SharedGraphStore` (`version`, `digest`, `nodes`, `edges`, `history`)
 * and transmits only incremental deltas (`upsertNodes`, `removeNodes`, `upsertEdges`, `removeEdges`)
 * between state versions (`baseVersion` -> `targetVersion`).
 *
 * Supports:
 * - Node/edge deduplication across multi-turn conversations (shared agents, issues, PRs, files, constraints,
 *   and sharedContext are transmitted once and omitted when unchanged on subsequent turns).
 * - Optimistic concurrency conflict detection (`VERSION_CONFLICT`, `BASE_DIGEST_MISMATCH`).
 * - Missed-event detection (`MISSING_BASE_VERSION`) and deterministic recovery via snapshot or delta replay.
 */

const crypto = require('crypto');
const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');
const { messageToGraph, graphToMessage } = require('./GraphCodec');

/**
 * Computes a deterministic key for an edge (or compact `[from, rel, to, order?]` tuple).
 *
 * @param {object|Array} edge - Graph edge `{from, to, rel}` or `[from, rel, to]`.
 * @returns {string}
 */
function edgeKey(edge) {
  if (Array.isArray(edge)) {
    return `${edge[0]}|${edge[1]}|${edge[2]}`;
  }
  return `${edge.from}|${edge.rel}|${edge.to}`;
}

/**
 * Converts a full edge `{from, to, rel, attrs}` to a compact tuple `[from, rel, to, order?]` for delta transport.
 *
 * @param {object} edge - Graph edge object.
 * @returns {Array}
 */
function toCompactEdge(edge) {
  if (edge.attrs && edge.attrs.order !== undefined) {
    return [edge.from, edge.rel, edge.to, edge.attrs.order];
  }
  return [edge.from, edge.rel, edge.to];
}

/**
 * Expands a compact tuple `[from, rel, to, order?]` back into a graph edge object `{from, to, rel, attrs?}`.
 *
 * @param {Array|object} item - Compact edge tuple or object.
 * @returns {object}
 */
function fromCompactEdge(item) {
  if (!Array.isArray(item)) return item;
  const edge = { from: item[0], to: item[2], rel: item[1] };
  if (item.length > 3 && item[3] !== undefined) {
    edge.attrs = { order: item[3] };
  }
  return edge;
}

/**
 * Versioned in-memory property graph state store for `GraphDeltaCodec`.
 */
class SharedGraphStore {
  /**
   * Initializes an empty shared graph store at version 0.
   */
  constructor() {
    this.version = 0;
    this.nodes = new Map();
    this.edges = new Map();
    this.deltaHistory = [];
  }

  /**
   * Creates a deep clone of this store (useful for simulating separate sender/receiver states or disconnects).
   *
   * @returns {SharedGraphStore}
   */
  clone() {
    const copy = new SharedGraphStore();
    copy.version = this.version;
    for (const [k, v] of this.nodes.entries()) {
      copy.nodes.set(k, JSON.parse(JSON.stringify(v)));
    }
    for (const [k, v] of this.edges.entries()) {
      copy.edges.set(k, JSON.parse(JSON.stringify(v)));
    }
    copy.deltaHistory = JSON.parse(JSON.stringify(this.deltaHistory));
    return copy;
  }

  /**
   * Computes a canonical 12-hex-char SHA-256 digest of the store's current nodes and edges.
   *
   * @returns {string}
   */
  computeDigest() {
    const sortedNodes = Array.from(this.nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
    const sortedEdges = Array.from(this.edges.values())
      .map(fromCompactEdge)
      .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ v: this.version, n: sortedNodes, e: sortedEdges }))
      .digest('hex')
      .slice(0, 12);
  }

  /**
   * Exports a full state snapshot for recovery after disconnect.
   *
   * @returns {{ version: number, digest: string, nodes: Array<object>, edges: Array<object> }}
   */
  exportSnapshot() {
    return {
      version: this.version,
      digest: this.computeDigest(),
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values())
    };
  }

  /**
   * Restores the store from a full state snapshot.
   *
   * @param {object} snapshot - Snapshot returned by `exportSnapshot()`.
   */
  importSnapshot(snapshot) {
    this.version = snapshot.version;
    this.nodes.clear();
    this.edges.clear();
    for (const n of snapshot.nodes || []) {
      this.nodes.set(n.id, JSON.parse(JSON.stringify(n)));
    }
    for (const rawE of snapshot.edges || []) {
      const e = fromCompactEdge(rawE);
      this.edges.set(edgeKey(e), JSON.parse(JSON.stringify(e)));
    }
  }

  /**
   * Computes and applies the minimal delta required to incorporate `subgraph` (`{rootId, nodes, edges}`).
   * Nodes and edges already present in `this.nodes` / `this.edges` with identical serialized JSON are omitted!
   *
   * @param {{ rootId: string, nodes: Array<object>, edges: Array<object> }} subgraph - Target message subgraph.
   * @param {{ removeNodeIds?: string[], removeEdgeKeys?: string[] }} [mutations={}] - Optional explicit removals.
   * @returns {object} Delta packet `{ baseVersion, targetVersion, baseDigest, targetDigest, rootId, upsertNodes, removeNodes, upsertEdges, removeEdges }`.
   */
  commitSubgraph(subgraph, mutations = {}) {
    const baseVersion = this.version;
    const baseDigest = this.computeDigest();

    const upsertNodes = [];
    const removeNodes = Array.isArray(mutations.removeNodeIds) ? [...mutations.removeNodeIds] : [];
    const upsertEdges = [];
    const removeEdges = Array.isArray(mutations.removeEdgeKeys) ? [...mutations.removeEdgeKeys] : [];

    for (const id of removeNodes) {
      this.nodes.delete(id);
    }
    for (const k of removeEdges) {
      this.edges.delete(k);
    }

    for (const node of subgraph.nodes) {
      const existing = this.nodes.get(node.id);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(node)) {
        const cloned = JSON.parse(JSON.stringify(node));
        this.nodes.set(node.id, cloned);
        upsertNodes.push(cloned);
      }
    }

    for (const edge of subgraph.edges) {
      const k = edgeKey(edge);
      const existing = this.edges.get(k);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(edge)) {
        const cloned = JSON.parse(JSON.stringify(edge));
        this.edges.set(k, cloned);
        const targetField = edge.from === subgraph.rootId ? edge.to : [edge.from, edge.to];
        upsertEdges.push(
          edge.attrs && edge.attrs.order !== undefined
            ? [edge.rel, targetField, edge.attrs.order]
            : [edge.rel, targetField]
        );
      }
    }

    this.version += 1;
    const targetVersion = this.version;
    const targetDigest = this.computeDigest();

    const delta = {
      v: 1,
      bv: baseVersion,
      tv: targetVersion,
      bd: baseDigest,
      td: targetDigest,
      r: subgraph.rootId,
      un: upsertNodes,
      ...(removeNodes.length > 0 ? { rn: removeNodes } : {}),
      ue: upsertEdges,
      ...(removeEdges.length > 0 ? { re: removeEdges } : {})
    };

    this.deltaHistory.push(JSON.parse(JSON.stringify(delta)));
    return delta;
  }

  /**
   * Applies an incoming delta packet to this store, verifying version continuity, base digest,
   * and concurrent modification conflicts.
   *
   * @param {object} delta - Incoming delta packet.
   * @returns {{ ok: boolean, code?: string, error?: string, warnings: string[] }}
   */
  applyDelta(delta) {
    const warnings = [];
    if (!delta || typeof delta !== 'object') {
      return { ok: false, code: 'INVALID_DELTA', error: 'Delta payload must be an object', warnings };
    }

    const baseVersion = delta.bv !== undefined ? delta.bv : delta.baseVersion;
    const targetVersion = delta.tv !== undefined ? delta.tv : delta.targetVersion;
    const baseDigest = delta.bd !== undefined ? delta.bd : delta.baseDigest;
    const targetDigest = delta.td !== undefined ? delta.td : delta.targetDigest;
    const removeNodes = delta.rn || delta.removeNodes;
    const removeEdges = delta.re || delta.removeEdges;
    const upsertNodes = delta.un || delta.upsertNodes;
    const upsertEdges = delta.ue || delta.upsertEdges;

    // 1. Check for missed intermediate updates (receiver is behind baseVersion)
    if (baseVersion > this.version) {
      return {
        ok: false,
        code: 'MISSING_BASE_VERSION',
        error: `Missed intermediate state updates: store is at v${this.version} but delta requires baseVersion v${baseVersion}`,
        warnings
      };
    }

    // 2. Check for concurrent conflicting writes (receiver already advanced to or past targetVersion with different state)
    if (baseVersion < this.version) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        error: `Concurrent state conflict: delta is based on stale v${baseVersion}, but store is already at v${this.version}`,
        warnings
      };
    }

    // 3. Verify baseDigest matches current store digest
    const currentDigest = this.computeDigest();
    if (baseDigest && baseDigest !== currentDigest) {
      return {
        ok: false,
        code: 'BASE_DIGEST_MISMATCH',
        error: `State divergence at v${this.version}: expected baseDigest "${baseDigest}" but store has "${currentDigest}"`,
        warnings
      };
    }

    // 4. Apply removals and upserts
    if (Array.isArray(removeNodes)) {
      for (const id of removeNodes) {
        this.nodes.delete(id);
      }
    }
    if (Array.isArray(removeEdges)) {
      for (const k of removeEdges) {
        this.edges.delete(k);
      }
    }
    if (Array.isArray(upsertNodes)) {
      for (const n of upsertNodes) {
        this.nodes.set(n.id, JSON.parse(JSON.stringify(n)));
      }
    }
    const rootId = delta.r || delta.rootId;
    if (Array.isArray(upsertEdges)) {
      for (const rawEdge of upsertEdges) {
        let e;
        if (Array.isArray(rawEdge) && (rawEdge.length === 2 || rawEdge.length === 3) && !rawEdge[0].includes(':')) {
          const rel = rawEdge[0];
          const from = Array.isArray(rawEdge[1]) ? rawEdge[1][0] : rootId;
          const to = Array.isArray(rawEdge[1]) ? rawEdge[1][1] : rawEdge[1];
          e = { from, to, rel };
          if (rawEdge.length === 3 && rawEdge[2] !== undefined) {
            e.attrs = { order: rawEdge[2] };
          }
        } else {
          e = fromCompactEdge(rawEdge);
        }
        this.edges.set(edgeKey(e), JSON.parse(JSON.stringify(e)));
      }
    }

    this.version = targetVersion;
    const postDigest = this.computeDigest();
    if (targetDigest && postDigest !== targetDigest) {
      return {
        ok: false,
        code: 'TARGET_DIGEST_MISMATCH',
        error: `Post-apply digest mismatch at v${this.version}: expected "${targetDigest}", computed "${postDigest}"`,
        warnings
      };
    }

    this.deltaHistory.push(JSON.parse(JSON.stringify(delta)));
    return { ok: true, warnings };
  }

  /**
   * Reconstructs the subgraph rooted at `rootId` from the store's accumulated state.
   *
   * @param {string} rootId - Root MessageEvent node ID.
   * @returns {{ rootId: string, nodes: Array<object>, edges: Array<object> }}
   */
  extractSubgraph(rootId) {
    const rootNode = this.nodes.get(rootId);
    if (!rootNode) {
      return { rootId, nodes: [], edges: [] };
    }

    const nodes = [rootNode];
    const seenNodeIds = new Set([rootId]);
    const edges = [];

    for (const edge of this.edges.values()) {
      if (edge.from === rootId) {
        edges.push(edge);
        const target = this.nodes.get(edge.to);
        if (target && !seenNodeIds.has(target.id)) {
          seenNodeIds.add(target.id);
          nodes.push(target);
        }
      }
    }

    return { rootId, nodes, edges };
  }
}

class GraphDeltaCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'graph-delta-v1',
      schemaVersion: '1.0.0',
      description: 'Versioned shared property graph transmitting only incremental node/edge deltas with digest verification',
      supportsDeltas: true,
      supportsArtifactRefs: true,
      requiresSharedState: true,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message as a minimal delta against `context.senderStore` (or an ephemeral store).
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Context with `senderStore` (`SharedGraphStore`).
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('GraphDeltaCodec.encode requires a message object');
    }

    const subgraph = messageToGraph(message);
    const store = context.senderStore instanceof SharedGraphStore ? context.senderStore : new SharedGraphStore();
    const totalSubgraphNodes = subgraph.nodes.length;
    const totalSubgraphEdges = subgraph.edges.length;

    const delta = store.commitSubgraph(subgraph, context.mutations || {});
    const wireText = JSON.stringify(delta);

    return {
      codec: 'graph-delta-v1',
      schemaVersion: '1.0.0',
      payload: delta,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        baseVersion: delta.bv,
        targetVersion: delta.tv,
        upsertedNodes: delta.un.length,
        omittedNodes: totalSubgraphNodes - delta.un.length,
        upsertedEdges: delta.ue.length,
        omittedEdges: totalSubgraphEdges - delta.ue.length
      }
    };
  }

  /**
   * Decodes a graph-delta packet by applying it to `context.receiverStore` (or reconstructing directly
   * when `baseVersion === 0`).
   *
   * @param {object|string} envelopeOrWireText - Delta envelope or JSON string.
   * @param {object} [context={}] - Context with `receiverStore` (`SharedGraphStore`).
   * @returns {object}
   */
  decode(envelopeOrWireText, context = {}) {
    let delta = null;
    if (typeof envelopeOrWireText === 'string') {
      try {
        delta = JSON.parse(envelopeOrWireText);
      } catch (err) {
        return {
          ok: false,
          message: null,
          errors: [`Invalid JSON in GraphDeltaCodec: ${err.message}`],
          warnings: []
        };
      }
    } else if (envelopeOrWireText && typeof envelopeOrWireText === 'object') {
      if (envelopeOrWireText.payload && typeof envelopeOrWireText.payload === 'object') {
        delta = envelopeOrWireText.payload;
      } else if (typeof envelopeOrWireText.wireText === 'string') {
        return this.decode(envelopeOrWireText.wireText, context);
      } else {
        delta = envelopeOrWireText;
      }
    }

    if (!delta || (delta.v !== 1 && delta.schemaVersion !== '1.0.0')) {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported or missing schemaVersion in GraphDeltaCodec: "${delta && (delta.v || delta.schemaVersion)}"`],
        warnings: []
      };
    }

    const store = context.receiverStore instanceof SharedGraphStore ? context.receiverStore : new SharedGraphStore();
    const applied = store.applyDelta(delta);
    if (!applied.ok) {
      return {
        ok: false,
        code: applied.code,
        message: null,
        errors: [applied.error],
        warnings: applied.warnings || []
      };
    }

    const rootId = delta.r || delta.rootId;
    const subgraph = store.extractSubgraph(rootId);
    return graphToMessage(subgraph);
  }
}

module.exports = {
  GraphDeltaCodec,
  SharedGraphStore,
  edgeKey
};
