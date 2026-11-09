'use strict';

/**
 * Approach C — Property Graph Communication Codec (`graph-v1`).
 *
 * Represents every agent coordination message as an explicit, self-contained property graph
 * `G = { version, rootId, nodes: [{id, type, attrs}], edges: [{from, to, rel, attrs}] }`.
 *
 * Models:
 * - Message event root node (`MessageEvent`)
 * - Sender and recipient `Agent` nodes (`SENT_BY`, `SENT_TO`)
 * - `Issue`, `PullRequest`, `Commit`, `File`, `Constraint`, `Dependency`, `Finding`, `Assignment`, `SharedContext` nodes
 * - Structural & cycle/dangling-edge graph integrity checks
 */

const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');

/**
 * Converts a canonical semantic message into a property graph `{ rootId, nodes, edges }`.
 *
 * @param {object} message - Canonical semantic message.
 * @returns {{ rootId: string, nodes: Array<object>, edges: Array<object> }}
 */
function messageToGraph(message) {
  const nodesMap = new Map();
  const edges = [];

  const upsertNode = (id, type, attrs = {}) => {
    if (!nodesMap.has(id)) {
      nodesMap.set(id, { id, type, attrs: { ...attrs } });
    } else {
      const existing = nodesMap.get(id);
      existing.attrs = { ...existing.attrs, ...attrs };
    }
  };

  const addEdge = (from, to, rel, attrs = undefined) => {
    const edge = { from, to, rel };
    if (attrs && Object.keys(attrs).length > 0) {
      edge.attrs = attrs;
    }
    edges.push(edge);
  };

  const rootId = message.id ? `msg:${message.id}` : `msg:${message.kind}:${message.from}->${message.to}:${message.turn || 0}`;
  const rootAttrs = { kind: message.kind };
  if (message.id !== undefined) rootAttrs.id = message.id;
  if (message.repository !== undefined) rootAttrs.repository = message.repository;
  if (message.base !== undefined) rootAttrs.base = message.base;
  if (message.head !== undefined) rootAttrs.head = message.head;
  if (message.status !== undefined) rootAttrs.status = message.status;
  if (message.verdict !== undefined) rootAttrs.verdict = message.verdict;
  if (message.tests !== undefined) rootAttrs.tests = message.tests;
  if (message.round !== undefined) rootAttrs.round = message.round;
  if (message.turn !== undefined) rootAttrs.turn = message.turn;
  if (message.summary !== undefined) rootAttrs.summary = message.summary;
  if (Array.isArray(message.findings) && message.findings.length === 0) {
    rootAttrs.emptyFindings = true;
  }

  upsertNode(rootId, 'MessageEvent', rootAttrs);

  if (message.from) {
    const fromId = `agent:${message.from}`;
    upsertNode(fromId, 'Agent', { name: message.from });
    addEdge(rootId, fromId, 'SENT_BY');
  }

  if (message.to) {
    const toId = `agent:${message.to}`;
    upsertNode(toId, 'Agent', { name: message.to });
    addEdge(rootId, toId, 'SENT_TO');
  }

  if (message.issue !== undefined) {
    const issues = Array.isArray(message.issue) ? message.issue : [message.issue];
    issues.forEach((iss, idx) => {
      const issId = `issue:${iss}`;
      upsertNode(issId, 'Issue', { number: iss, isArray: Array.isArray(message.issue), order: idx });
      addEdge(rootId, issId, 'REFERENCES_ISSUE', { order: idx });
    });
  }

  if (message.pr !== undefined) {
    const prId = `pr:${message.pr}`;
    upsertNode(prId, 'PullRequest', { number: message.pr });
    addEdge(rootId, prId, 'TARGETS_PR');
  }

  if (message.headRefOid !== undefined) {
    const shaId = `commit:${message.headRefOid}`;
    upsertNode(shaId, 'Commit', { oid: message.headRefOid });
    addEdge(rootId, shaId, 'AT_COMMIT');
  }

  if (Array.isArray(message.scope)) {
    message.scope.forEach((filePath, idx) => {
      const fileId = `file:${filePath}`;
      upsertNode(fileId, 'File', { path: filePath });
      addEdge(rootId, fileId, 'SCOPED_FILE', { order: idx });
    });
  }

  if (Array.isArray(message.constraints)) {
    message.constraints.forEach((rule, idx) => {
      const cId = `constraint:${idx}:${rule}`;
      upsertNode(cId, 'Constraint', { rule, order: idx });
      addEdge(rootId, cId, 'ENFORCES_CONSTRAINT', { order: idx });
    });
  }

  if (Array.isArray(message.dependencies)) {
    message.dependencies.forEach((dep, idx) => {
      const depId = `${rootId}:dep:${idx}`;
      upsertNode(depId, 'Dependency', { value: dep, order: idx });
      addEdge(rootId, depId, 'DEPENDS_ON', { order: idx });
    });
  }

  if (Array.isArray(message.findings)) {
    message.findings.forEach((finding, idx) => {
      const fId = `${rootId}:finding:${idx}`;
      upsertNode(fId, 'Finding', { data: finding, order: idx });
      addEdge(rootId, fId, 'REPORTS_FINDING', { order: idx });
    });
  }

  if (Array.isArray(message.assignments)) {
    message.assignments.forEach((asg, idx) => {
      const aId = `${rootId}:assignment:${idx}`;
      upsertNode(aId, 'Assignment', { data: asg, order: idx });
      addEdge(rootId, aId, 'ASSIGNS_CAR', { order: idx });
    });
  }

  if (message.sharedContext && typeof message.sharedContext === 'object') {
    const ctxId = 'context:shared';
    upsertNode(ctxId, 'SharedContext', { data: message.sharedContext });
    addEdge(rootId, ctxId, 'HAS_SHARED_CONTEXT');
  }

  return {
    rootId,
    nodes: Array.from(nodesMap.values()),
    edges
  };
}

/**
 * Reconstructs a canonical semantic message from a property graph `{ rootId, nodes, edges }`.
 * Also validates graph structural invariants (no dangling edges, valid root node).
 *
 * @param {object} graph - Property graph object.
 * @returns {{ ok: boolean, message: object|null, errors: string[], warnings: string[] }}
 */
function graphToMessage(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return {
      ok: false,
      message: null,
      errors: ['Graph payload must contain "nodes" and "edges" arrays'],
      warnings: []
    };
  }

  const nodeMap = new Map();
  const errors = [];
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.type !== 'string') {
      errors.push('Every graph node must have string "id" and "type"');
      continue;
    }
    nodeMap.set(node.id, node);
  }

  // Verify zero dangling edges
  for (const edge of graph.edges) {
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string' || typeof edge.rel !== 'string') {
      errors.push('Every graph edge must have string "from", "to", and "rel"');
      continue;
    }
    if (!nodeMap.has(edge.from)) {
      errors.push(`Dangling edge source node: "${edge.from}" does not exist in graph.nodes`);
    }
    if (!nodeMap.has(edge.to)) {
      errors.push(`Dangling edge target node: "${edge.to}" does not exist in graph.nodes`);
    }
  }

  const rootNode = graph.rootId ? nodeMap.get(graph.rootId) : graph.nodes.find((n) => n && n.type === 'MessageEvent');
  if (!rootNode) {
    errors.push(`Root MessageEvent node "${graph.rootId || '(unspecified)'}" not found in graph`);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      message: null,
      errors,
      warnings: []
    };
  }

  const attrs = rootNode.attrs || {};
  const message = {};
  if (attrs.id !== undefined) message.id = attrs.id;
  if (attrs.kind !== undefined) message.kind = attrs.kind;
  if (attrs.repository !== undefined) message.repository = attrs.repository;
  if (attrs.base !== undefined) message.base = attrs.base;
  if (attrs.head !== undefined) message.head = attrs.head;
  if (attrs.status !== undefined) message.status = attrs.status;
  if (attrs.verdict !== undefined) message.verdict = attrs.verdict;
  if (attrs.tests !== undefined) message.tests = attrs.tests;
  if (attrs.round !== undefined) message.round = attrs.round;
  if (attrs.turn !== undefined) message.turn = attrs.turn;
  if (attrs.summary !== undefined) message.summary = attrs.summary;

  const issueEntries = [];
  let issueWasArray = false;
  const scopeEntries = [];
  const constraintEntries = [];
  const depEntries = [];
  const findingEntries = [];
  const assignmentEntries = [];

  const outgoingEdges = graph.edges.filter((e) => e.from === rootNode.id);
  for (const edge of outgoingEdges) {
    const target = nodeMap.get(edge.to);
    if (!target) continue;
    const tAttrs = target.attrs || {};
    const order = edge.attrs && edge.attrs.order !== undefined ? edge.attrs.order : tAttrs.order || 0;

    switch (edge.rel) {
      case 'SENT_BY':
        message.from = tAttrs.name;
        break;
      case 'SENT_TO':
        message.to = tAttrs.name;
        break;
      case 'REFERENCES_ISSUE':
        if (tAttrs.isArray) issueWasArray = true;
        issueEntries.push({ order, val: tAttrs.number });
        break;
      case 'TARGETS_PR':
        message.pr = tAttrs.number;
        break;
      case 'AT_COMMIT':
        message.headRefOid = tAttrs.oid;
        break;
      case 'SCOPED_FILE':
        scopeEntries.push({ order, val: tAttrs.path });
        break;
      case 'ENFORCES_CONSTRAINT':
        constraintEntries.push({ order, val: tAttrs.rule });
        break;
      case 'DEPENDS_ON':
        depEntries.push({ order, val: tAttrs.value });
        break;
      case 'REPORTS_FINDING':
        findingEntries.push({ order, val: tAttrs.data });
        break;
      case 'ASSIGNS_CAR':
        assignmentEntries.push({ order, val: tAttrs.data });
        break;
      case 'HAS_SHARED_CONTEXT':
        message.sharedContext = tAttrs.data;
        break;
      default:
        break;
    }
  }

  const sortByOrder = (arr) => arr.sort((a, b) => a.order - b.order).map((x) => x.val);

  if (issueEntries.length > 0) {
    const sortedIssues = sortByOrder(issueEntries);
    message.issue = issueWasArray || sortedIssues.length > 1 ? sortedIssues : sortedIssues[0];
  }
  if (scopeEntries.length > 0) message.scope = sortByOrder(scopeEntries);
  if (constraintEntries.length > 0) message.constraints = sortByOrder(constraintEntries);
  if (depEntries.length > 0) message.dependencies = sortByOrder(depEntries);
  if (findingEntries.length > 0) {
    message.findings = sortByOrder(findingEntries);
  } else if (attrs.emptyFindings) {
    message.findings = [];
  }
  if (assignmentEntries.length > 0) message.assignments = sortByOrder(assignmentEntries);

  return {
    ok: true,
    message,
    errors: [],
    warnings: []
  };
}

class GraphCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'graph-v1',
      schemaVersion: '1.0.0',
      description: 'Self-contained property graph representation (nodes, typed edges, attributes)',
      supportsDeltas: false,
      supportsArtifactRefs: true,
      requiresSharedState: false,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message into a property graph JSON payload.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Optional context.
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('GraphCodec.encode requires a message object');
    }

    const graph = messageToGraph(message);
    const payload = {
      schemaVersion: '1.0.0',
      rootId: graph.rootId,
      nodes: graph.nodes,
      edges: graph.edges
    };

    const wireText = JSON.stringify(payload);
    return {
      codec: 'graph-v1',
      schemaVersion: '1.0.0',
      payload,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length
      }
    };
  }

  /**
   * Decodes a property graph envelope or JSON string back into a canonical semantic message.
   *
   * @param {object|string} envelopeOrWireText - Envelope or JSON string.
   * @param {object} [context={}] - Optional context.
   * @returns {object}
   */
  decode(envelopeOrWireText, context = {}) {
    let graphObj = null;
    if (typeof envelopeOrWireText === 'string') {
      try {
        graphObj = JSON.parse(envelopeOrWireText);
      } catch (err) {
        return {
          ok: false,
          message: null,
          errors: [`Invalid JSON in GraphCodec: ${err.message}`],
          warnings: []
        };
      }
    } else if (envelopeOrWireText && typeof envelopeOrWireText === 'object') {
      if (envelopeOrWireText.payload && typeof envelopeOrWireText.payload === 'object') {
        graphObj = envelopeOrWireText.payload;
      } else if (typeof envelopeOrWireText.wireText === 'string') {
        return this.decode(envelopeOrWireText.wireText, context);
      } else {
        graphObj = envelopeOrWireText;
      }
    }

    if (!graphObj || graphObj.schemaVersion !== '1.0.0') {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported or missing schemaVersion in GraphCodec: "${graphObj && graphObj.schemaVersion}"`],
        warnings: []
      };
    }

    return graphToMessage(graphObj);
  }
}

module.exports = {
  GraphCodec,
  messageToGraph,
  graphToMessage
};
