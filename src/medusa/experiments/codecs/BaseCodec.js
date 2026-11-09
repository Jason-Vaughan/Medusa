'use strict';

/**
 * Pluggable Base Codec & Canonical Semantic Grounding Validator for Medusa Communication Experiments.
 *
 * All experimental codecs implement:
 * - encode(message, context)
 * - decode(envelopeOrWireText, context)
 * - validate(envelopeOrWireText, context)
 * - capabilities()
 *
 * This module also provides deterministic semantic and grounding checks to test the hackathon
 * "zero hallucinations" hypothesis honestly: distinguishing structural schema validity from
 * ungrounded or contradictory semantic claims.
 */

const VALID_KINDS = new Set([
  'task.assign',
  'task.ack',
  'review.request',
  'review.findings',
  'decision.escalate',
  'decision.verdict',
  'dependency.notify',
  'state.update',
  'chunk.receipt',
  'error.report'
]);

const VALID_VERDICTS = new Set(['PASS', 'ACCEPT', 'HOLD', 'REJECT', 'APPROVED', 'DEFERRED']);
const SHA_REGEX = /^[0-9a-f]{7,40}$/i;

/**
 * Generates a deterministic human-readable audit string for any canonical semantic message.
 *
 * @param {object} msg - Canonical semantic message object.
 * @returns {string} Human-inspectable one-line or compact summary.
 */
function formatHumanAuditText(msg) {
  if (!msg || typeof msg !== 'object') {
    return '[invalid-message]';
  }
  const kind = msg.kind || 'unknown';
  const from = msg.from || '?';
  const to = msg.to || '?';
  const parts = [`[${kind}] ${from} -> ${to}`];

  if (msg.id) parts.push(`id=${msg.id}`);
  if (msg.issue !== undefined) {
    parts.push(`issue=${Array.isArray(msg.issue) ? msg.issue.map((n) => `#${n}`).join(',') : `#${msg.issue}`}`);
  }
  if (msg.pr !== undefined) parts.push(`pr=#${msg.pr}`);
  if (msg.repository) parts.push(`repo=${msg.repository}`);
  if (msg.base) parts.push(`base=${msg.base}`);
  if (msg.headRefOid) parts.push(`head=${msg.headRefOid}`);
  if (msg.verdict) parts.push(`verdict=${msg.verdict}`);
  if (msg.status) parts.push(`status=${msg.status}`);
  if (msg.tests) parts.push(`tests=${msg.tests}`);
  if (Array.isArray(msg.scope) && msg.scope.length > 0) {
    parts.push(`scope=[${msg.scope.join(', ')}]`);
  }
  if (Array.isArray(msg.constraints) && msg.constraints.length > 0) {
    parts.push(`constraints=[${msg.constraints.join('; ')}]`);
  }
  if (Array.isArray(msg.findings) && msg.findings.length > 0) {
    parts.push(`findings=${msg.findings.length}`);
  }
  if (msg.summary) parts.push(`summary="${msg.summary}"`);

  return parts.join(' | ');
}

/**
 * Validates a canonical semantic message object for structural completeness and optional
 * authoritative state grounding.
 *
 * Notice the distinction:
 * - `structuralErrors`: Schema / type / required-field errors detectable by the codec alone.
 * - `groundingErrors`: Factual contradictions or hallucinated references detectable ONLY when
 *   checked against an `authoritativeState` oracle (e.g., known commits, real files, active constraints).
 *
 * @param {object} msg - Decoded canonical message object.
 * @param {object} [context={}] - Optional context containing `authoritativeState` or `requiredConstraints`.
 * @returns {{ valid: boolean, structuralValid: boolean, groundingValid: boolean, structuralErrors: string[], groundingErrors: string[], warnings: string[] }}
 */
function validateCanonicalMessage(msg, context = {}) {
  const structuralErrors = [];
  const groundingErrors = [];
  const warnings = [];

  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return {
      valid: false,
      structuralValid: false,
      groundingValid: false,
      structuralErrors: ['Message must be a non-null object'],
      groundingErrors: [],
      warnings: []
    };
  }

  if (!msg.kind || !VALID_KINDS.has(msg.kind)) {
    structuralErrors.push(`Invalid or missing message kind: "${msg.kind}"`);
  }
  if (!msg.from || typeof msg.from !== 'string') {
    structuralErrors.push('Missing required string field: "from"');
  }
  if (!msg.to || typeof msg.to !== 'string') {
    structuralErrors.push('Missing required string field: "to"');
  }

  // Kind-specific structural rules
  if (msg.kind === 'review.request') {
    if (msg.pr === undefined || msg.pr === null) {
      structuralErrors.push('review.request requires "pr" number');
    }
    if (!msg.headRefOid || !SHA_REGEX.test(String(msg.headRefOid))) {
      structuralErrors.push('review.request requires valid hex "headRefOid" (7-40 hex chars)');
    }
    if (!Array.isArray(msg.scope) || msg.scope.length === 0) {
      structuralErrors.push('review.request requires non-empty "scope" array');
    }
  }

  if (msg.kind === 'review.findings' || msg.kind === 'decision.verdict') {
    if (!msg.verdict || !VALID_VERDICTS.has(String(msg.verdict))) {
      structuralErrors.push(`${msg.kind} requires valid "verdict" (${Array.from(VALID_VERDICTS).join('|')})`);
    }
    if (msg.verdict === 'HOLD' && (!Array.isArray(msg.findings) || msg.findings.length === 0) && !msg.summary) {
      structuralErrors.push('HOLD verdict requires at least one finding or summary reason');
    }
  }

  if (msg.kind === 'chunk.receipt') {
    if (!msg.headRefOid || !SHA_REGEX.test(String(msg.headRefOid))) {
      structuralErrors.push('chunk.receipt requires valid hex "headRefOid"');
    }
    if (!msg.tests || typeof msg.tests !== 'string') {
      structuralErrors.push('chunk.receipt requires "tests" evidence string');
    }
  }

  // Grounding checks against authoritative state (when supplied by runtime or benchmark)
  const auth = context && context.authoritativeState ? context.authoritativeState : null;
  if (auth) {
    if (auth.validCommits && msg.headRefOid && !auth.validCommits.includes(msg.headRefOid)) {
      groundingErrors.push(`Hallucinated or unknown commit SHA: "${msg.headRefOid}" is not in authoritative git history`);
    }
    if (auth.validFiles && Array.isArray(msg.scope)) {
      for (const file of msg.scope) {
        if (!auth.validFiles.includes(file)) {
          groundingErrors.push(`Hallucinated file path in scope: "${file}" does not exist in repository`);
        }
      }
    }
    if (auth.actualTestResult && msg.tests && msg.tests !== auth.actualTestResult) {
      groundingErrors.push(
        `Fabricated test evidence: claimed "${msg.tests}" but authoritative runner recorded "${auth.actualTestResult}"`
      );
    }
    if (Array.isArray(auth.requiredConstraints) && auth.requiredConstraints.length > 0) {
      const presentConstraints = new Set(Array.isArray(msg.constraints) ? msg.constraints : []);
      for (const reqConstraint of auth.requiredConstraints) {
        if (!presentConstraints.has(reqConstraint)) {
          groundingErrors.push(`Lost required constraint: "${reqConstraint}"`);
        }
      }
    }
    if (auth. contradictoryVerdictCheck && msg.verdict === 'PASS' && Array.isArray(msg.findings)) {
      const hasBlocker = msg.findings.some((f) => f && (f.severity === 'blocker' || f.severity === 'high'));
      if (hasBlocker) {
        groundingErrors.push('Contradictory semantic state: verdict is "PASS" while high/blocker findings remain open');
      }
    }
  }

  const structuralValid = structuralErrors.length === 0;
  const groundingValid = groundingErrors.length === 0;

  return {
    valid: structuralValid && groundingValid,
    structuralValid,
    groundingValid,
    structuralErrors,
    groundingErrors,
    warnings
  };
}

/**
 * Abstract base class for all Medusa experimental communication codecs.
 */
class BaseCodec {
  /**
   * @param {object} [options={}] - Codec configuration options.
   */
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Returns codec identity, version, and supported capabilities.
   *
   * @returns {{ id: string, schemaVersion: string, description: string, supportsDeltas: boolean, supportsArtifactRefs: boolean, requiresSharedState: boolean, losslessRoundTrip: boolean }}
   */
  capabilities() {
    throw new Error('BaseCodec.capabilities() must be implemented by subclass');
  }

  /**
   * Encodes a canonical message into the codec's wire representation.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Optional encoding context (e.g., shared state store).
   * @returns {{ codec: string, schemaVersion: string, payload: any, wireText: string, humanAuditText: string, metadata: object }}
   */
  encode(message, context = {}) {
    throw new Error('BaseCodec.encode() must be implemented by subclass');
  }

  /**
   * Decodes a codec envelope or wire string back into a canonical semantic message.
   *
   * @param {object|string} envelopeOrWireText - Output of encode() or raw wire string.
   * @param {object} [context={}] - Optional decoding context.
   * @returns {{ ok: boolean, message: object|null, errors: string[], warnings: string[], metadata?: object }}
   */
  decode(envelopeOrWireText, context = {}) {
    throw new Error('BaseCodec.decode() must be implemented by subclass');
  }

  /**
   * Validates a codec envelope or wire string both structurally and (if context.authoritativeState
   * is provided) against authoritative state.
   *
   * @param {object|string} envelopeOrWireText - Envelope or wire text to validate.
   * @param {object} [context={}] - Optional validation context.
   * @returns {{ valid: boolean, structuralValid: boolean, groundingValid: boolean, errors: string[], structuralErrors: string[], groundingErrors: string[], warnings: string[] }}
   */
  validate(envelopeOrWireText, context = {}) {
    const decoded = this.decode(envelopeOrWireText, context);
    if (!decoded.ok || !decoded.message) {
      return {
        valid: false,
        structuralValid: false,
        groundingValid: false,
        errors: decoded.errors || ['Decode failed'],
        structuralErrors: decoded.errors || ['Decode failed'],
        groundingErrors: [],
        warnings: decoded.warnings || []
      };
    }

    const sem = validateCanonicalMessage(decoded.message, context);
    const allErrors = [...sem.structuralErrors, ...sem.groundingErrors];
    return {
      valid: sem.valid,
      structuralValid: sem.structuralValid,
      groundingValid: sem.groundingValid,
      errors: allErrors,
      structuralErrors: sem.structuralErrors,
      groundingErrors: sem.groundingErrors,
      warnings: [...(decoded.warnings || []), ...sem.warnings]
    };
  }
}

module.exports = {
  BaseCodec,
  VALID_KINDS,
  VALID_VERDICTS,
  formatHumanAuditText,
  validateCanonicalMessage
};
