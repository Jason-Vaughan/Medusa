'use strict';

/**
 * Approach E — Typed Commands & Artifact References Codec (`typed-cmd-v1`).
 *
 * Represents agent coordination actions as compact, single-line typed command expressions:
 *   `!v1 <kind> <sender>-><recipient> key=val ...`
 *
 * Designed to test whether a minimalist typed command grammar + content-addressed artifact references
 * (`@ctx:<digest>`) achieves equal or lower token cost than graph-based communication without
 * graph-specific node/edge boilerplate.
 */

const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');
const { hashSharedContext } = require('./CompactJsonCodec');

const ORDERED_ARGS = [
  ['id', 'id'],
  ['repository', 'repo'],
  ['issue', 'issue'],
  ['pr', 'pr'],
  ['base', 'base'],
  ['head', 'head'],
  ['headRefOid', 'sha'],
  ['status', 'status'],
  ['verdict', 'verdict'],
  ['tests', 'tests'],
  ['round', 'round'],
  ['turn', 'turn'],
  ['scope', 'scope'],
  ['constraints', 'constraints'],
  ['dependencies', 'deps'],
  ['findings', 'findings'],
  ['assignments', 'assign'],
  ['summary', 'sum']
];

const ARG_TO_FIELD = Object.fromEntries(ORDERED_ARGS.map(([field, arg]) => [arg, field]));

/**
 * Formats a scalar, array, or object value as a compact command argument value.
 * Bare safe tokens (numbers, hex SHAs, simple identifiers) omit quotes to save BPE tokens;
 * strings with spaces/punctuation or structured arrays/objects use JSON encoding.
 *
 * @param {any} val - Value to encode.
 * @returns {string}
 */
function encodeArgValue(val) {
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (typeof val === 'string') {
    if (/^[A-Za-z0-9._/-]+$/.test(val) && !/^(true|false|null|\d+)$/.test(val)) {
      return val;
    }
    return JSON.stringify(val);
  }
  return JSON.stringify(val);
}

/**
 * Parses a command argument value encoded by `encodeArgValue`.
 *
 * @param {string} raw - Encoded value token.
 * @param {string} fieldName - Canonical field name.
 * @returns {any}
 */
function decodeArgValue(raw, fieldName) {
  if (raw.startsWith('"') || raw.startsWith('[') || raw.startsWith('{')) {
    return JSON.parse(raw);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw) && fieldName !== 'headRefOid' && fieldName !== 'id') {
    return Number(raw);
  }
  return raw;
}

/**
 * Tokenizes key=value pairs from the tail of a `!v1 <kind> <from>-><to> ...` command line,
 * respecting quoted strings and nested JSON brackets/braces.
 *
 * @param {string} argsStr - Tail string containing `key=value` tokens.
 * @returns {{ ok: boolean, pairs: Array<{key: string, rawValue: string}>, error?: string }}
 */
function scanCommandArgs(argsStr) {
  const pairs = [];
  let i = 0;
  const n = argsStr.length;

  while (i < n) {
    while (i < n && /\s/.test(argsStr[i])) i++;
    if (i >= n) break;

    const eqIdx = argsStr.indexOf('=', i);
    if (eqIdx === -1) {
      return { ok: false, pairs: [], error: `Malformed argument near "${argsStr.slice(i, i + 30)}" (missing "=")` };
    }

    const key = argsStr.slice(i, eqIdx).trim();
    if (!/^[A-Za-z0-9_]+$/.test(key)) {
      return { ok: false, pairs: [], error: `Invalid argument key: "${key}"` };
    }

    i = eqIdx + 1;
    if (i >= n) {
      return { ok: false, pairs: [], error: `Empty value for key "${key}"` };
    }

    const startVal = i;
    const ch = argsStr[i];
    if (ch === '"' || ch === '[' || ch === '{') {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (; i < n; i++) {
        const c = argsStr[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (c === '\\' && inStr) {
          esc = true;
          continue;
        }
        if (c === '"') {
          inStr = !inStr;
          if (ch === '"' && !inStr) {
            i++;
            break;
          }
          continue;
        }
        if (!inStr) {
          if (c === '[' || c === '{') depth++;
          else if (c === ']' || c === '}') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
        }
      }
      if (inStr || depth !== 0) {
        return { ok: false, pairs: [], error: `Unterminated literal for argument "${key}"` };
      }
    } else {
      while (i < n && !/\s/.test(argsStr[i])) i++;
    }

    const rawValue = argsStr.slice(startVal, i);
    pairs.push({ key, rawValue });
  }

  return { ok: true, pairs };
}

class TypedCommandCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'typed-cmd-v1',
      schemaVersion: '1.0.0',
      description: 'Minimal typed command DSL with bare-token compression and content-addressed @ctx refs',
      supportsDeltas: false,
      supportsArtifactRefs: true,
      requiresSharedState: false,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message into a single-line typed command expression.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Optional encoding context (`knownContextDigests`, `contextCache`).
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('TypedCommandCodec.encode requires a message object');
    }

    const tokens = [`!v1`, message.kind || 'unknown', `${message.from || '?'}->${message.to || '?'}`];

    for (const [field, argName] of ORDERED_ARGS) {
      if (message[field] !== undefined) {
        tokens.push(`${argName}=${encodeArgValue(message[field])}`);
      }
    }

    let usedArtifactRef = false;
    if (message.sharedContext && typeof message.sharedContext === 'object') {
      const digest = hashSharedContext(message.sharedContext);
      const knownSet = context && context.knownContextDigests instanceof Set ? context.knownContextDigests : null;
      const contextCache = context && context.contextCache instanceof Map ? context.contextCache : null;

      if (contextCache) {
        contextCache.set(digest, message.sharedContext);
      }

      if (knownSet && knownSet.has(digest)) {
        tokens.push(`ctx=@ctx:${digest}`);
        usedArtifactRef = true;
      } else {
        tokens.push(`ctx=${JSON.stringify(message.sharedContext)}`);
        tokens.push(`ctxRef=@ctx:${digest}`);
        if (knownSet) {
          knownSet.add(digest);
        }
      }
    }

    const wireText = tokens.join(' ');
    return {
      codec: 'typed-cmd-v1',
      schemaVersion: '1.0.0',
      payload: wireText,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        usedArtifactRef
      }
    };
  }

  /**
   * Decodes a typed command string back into a canonical semantic message.
   *
   * @param {object|string} envelopeOrWireText - Envelope or command line string.
   * @param {object} [context={}] - Optional decoding context (`contextCache`).
   * @returns {object}
   */
  decode(envelopeOrWireText, context = {}) {
    const wireText =
      typeof envelopeOrWireText === 'string'
        ? envelopeOrWireText.trim()
        : envelopeOrWireText && typeof envelopeOrWireText.wireText === 'string'
          ? envelopeOrWireText.wireText.trim()
          : null;

    if (!wireText) {
      return {
        ok: false,
        message: null,
        errors: ['TypedCommandCodec.decode requires a non-empty command string'],
        warnings: []
      };
    }

    const headerMatch = wireText.match(/^!v(\d+)\s+([a-z0-9._-]+)\s+(\S+?)->(\S+?)(?:\s+(.*))?$/s);
    if (!headerMatch) {
      return {
        ok: false,
        message: null,
        errors: ['Invalid typed command header; expected "!v1 <kind> <from>-><to> [args...]"'],
        warnings: []
      };
    }

    const version = Number(headerMatch[1]);
    if (version !== 1) {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported TypedCommandCodec version: v${version}`],
        warnings: []
      };
    }

    const message = {
      kind: headerMatch[2],
      from: headerMatch[3],
      to: headerMatch[4]
    };

    const tail = headerMatch[5] || '';
    const scanned = scanCommandArgs(tail);
    if (!scanned.ok) {
      return {
        ok: false,
        message: null,
        errors: [scanned.error],
        warnings: []
      };
    }

    const warnings = [];
    let pendingCtxRef = null;

    for (const { key, rawValue } of scanned.pairs) {
      if (key === 'ctx') {
        if (rawValue.startsWith('@ctx:')) {
          const digest = rawValue.slice(5);
          const cache = context && context.contextCache instanceof Map ? context.contextCache : null;
          if (cache && cache.has(digest)) {
            message.sharedContext = cache.get(digest);
          } else {
            warnings.push(`Unresolved @ctx artifact reference: "${rawValue}"`);
          }
        } else {
          try {
            message.sharedContext = JSON.parse(rawValue);
          } catch (err) {
            return {
              ok: false,
              message: null,
              errors: [`Invalid JSON in ctx argument: ${err.message}`],
              warnings
            };
          }
        }
        continue;
      }

      if (key === 'ctxRef') {
        pendingCtxRef = rawValue.replace(/^@ctx:/, '');
        continue;
      }

      const fieldName = ARG_TO_FIELD[key];
      if (!fieldName) {
        warnings.push(`Unknown command argument key: "${key}"`);
        continue;
      }

      try {
        message[fieldName] = decodeArgValue(rawValue, fieldName);
      } catch (err) {
        return {
          ok: false,
          message: null,
          errors: [`Failed to decode argument "${key}": ${err.message}`],
          warnings
        };
      }
    }

    if (pendingCtxRef && message.sharedContext && context && context.contextCache instanceof Map) {
      context.contextCache.set(pendingCtxRef, message.sharedContext);
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
  TypedCommandCodec,
  scanCommandArgs
};
