'use strict';

/**
 * Approach — Flat State-Register Diff Communication Codec (`json-patch-v1`).
 *
 * Maintains an authoritative, versioned `FlatStateRegister` (`version`, `digest`, `state`, `history`)
 * and transmits only the RFC 6902 ("add" | "replace" | "remove") field-level JSON Patch operations
 * required to move the register from `baseVersion` to `targetVersion`, instead of re-sending whole
 * messages. Unlike the graph-based delta approach, state here is a flat task-state register (the
 * canonical message object itself), so no node/edge modeling is required.
 *
 * Supports:
 * - Minimal field-level diffs across nested objects (arrays are diffed as atomic units: an array is
 *   only ever replaced wholesale when its serialized content changes, never diffed per-index, since
 *   per-element identity for heterogeneous arrays like `scope`/`constraints` is undefined).
 * - Optimistic concurrency conflict detection (`VERSION_CONFLICT`, `BASE_HASH_MISMATCH`).
 * - Missed-event detection (`MISSING_BASE_VERSION`) and deterministic recovery via snapshot import.
 */

const crypto = require('crypto');
const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');

/**
 * Escapes a single JSON Pointer (RFC 6901) reference token.
 *
 * @param {string} token - Raw object key.
 * @returns {string} Escaped token (`~` -> `~0`, `/` -> `~1`).
 */
function escapeToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Unescapes a single JSON Pointer (RFC 6901) reference token.
 *
 * @param {string} token - Escaped path segment.
 * @returns {string} Raw object key.
 */
function unescapeToken(token) {
  return String(token).replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Returns true for non-null, non-array plain objects.
 *
 * @param {*} value - Value to test.
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Serializes a value to JSON with object keys sorted recursively, so two values with identical
 * content but different key insertion order (e.g. a target state built by diff-and-patch vs. one
 * assigned directly) produce the same digest. Array element order is preserved.
 *
 * @param {*} value - Value to serialize.
 * @returns {string}
 */
function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Computes the minimal RFC 6902 JSON Patch diff between two JSON-compatible values.
 *
 * Walks nested plain objects recursively, addressing changed leaves by JSON Pointer path.
 * Arrays and primitives are compared by serialized value and emitted as a single whole-value
 * "replace" (or "add"/"remove") operation when they differ.
 *
 * @param {*} prevState - Previous (base) state.
 * @param {*} nextState - Next (target) state.
 * @param {string} [basePath=''] - JSON Pointer prefix for the current recursion depth.
 * @returns {Array<{op: string, path: string, value?: *}>} Ordered list of JSON Patch operations.
 */
function computeDiff(prevState, nextState, basePath = '') {
  const ops = [];

  if (!isPlainObject(prevState) || !isPlainObject(nextState)) {
    if (JSON.stringify(prevState) === JSON.stringify(nextState)) {
      return ops;
    }
    if (prevState === undefined) {
      ops.push({ op: 'add', path: basePath, value: nextState });
    } else if (nextState === undefined) {
      ops.push({ op: 'remove', path: basePath });
    } else {
      ops.push({ op: 'replace', path: basePath, value: nextState });
    }
    return ops;
  }

  const prevKeys = Object.keys(prevState);
  const nextKeys = Object.keys(nextState);

  for (const key of nextKeys) {
    const childPath = `${basePath}/${escapeToken(key)}`;
    if (!Object.prototype.hasOwnProperty.call(prevState, key)) {
      ops.push({ op: 'add', path: childPath, value: nextState[key] });
      continue;
    }
    const pv = prevState[key];
    const nv = nextState[key];
    if (isPlainObject(pv) && isPlainObject(nv)) {
      ops.push(...computeDiff(pv, nv, childPath));
    } else if (JSON.stringify(pv) !== JSON.stringify(nv)) {
      ops.push({ op: 'replace', path: childPath, value: nv });
    }
  }

  for (const key of prevKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextState, key)) {
      ops.push({ op: 'remove', path: `${basePath}/${escapeToken(key)}` });
    }
  }

  return ops;
}

const VALID_PATCH_OPS = new Set(['add', 'replace', 'remove']);
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Applies an ordered list of RFC 6902 JSON Patch operations to a base state, returning a new,
 * deeply-cloned result (the input `baseState` is never mutated).
 *
 * Rejects any operation whose `op` is not `"add"`/`"replace"`/`"remove"`, whose `path` is not `""`
 * (whole-document) or does not start with `"/"`, or whose path touches `__proto__`, `constructor`,
 * or `prototype` — a patch from an untrusted sender can never traverse or reassign the JS prototype
 * chain.
 *
 * @param {*} baseState - State to patch (treated as `{}` when `undefined`).
 * @param {Array<{op: string, path: string, value?: *}>} ops - JSON Patch operations to apply, in order.
 * @returns {*} The patched state.
 * @throws {Error} With an `INVALID_PATCH_PATH:`-prefixed message when an operation is malformed or unsafe.
 */
function applyDiff(baseState, ops) {
  let result = JSON.parse(JSON.stringify(baseState === undefined ? {} : baseState));

  for (const patchOp of ops || []) {
    if (!patchOp || !VALID_PATCH_OPS.has(patchOp.op)) {
      throw new Error(
        `INVALID_PATCH_PATH: op must be one of "add"/"replace"/"remove", got ${JSON.stringify(patchOp && patchOp.op)}`
      );
    }
    if (typeof patchOp.path !== 'string' || (patchOp.path !== '' && !patchOp.path.startsWith('/'))) {
      throw new Error(`INVALID_PATCH_PATH: path must be "" or start with "/", got ${JSON.stringify(patchOp.path)}`);
    }

    if (patchOp.path === '') {
      result = patchOp.op === 'remove' ? undefined : JSON.parse(JSON.stringify(patchOp.value));
      continue;
    }

    const parts = patchOp.path.split('/').slice(1).map(unescapeToken);
    if (parts.some((part) => FORBIDDEN_PATH_SEGMENTS.has(part))) {
      throw new Error(
        `INVALID_PATCH_PATH: path "${patchOp.path}" touches a forbidden segment ("__proto__"/"constructor"/"prototype")`
      );
    }

    const lastKey = parts.pop();
    let node = result;
    for (const part of parts) {
      if (!isPlainObject(node[part])) {
        node[part] = {};
      }
      node = node[part];
    }

    if (patchOp.op === 'remove') {
      delete node[lastKey];
    } else {
      node[lastKey] = JSON.parse(JSON.stringify(patchOp.value));
    }
  }

  return result;
}

/**
 * Computes the canonical 12-hex-char SHA-256 digest of a given version/state pair. Pure
 * (non-mutating) so a candidate post-patch state can be hashed and verified before it is
 * committed to a register.
 *
 * @param {number} version - Register version to bind into the digest.
 * @param {*} state - State to bind into the digest.
 * @returns {string}
 */
function computeStateDigest(version, state) {
  return crypto
    .createHash('sha256')
    .update(canonicalStringify({ v: version, s: state }))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Versioned in-memory flat task-state register for `JsonPatchDeltaCodec`.
 */
class FlatStateRegister {
  /**
   * Initializes an empty flat state register at version 0.
   */
  constructor() {
    this.version = 0;
    this.state = {};
    this.deltaHistory = [];
  }

  /**
   * Creates a deep clone of this register (useful for simulating separate sender/receiver
   * registers or forking before a reconciliation).
   *
   * @returns {FlatStateRegister}
   */
  clone() {
    const copy = new FlatStateRegister();
    copy.version = this.version;
    copy.state = JSON.parse(JSON.stringify(this.state));
    copy.deltaHistory = JSON.parse(JSON.stringify(this.deltaHistory));
    return copy;
  }

  /**
   * Computes a canonical 12-hex-char SHA-256 digest of the register's current version and state.
   *
   * @returns {string}
   */
  computeDigest() {
    return computeStateDigest(this.version, this.state);
  }

  /**
   * Exports a full state snapshot for recovery after a missed delta or a version conflict.
   *
   * @returns {{ version: number, digest: string, state: * }}
   */
  exportSnapshot() {
    return {
      version: this.version,
      digest: this.computeDigest(),
      state: JSON.parse(JSON.stringify(this.state))
    };
  }

  /**
   * Restores the register from a full state snapshot.
   *
   * @param {{ version: number, state: * }} snapshot - Snapshot returned by `exportSnapshot()`.
   */
  importSnapshot(snapshot) {
    this.version = snapshot.version;
    this.state = JSON.parse(JSON.stringify(snapshot.state === undefined ? {} : snapshot.state));
  }

  /**
   * Commits `nextState` against this register's current state, producing the minimal RFC 6902
   * delta required to move from `baseVersion` to `targetVersion`.
   *
   * @param {*} nextState - Target state (the canonical message to transmit).
   * @returns {object} Delta packet `{ v, baseVersion, targetVersion, base_hash, target_hash, ops }`.
   */
  commitState(nextState) {
    const baseVersion = this.version;
    const baseHash = this.computeDigest();
    const ops = computeDiff(this.state, nextState);

    this.state = JSON.parse(JSON.stringify(nextState));
    this.version += 1;
    const targetVersion = this.version;
    const targetHash = this.computeDigest();

    const delta = {
      v: 1,
      baseVersion,
      targetVersion,
      base_hash: baseHash,
      target_hash: targetHash,
      ops
    };

    this.deltaHistory.push(JSON.parse(JSON.stringify(delta)));
    return delta;
  }

  /**
   * Applies an incoming delta packet to this register, verifying version continuity, base state
   * digest, and concurrent modification conflicts before patching.
   *
   * @param {object} delta - Incoming delta packet.
   * @returns {{ ok: boolean, code?: string, error?: string, state?: * }}
   */
  applyDelta(delta) {
    if (!delta || typeof delta !== 'object') {
      return { ok: false, code: 'INVALID_DELTA', error: 'Delta payload must be an object' };
    }

    const { baseVersion, targetVersion, base_hash: baseHash, target_hash: targetHash, ops } = delta;

    // 1. Check for missed intermediate updates (receiver is behind baseVersion)
    if (baseVersion > this.version) {
      return {
        ok: false,
        code: 'MISSING_BASE_VERSION',
        error: `Missed intermediate state updates: register is at v${this.version} but delta requires baseVersion v${baseVersion}`
      };
    }

    // 2. Check for concurrent conflicting writes (receiver already advanced past baseVersion)
    if (baseVersion < this.version) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        error: `Concurrent state conflict: delta is based on stale v${baseVersion}, but register is already at v${this.version}`
      };
    }

    // 3. Verify base_hash matches the register's current digest
    const currentHash = this.computeDigest();
    if (baseHash && baseHash !== currentHash) {
      return {
        ok: false,
        code: 'BASE_HASH_MISMATCH',
        error: `State divergence at v${this.version}: expected base_hash "${baseHash}" but register has "${currentHash}"`
      };
    }

    // 4. Compute the candidate patched state and verify target_hash BEFORE committing anything:
    // a corrupt or malicious packet must leave this register untouched so a subsequent correct
    // delta (still based on the unchanged baseVersion/base_hash) can succeed.
    let patched;
    try {
      patched = applyDiff(this.state, ops);
    } catch (err) {
      return { ok: false, code: 'INVALID_PATCH_PATH', error: err.message };
    }

    const candidateHash = computeStateDigest(targetVersion, patched);
    if (targetHash && candidateHash !== targetHash) {
      return {
        ok: false,
        code: 'TARGET_HASH_MISMATCH',
        error: `Post-apply hash mismatch at v${targetVersion}: expected "${targetHash}", computed "${candidateHash}"`
      };
    }

    this.state = patched;
    this.version = targetVersion;
    this.deltaHistory.push(JSON.parse(JSON.stringify(delta)));
    return { ok: true, state: this.state };
  }
}

/**
 * Flat state-register JSON Patch delta codec. Transmits only changed-field RFC 6902 operations
 * between two versions of a flat task-state register, rather than re-sending whole messages.
 */
class JsonPatchDeltaCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'json-patch-v1',
      schemaVersion: '1.0.0',
      description:
        'Flat versioned task-state register transmitting RFC 6902 JSON Patch field-level diffs between baseVersion and targetVersion',
      supportsDeltas: true,
      supportsArtifactRefs: false,
      requiresSharedState: true,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message as a minimal RFC 6902 delta against `context.senderStore`
   * (or an ephemeral register when none is supplied).
   *
   * @param {object} message - Canonical semantic message (treated as the target flat state).
   * @param {object} [context={}] - Context with `senderStore` (`FlatStateRegister`).
   * @returns {{ codec: string, schemaVersion: string, payload: object, wireText: string, humanAuditText: string, metadata: object }}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('JsonPatchDeltaCodec.encode requires a message object');
    }

    const store = context.senderStore instanceof FlatStateRegister ? context.senderStore : new FlatStateRegister();
    const delta = store.commitState(message);
    const wireText = JSON.stringify(delta);

    return {
      codec: 'json-patch-v1',
      schemaVersion: '1.0.0',
      payload: delta,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        baseVersion: delta.baseVersion,
        targetVersion: delta.targetVersion,
        opCount: delta.ops.length
      }
    };
  }

  /**
   * Decodes a JSON Patch delta packet by applying it to `context.receiverStore` (or an ephemeral
   * register when none is supplied).
   *
   * @param {object|string} envelopeOrWireText - Delta envelope or JSON string.
   * @param {object} [context={}] - Context with `receiverStore` (`FlatStateRegister`).
   * @returns {{ ok: boolean, code?: string, message: object|null, errors: string[], warnings: string[] }}
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
          errors: [`Invalid JSON in JsonPatchDeltaCodec: ${err.message}`],
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

    if (!delta || delta.v !== 1) {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported or missing schemaVersion in JsonPatchDeltaCodec: "${delta && delta.v}"`],
        warnings: []
      };
    }

    const store = context.receiverStore instanceof FlatStateRegister ? context.receiverStore : new FlatStateRegister();
    const applied = store.applyDelta(delta);
    if (!applied.ok) {
      return {
        ok: false,
        code: applied.code,
        message: null,
        errors: [applied.error],
        warnings: []
      };
    }

    return { ok: true, message: applied.state, errors: [], warnings: [] };
  }
}

module.exports = {
  JsonPatchDeltaCodec,
  FlatStateRegister,
  computeDiff,
  applyDiff,
  canonicalStringify,
  computeStateDigest
};
