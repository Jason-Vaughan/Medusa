'use strict';

/**
 * Pluggable Codec Registry & Fail-Safe Negotiation Layer for Medusa Communication Experiments.
 *
 * Registers Approaches A–I (`nl-baseline-v1`, `compact-json-v1`, `graph-v1`, `graph-delta-v1`,
 * `typed-cmd-v1`, `tuple-table-v1`, `dict-intern-v1`, `json-patch-v1`, `blackboard-ref-v1`)
 * and enforces safe fallback when an unknown codec or unsupported schema version is encountered.
 */

const { BaseCodec, VALID_KINDS, VALID_VERDICTS, formatHumanAuditText, validateCanonicalMessage } = require('./BaseCodec');
const { NaturalLanguageCodec } = require('./NaturalLanguageCodec');
const { CompactJsonCodec, hashSharedContext } = require('./CompactJsonCodec');
const { GraphCodec, messageToGraph, graphToMessage } = require('./GraphCodec');
const { GraphDeltaCodec, SharedGraphStore, edgeKey } = require('./GraphDeltaCodec');
const { TypedCommandCodec, scanCommandArgs } = require('./TypedCommandCodec');
const { TupleTableCodec } = require('./TupleTableCodec');
const { DictionaryInternCodec, SharedSymbolTable } = require('./DictionaryInternCodec');
const { JsonPatchDeltaCodec, FlatStateRegister, computeDiff, applyDiff, canonicalStringify, computeStateDigest } = require('./JsonPatchDeltaCodec');
const {
  BlackboardRefCodec,
  BlackboardStore,
  HEAVY_FIELDS,
  artifactHash,
  artifactPointer,
  isArtifactPointer
} = require('./BlackboardRefCodec');
const { estimateTokens, estimateInferenceCost } = require('./TokenEstimator');

class CodecRegistry {
  /**
   * Initializes a CodecRegistry with all 9 runtime experimental codecs registered by default.
   *
   * @param {object} [options={}] - Registry configuration options.
   */
  constructor(options = {}) {
    this.codecs = new Map();
    if (options.registerDefaults !== false) {
      this.register(new NaturalLanguageCodec());
      this.register(new CompactJsonCodec());
      this.register(new GraphCodec());
      this.register(new GraphDeltaCodec());
      this.register(new TypedCommandCodec());
      this.register(new TupleTableCodec());
      this.register(new DictionaryInternCodec());
      this.register(new JsonPatchDeltaCodec());
      this.register(new BlackboardRefCodec());
    }
  }

  /**
   * Registers a codec instance.
   *
   * @param {BaseCodec} codecInstance - Instance of a BaseCodec subclass.
   */
  register(codecInstance) {
    if (!codecInstance || typeof codecInstance.capabilities !== 'function') {
      throw new Error('CodecRegistry.register requires a valid BaseCodec instance');
    }
    const caps = codecInstance.capabilities();
    if (!caps || !caps.id) {
      throw new Error('Codec capabilities() must return an object with a non-empty "id"');
    }
    this.codecs.set(caps.id, codecInstance);
  }

  /**
   * Retrieves a registered codec by ID.
   *
   * @param {string} codecId - Codec identifier.
   * @returns {BaseCodec|null}
   */
  get(codecId) {
    return this.codecs.get(codecId) || null;
  }

  /**
   * Lists capabilities of all registered codecs.
   *
   * @returns {Array<object>}
   */
  listCapabilities() {
    return Array.from(this.codecs.values()).map((c) => c.capabilities());
  }

  /**
   * Safely encodes a message using the requested `codecId`, falling back to `nl-baseline-v1`
   * if `options.fallbackToBaseline` is true and the requested codec is unknown.
   *
   * @param {string} codecId - Target codec ID.
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Encoding context.
   * @returns {{ ok: boolean, envelope?: object, code?: string, error?: string, usedFallback?: boolean }}
   */
  encode(codecId, message, context = {}) {
    let codec = this.get(codecId);
    let usedFallback = false;

    if (!codec) {
      if (context && context.fallbackToBaseline && this.codecs.has('nl-baseline-v1')) {
        codec = this.get('nl-baseline-v1');
        usedFallback = true;
      } else {
        return {
          ok: false,
          code: 'UNSUPPORTED_CODEC',
          error: `Unknown or unsupported codec ID: "${codecId}"`
        };
      }
    }

    try {
      const envelope = codec.encode(message, context);
      return {
        ok: true,
        envelope,
        usedFallback
      };
    } catch (err) {
      return {
        ok: false,
        code: 'ENCODE_FAILED',
        error: err.message
      };
    }
  }

  /**
   * Safely decodes an envelope (using `envelope.codec` or an explicit `codecId`).
   * If the codec is unknown and the envelope carries a `humanAuditText` fallback, returns
   * a structured `UNSUPPORTED_CODEC` refusal alongside the human-readable audit string.
   *
   * @param {object|string} envelopeOrWireText - Envelope or wire text.
   * @param {string} [explicitCodecId] - Explicit codec ID when passing raw wire text.
   * @param {object} [context={}] - Decoding context.
   * @returns {{ ok: boolean, code?: string, message: object|null, humanFallback?: string|null, errors: string[], warnings: string[] }}
   */
  decode(envelopeOrWireText, explicitCodecId = null, context = {}) {
    const codecId =
      explicitCodecId ||
      (envelopeOrWireText && typeof envelopeOrWireText === 'object' ? envelopeOrWireText.codec : null);

    const codec = codecId ? this.get(codecId) : null;
    if (!codec) {
      const humanFallback =
        envelopeOrWireText && typeof envelopeOrWireText === 'object' && envelopeOrWireText.humanAuditText
          ? envelopeOrWireText.humanAuditText
          : null;
      return {
        ok: false,
        code: 'UNSUPPORTED_CODEC',
        message: null,
        humanFallback,
        errors: [`Unknown or unsupported codec ID: "${codecId || '(unspecified)'}"`],
        warnings: []
      };
    }

    return codec.decode(envelopeOrWireText, context);
  }
}

module.exports = {
  CodecRegistry,
  BaseCodec,
  NaturalLanguageCodec,
  CompactJsonCodec,
  GraphCodec,
  GraphDeltaCodec,
  SharedGraphStore,
  TypedCommandCodec,
  TupleTableCodec,
  DictionaryInternCodec,
  SharedSymbolTable,
  JsonPatchDeltaCodec,
  FlatStateRegister,
  BlackboardRefCodec,
  BlackboardStore,
  VALID_KINDS,
  VALID_VERDICTS,
  formatHumanAuditText,
  validateCanonicalMessage,
  hashSharedContext,
  messageToGraph,
  graphToMessage,
  edgeKey,
  scanCommandArgs,
  computeDiff,
  applyDiff,
  canonicalStringify,
  computeStateDigest,
  HEAVY_FIELDS,
  artifactHash,
  artifactPointer,
  isArtifactPointer,
  estimateTokens,
  estimateInferenceCost
};
