'use strict';

/**
 * Approach B — Compact Structured JSON Codec (`compact-json-v1`).
 *
 * Exchanges concise, schema-validated JSON envelopes with short canonical keys and omits
 * redundant prose and already-known shared context (referencing it via a compact digest when unchanged).
 */

const crypto = require('crypto');
const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');

const FIELD_MAP_TO_SHORT = {
  id: 'id',
  kind: 'k',
  from: 's',
  to: 'r',
  repository: 'repo',
  issue: 'iss',
  pr: 'pr',
  base: 'b',
  head: 'h',
  headRefOid: 'sha',
  status: 'st',
  verdict: 'vd',
  tests: 'tst',
  round: 'rnd',
  turn: 'trn',
  summary: 'sum',
  scope: 'scp',
  constraints: 'cst',
  dependencies: 'dep',
  findings: 'fnd',
  assignments: 'asg'
};

const FIELD_MAP_FROM_SHORT = Object.fromEntries(
  Object.entries(FIELD_MAP_TO_SHORT).map(([longKey, shortKey]) => [shortKey, longKey])
);

/**
 * Computes a short 12-hex-char SHA-256 digest of a shared context object.
 *
 * @param {object} obj - Shared context object.
 * @returns {string}
 */
function hashSharedContext(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

class CompactJsonCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'compact-json-v1',
      schemaVersion: '1.0.0',
      description: 'Concise, schema-validated JSON with short canonical keys and context-deduplication',
      supportsDeltas: false,
      supportsArtifactRefs: true,
      requiresSharedState: false,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message into a compact JSON envelope.
   * If `context.knownContextDigests` already contains the digest of `message.sharedContext`,
   * only the 12-char digest reference (`ctxRef`) is transmitted instead of repeating the full object.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Optional encoding context.
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('CompactJsonCodec.encode requires a message object');
    }

    const compact = { v: 1 };
    for (const [longKey, shortKey] of Object.entries(FIELD_MAP_TO_SHORT)) {
      if (message[longKey] !== undefined) {
        compact[shortKey] = message[longKey];
      }
    }

    let deduplicatedContext = false;
    if (message.sharedContext && typeof message.sharedContext === 'object') {
      const digest = hashSharedContext(message.sharedContext);
      const knownSet = context && context.knownContextDigests instanceof Set ? context.knownContextDigests : null;
      const contextCache = context && context.contextCache instanceof Map ? context.contextCache : null;

      if (contextCache) {
        contextCache.set(digest, message.sharedContext);
      }

      if (knownSet && knownSet.has(digest)) {
        compact.ctxRef = digest;
        deduplicatedContext = true;
      } else {
        compact.ctx = message.sharedContext;
        compact.ctxRef = digest;
        if (knownSet) {
          knownSet.add(digest);
        }
      }
    }

    const wireText = JSON.stringify(compact);
    return {
      codec: 'compact-json-v1',
      schemaVersion: '1.0.0',
      payload: compact,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        deduplicatedContext
      }
    };
  }

  /**
   * Decodes a compact JSON envelope or wire string back into a canonical message.
   *
   * @param {object|string} envelopeOrWireText - Envelope or JSON string.
   * @param {object} [context={}] - Optional decoding context.
   * @returns {object}
   */
  decode(envelopeOrWireText, context = {}) {
    let rawObj = null;

    if (typeof envelopeOrWireText === 'string') {
      if (envelopeOrWireText.length > 256 * 1024) {
        return {
          ok: false,
          message: null,
          errors: ['Payload exceeds maximum size bound (256 KiB)'],
          warnings: []
        };
      }
      try {
        rawObj = JSON.parse(envelopeOrWireText);
      } catch (err) {
        return {
          ok: false,
          message: null,
          errors: [`Invalid JSON in CompactJsonCodec: ${err.message}`],
          warnings: []
        };
      }
    } else if (envelopeOrWireText && typeof envelopeOrWireText === 'object') {
      if (envelopeOrWireText.payload && typeof envelopeOrWireText.payload === 'object') {
        rawObj = envelopeOrWireText.payload;
      } else if (typeof envelopeOrWireText.wireText === 'string') {
        return this.decode(envelopeOrWireText.wireText, context);
      } else {
        rawObj = envelopeOrWireText;
      }
    }

    if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
      return {
        ok: false,
        message: null,
        errors: ['Decoded payload is not a JSON object'],
        warnings: []
      };
    }

    if (Object.prototype.hasOwnProperty.call(rawObj, '__proto__') || Object.prototype.hasOwnProperty.call(rawObj, 'constructor')) {
      return {
        ok: false,
        message: null,
        errors: ['Prototype pollution keys (__proto__ / constructor) are forbidden'],
        warnings: []
      };
    }

    if (rawObj.v !== 1) {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported schema version in CompactJsonCodec: "${rawObj.v}" (expected 1)`],
        warnings: []
      };
    }

    const message = {};
    for (const [shortKey, longKey] of Object.entries(FIELD_MAP_FROM_SHORT)) {
      if (rawObj[shortKey] !== undefined) {
        message[longKey] = rawObj[shortKey];
      }
    }

    const warnings = [];
    if (rawObj.ctx !== undefined) {
      message.sharedContext = rawObj.ctx;
      if (rawObj.ctxRef && context && context.contextCache instanceof Map) {
        context.contextCache.set(rawObj.ctxRef, rawObj.ctx);
      }
    } else if (rawObj.ctxRef) {
      const contextCache = context && context.contextCache instanceof Map ? context.contextCache : null;
      if (contextCache && contextCache.has(rawObj.ctxRef)) {
        message.sharedContext = contextCache.get(rawObj.ctxRef);
      } else {
        warnings.push(`Unresolved shared context reference: "${rawObj.ctxRef}"`);
      }
    }

    return {
      ok: true,
      message,
      errors: [],
      warnings
    };
  }
}

module.exports = {
  CompactJsonCodec,
  hashSharedContext
};
