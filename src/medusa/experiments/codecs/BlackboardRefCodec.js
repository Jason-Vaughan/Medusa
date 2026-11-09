'use strict';

/**
 * Content-Addressed Blackboard Artifact-Reference Communication Codec (`blackboard-ref-v1`).
 *
 * Maintains a shared, content-addressed `BlackboardStore` keyed by a 12-hex-char SHA-256 digest
 * of each distinct value. Heavy, frequently-repeated message fields (`scope`, `constraints`,
 * `findings`, `assignments`, `sharedContext`) are written to the store once per distinct value and
 * referenced thereafter by a compact `@art:<sha256_12>` pointer instead of being re-transmitted.
 *
 * Unlike the delta codecs, this approach is stateless per message (no version/history tracking):
 * any message can be decoded independently as long as every artifact pointer it references has
 * already been dereferenced into the shared store, so repeated sprint charters, scopes, or
 * constraint sets are transmitted once and reused across the whole conversation.
 */

const crypto = require('crypto');
const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');
const { estimateTokens } = require('./TokenEstimator');

const HEAVY_FIELDS = ['scope', 'constraints', 'findings', 'assignments', 'sharedContext'];
const ARTIFACT_POINTER_PATTERN = /^@art:[0-9a-f]{12}$/;

/**
 * Computes the canonical 12-hex-char SHA-256 content digest of a JSON-serializable value.
 *
 * @param {*} value - Value to address.
 * @returns {string}
 */
function artifactHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

/**
 * Formats a content digest as a `@art:<sha256_12>` artifact pointer string.
 *
 * @param {string} hash - 12-hex-char content digest.
 * @returns {string}
 */
function artifactPointer(hash) {
  return `@art:${hash}`;
}

/**
 * Returns true when `value` is a well-formed `@art:<sha256_12>` artifact pointer string.
 *
 * @param {*} value - Value to test.
 * @returns {boolean}
 */
function isArtifactPointer(value) {
  return typeof value === 'string' && ARTIFACT_POINTER_PATTERN.test(value);
}

/**
 * Content-addressed shared store for heavy, repeated message fields. Each distinct serialized
 * value is stored once under a stable `@art:<sha256_12>` pointer.
 */
class BlackboardStore {
  /**
   * Initializes an empty blackboard artifact store.
   */
  constructor() {
    this.artifacts = new Map();
  }

  /**
   * Stores `value` under its content-addressed pointer, deduplicating identical values, and
   * returns the pointer string.
   *
   * @param {*} value - JSON-serializable value to store.
   * @returns {string} The `@art:<sha256_12>` pointer under which `value` is now stored.
   */
  put(value) {
    const hash = artifactHash(value);
    if (!this.artifacts.has(hash)) {
      this.artifacts.set(hash, JSON.parse(JSON.stringify(value)));
    }
    return artifactPointer(hash);
  }

  /**
   * Dereferences a `@art:<sha256_12>` pointer back into its stored value.
   *
   * @param {string} pointer - Artifact pointer (or bare hash) to resolve.
   * @returns {*} The stored value, or `undefined` if no artifact exists for that pointer.
   */
  get(pointer) {
    const hash = pointer.startsWith('@art:') ? pointer.slice(5) : pointer;
    return this.artifacts.has(hash) ? JSON.parse(JSON.stringify(this.artifacts.get(hash))) : undefined;
  }

  /**
   * Checks whether an artifact exists for the given pointer.
   *
   * @param {string} pointer - Artifact pointer (or bare hash) to check.
   * @returns {boolean}
   */
  has(pointer) {
    const hash = pointer.startsWith('@art:') ? pointer.slice(5) : pointer;
    return this.artifacts.has(hash);
  }

  /**
   * Creates a deep clone of this store, useful for simulating a receiver that has not yet seen
   * any of the sender's artifacts.
   *
   * @returns {BlackboardStore}
   */
  clone() {
    const copy = new BlackboardStore();
    for (const [hash, value] of this.artifacts.entries()) {
      copy.artifacts.set(hash, JSON.parse(JSON.stringify(value)));
    }
    return copy;
  }
}

/**
 * Content-addressed blackboard artifact-reference codec. Replaces heavy, repeated message fields
 * with compact `@art:<sha256_12>` pointers into a shared `BlackboardStore`.
 */
class BlackboardRefCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'blackboard-ref-v1',
      schemaVersion: '1.0.0',
      description:
        'Content-addressed blackboard store replacing heavy repeated fields (scope, constraints, findings, assignments, sharedContext) with @art:<sha256_12> pointers',
      supportsDeltas: false,
      supportsArtifactRefs: true,
      requiresSharedState: true,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message, writing its heavy fields into `context.store` and replacing them
   * with artifact pointers in the transmitted wire payload.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Context with `store` (`BlackboardStore`).
   * @returns {{ codec: string, schemaVersion: string, payload: object, wireText: string, humanAuditText: string, metadata: object }}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('BlackboardRefCodec.encode requires a message object');
    }

    const store = context.store instanceof BlackboardStore ? context.store : new BlackboardStore();
    const routingFields = {};
    const dereferencedFields = {};

    for (const key of Object.keys(message)) {
      const value = message[key];
      if (HEAVY_FIELDS.includes(key) && value !== undefined && value !== null) {
        routingFields[key] = store.put(value);
      } else {
        routingFields[key] = value;
      }
      dereferencedFields[key] = value;
    }

    const payload = { v: 1, fields: routingFields };
    const wireText = JSON.stringify(payload);
    const fullWireText = JSON.stringify({ v: 1, fields: dereferencedFields });

    const routingTokens = estimateTokens(wireText);
    const fullTokens = estimateTokens(fullWireText);

    return {
      codec: 'blackboard-ref-v1',
      schemaVersion: '1.0.0',
      payload,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        pointerRoutingTokens: routingTokens.tokenCount,
        fullDereferencedTokens: fullTokens.tokenCount,
        tokensSaved: fullTokens.tokenCount - routingTokens.tokenCount,
        artifactFieldsReferenced: HEAVY_FIELDS.filter(
          (field) => isArtifactPointer(routingFields[field])
        )
      }
    };
  }

  /**
   * Decodes a blackboard-ref envelope, dereferencing every `@art:<sha256_12>` pointer against
   * `context.store`. Fails with `MISSING_ARTIFACT` if any referenced artifact is not present.
   *
   * @param {object|string} envelopeOrWireText - Envelope or wire text produced by `encode()`.
   * @param {object} [context={}] - Context with `store` (`BlackboardStore`).
   * @returns {{ ok: boolean, code?: string, message: object|null, errors: string[], warnings: string[] }}
   */
  decode(envelopeOrWireText, context = {}) {
    let payload = null;

    if (typeof envelopeOrWireText === 'string') {
      try {
        payload = JSON.parse(envelopeOrWireText);
      } catch (err) {
        return {
          ok: false,
          message: null,
          errors: [`Invalid JSON in BlackboardRefCodec: ${err.message}`],
          warnings: []
        };
      }
    } else if (envelopeOrWireText && typeof envelopeOrWireText === 'object') {
      if (envelopeOrWireText.payload && typeof envelopeOrWireText.payload === 'object') {
        payload = envelopeOrWireText.payload;
      } else if (typeof envelopeOrWireText.wireText === 'string') {
        return this.decode(envelopeOrWireText.wireText, context);
      } else {
        payload = envelopeOrWireText;
      }
    }

    if (!payload || payload.v !== 1 || !payload.fields || typeof payload.fields !== 'object') {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported or missing schemaVersion in BlackboardRefCodec: "${payload && payload.v}"`],
        warnings: []
      };
    }

    const store = context.store instanceof BlackboardStore ? context.store : new BlackboardStore();
    const message = {};
    const errors = [];

    for (const key of Object.keys(payload.fields)) {
      const value = payload.fields[key];
      if (isArtifactPointer(value)) {
        if (!store.has(value)) {
          errors.push(`Missing artifact reference for field "${key}": pointer "${value}" is not in the blackboard store`);
          continue;
        }
        message[key] = store.get(value);
      } else {
        message[key] = value;
      }
    }

    if (errors.length > 0) {
      return { ok: false, code: 'MISSING_ARTIFACT', message: null, errors, warnings: [] };
    }

    return { ok: true, message, errors: [], warnings: [] };
  }
}

module.exports = {
  BlackboardRefCodec,
  BlackboardStore,
  HEAVY_FIELDS,
  artifactHash,
  artifactPointer,
  isArtifactPointer
};
