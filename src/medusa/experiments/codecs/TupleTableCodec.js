'use strict';

/**
 * Approach F — Schema-Bound Positional Tuple Table Codec (`tuple-table-v1`).
 *
 * Eliminates field-name tokens, quotes, braces, and colons for the common canonical message
 * shape by transmitting a fixed-position pipe-delimited record (`@tuple-v1|slot0|slot1|...`)
 * instead of a keyed object. Tabular array fields (`findings`, `assignments`) are further
 * compacted into positional sub-rows rather than full JSON objects.
 *
 * Every leaf value is protected by `escapeLeaf`/`unescapeLeaf`, which escapes the six
 * structural characters used anywhere in this format (`\\ | ; : , ~`) before it is ever
 * joined into a record. Because escaping always happens at the leaf before any join, splitting
 * a record back apart with `splitUnescaped` is unambiguous at every nesting level.
 */

const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');

const SCHEMA_ID = 'tuple-v1';
const RECORD_PREFIX = `@${SCHEMA_ID}|`;

const GENERIC_FIELD_ORDER = [
  'id',
  'kind',
  'from',
  'to',
  'repository',
  'issue',
  'pr',
  'base',
  'head',
  'headRefOid',
  'round',
  'turn',
  'status',
  'verdict',
  'tests',
  'summary',
  'scope',
  'constraints',
  'dependencies',
  'sharedContext'
];

const FINDING_FIELDS = ['id', 'severity', 'file', 'line', 'summary'];
const ASSIGNMENT_FIELDS = ['car', 'lane', 'issues', 'files'];

const KNOWN_TOP_LEVEL_FIELDS = new Set([...GENERIC_FIELD_ORDER, 'findings', 'assignments']);

const STRUCTURAL_CHARS = /[\\|;:,~]/g;
const ESCAPED_CHAR_PAIR = /\\([\\|;:,~])/g;

/**
 * Escapes every structural delimiter character (and the escape character itself) in a raw
 * string so it can be safely embedded at any nesting level of the tuple-table wire format.
 *
 * @param {string} text - Raw text to escape.
 * @returns {string} Escaped text with no unescaped structural characters.
 */
function escapeLeaf(text) {
  return text.replace(STRUCTURAL_CHARS, (ch) => `\\${ch}`);
}

/**
 * Reverses `escapeLeaf`, restoring the original structural characters.
 *
 * @param {string} text - Escaped text.
 * @returns {string} Original unescaped text.
 */
function unescapeLeaf(text) {
  return text.replace(ESCAPED_CHAR_PAIR, '$1');
}

/**
 * Splits `str` on `delimiter`, skipping any delimiter occurrence that was escaped by
 * `escapeLeaf` (preceded by a backslash). Leaves escaped sequences intact in the output pieces.
 *
 * @param {string} str - String to split.
 * @param {string} delimiter - Single-character delimiter to split on.
 * @returns {string[]} The split pieces, still carrying their own leaf-level escaping.
 */
function splitUnescaped(str, delimiter) {
  const parts = [];
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      current += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Encodes any JSON-serializable value (including `undefined`) into a single leaf slot.
 * `undefined` becomes the empty string, which is otherwise unreachable since
 * `JSON.stringify` never produces an empty string for a defined value.
 *
 * @param {*} value - Value to encode.
 * @returns {string} Leaf-safe slot text.
 */
function encodeJsonLeaf(value) {
  if (value === undefined) return '';
  return escapeLeaf(JSON.stringify(value));
}

/**
 * Decodes a leaf slot produced by `encodeJsonLeaf` back into its original value.
 *
 * @param {string} slot - Leaf slot text.
 * @returns {*} Decoded value, or `undefined` if the slot was empty.
 */
function decodeJsonLeaf(slot) {
  if (slot === undefined || slot === '') return undefined;
  return JSON.parse(unescapeLeaf(slot));
}

/**
 * Encodes one tabular sub-row object (a `findings` or `assignments` entry) into a
 * colon-joined positional record, appending any keys outside `knownKeys` as a trailing
 * JSON overflow leaf so no data is lost for unanticipated fields.
 *
 * @param {object} obj - Sub-row object to encode.
 * @param {string[]} knownKeys - Ordered positional field names for this sub-row schema.
 * @returns {string} Colon-delimited sub-row text.
 */
function encodeTabularRow(obj, knownKeys) {
  const parts = knownKeys.map((key) => encodeJsonLeaf(obj[key]));
  const overflow = {};
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) overflow[key] = obj[key];
  }
  parts.push(Object.keys(overflow).length > 0 ? encodeJsonLeaf(overflow) : '');
  return parts.join(':');
}

/**
 * Decodes one sub-row produced by `encodeTabularRow` back into an object.
 *
 * @param {string} rowText - Colon-delimited sub-row text.
 * @param {string[]} knownKeys - Ordered positional field names for this sub-row schema.
 * @returns {object} Decoded sub-row object.
 */
function decodeTabularRow(rowText, knownKeys) {
  const parts = splitUnescaped(rowText, ':');
  const obj = {};
  knownKeys.forEach((key, i) => {
    const value = decodeJsonLeaf(parts[i]);
    if (value !== undefined) obj[key] = value;
  });
  const overflowPart = parts[knownKeys.length];
  if (overflowPart) {
    const overflow = decodeJsonLeaf(overflowPart);
    if (overflow && typeof overflow === 'object') Object.assign(obj, overflow);
  }
  return obj;
}

/**
 * Encodes a tabular array field (`findings` or `assignments`) into a single slot.
 * Distinguishes an absent field (`''`), a present-but-empty array (`'A'`), a non-empty
 * array (`'A' + rows joined by ';'`), and a present value that is NOT an array (`null`, a
 * plain object, a primitive) — preserved exactly via a trailing JSON leaf (`'J' + ...`)
 * rather than silently coerced into `[]` — so round-tripping is lossless for every case.
 *
 * @param {*} value - The field's value, if present.
 * @param {string[]} knownKeys - Ordered positional field names for each sub-row.
 * @returns {string} Encoded slot text.
 */
function encodeTabularArrayField(value, knownKeys) {
  if (value === undefined) return '';
  if (!Array.isArray(value)) return `J${encodeJsonLeaf(value)}`;
  if (value.length === 0) return 'A';
  return `A${value.map((item) => encodeTabularRow(item, knownKeys)).join(';')}`;
}

/**
 * Decodes a slot produced by `encodeTabularArrayField` back into its original value.
 *
 * @param {string} slot - Encoded slot text.
 * @param {string[]} knownKeys - Ordered positional field names for each sub-row.
 * @returns {*} Decoded value, or `undefined` if the field was absent.
 */
function decodeTabularArrayField(slot, knownKeys) {
  if (slot === undefined || slot === '') return undefined;
  if (slot[0] === 'J') return decodeJsonLeaf(slot.slice(1));
  const rest = slot.slice(1);
  if (rest === '') return [];
  return splitUnescaped(rest, ';').map((row) => decodeTabularRow(row, knownKeys));
}

/**
 * Schema-bound positional tuple-table codec implementing the shared `BaseCodec` contract.
 */
class TupleTableCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'tuple-table-v1',
      schemaVersion: '1.0.0',
      description:
        'Schema-bound positional pipe-delimited records eliminating field-name/quote/brace overhead, with compact sub-row tabular encoding for findings/assignments',
      supportsDeltas: false,
      supportsArtifactRefs: false,
      requiresSharedState: false,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message into a positional tuple-table record.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Unused; present for `BaseCodec` interface parity.
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('TupleTableCodec.encode requires a message object');
    }

    const slots = GENERIC_FIELD_ORDER.map((key) => encodeJsonLeaf(message[key]));
    slots.push(encodeTabularArrayField(message.findings, FINDING_FIELDS));
    slots.push(encodeTabularArrayField(message.assignments, ASSIGNMENT_FIELDS));

    const overflow = {};
    for (const key of Object.keys(message)) {
      if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) overflow[key] = message[key];
    }
    slots.push(Object.keys(overflow).length > 0 ? encodeJsonLeaf(overflow) : '');

    const wireText = `${RECORD_PREFIX}${slots.join('|')}`;
    return {
      codec: 'tuple-table-v1',
      schemaVersion: '1.0.0',
      payload: wireText,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        slotCount: slots.length,
        byteLength: wireText.length
      }
    };
  }

  /**
   * Decodes a tuple-table record (envelope or raw wire string) back into a canonical message.
   *
   * @param {object|string} envelopeOrWireText - Output of `encode()` or a raw wire string.
   * @param {object} [context={}] - Unused; present for `BaseCodec` interface parity.
   * @returns {object}
   */
  decode(envelopeOrWireText, context = {}) {
    let wireText = null;
    if (typeof envelopeOrWireText === 'string') {
      wireText = envelopeOrWireText;
    } else if (envelopeOrWireText && typeof envelopeOrWireText === 'object') {
      if (typeof envelopeOrWireText.payload === 'string') {
        wireText = envelopeOrWireText.payload;
      } else if (typeof envelopeOrWireText.wireText === 'string') {
        wireText = envelopeOrWireText.wireText;
      }
    }

    if (typeof wireText !== 'string' || !wireText.startsWith(RECORD_PREFIX)) {
      return {
        ok: false,
        message: null,
        errors: [`Invalid or missing TupleTableCodec wire text (expected "${RECORD_PREFIX}..." prefix)`],
        warnings: []
      };
    }

    const expectedSlotCount = GENERIC_FIELD_ORDER.length + 3;
    try {
      const body = wireText.slice(RECORD_PREFIX.length);
      const slots = splitUnescaped(body, '|');

      if (slots.length !== expectedSlotCount) {
        return {
          ok: false,
          message: null,
          errors: [`Malformed TupleTableCodec record: expected ${expectedSlotCount} slots, found ${slots.length}`],
          warnings: []
        };
      }

      const message = {};
      GENERIC_FIELD_ORDER.forEach((key, i) => {
        const value = decodeJsonLeaf(slots[i]);
        if (value !== undefined) message[key] = value;
      });

      const findings = decodeTabularArrayField(slots[GENERIC_FIELD_ORDER.length], FINDING_FIELDS);
      if (findings !== undefined) message.findings = findings;

      const assignments = decodeTabularArrayField(slots[GENERIC_FIELD_ORDER.length + 1], ASSIGNMENT_FIELDS);
      if (assignments !== undefined) message.assignments = assignments;

      const overflowSlot = slots[GENERIC_FIELD_ORDER.length + 2];
      if (overflowSlot) {
        const overflow = decodeJsonLeaf(overflowSlot);
        if (overflow && typeof overflow === 'object') Object.assign(message, overflow);
      }

      return { ok: true, message, errors: [], warnings: [] };
    } catch (err) {
      return {
        ok: false,
        message: null,
        errors: [`Failed to parse TupleTableCodec record: ${err.message}`],
        warnings: []
      };
    }
  }
}

module.exports = {
  TupleTableCodec,
  escapeLeaf,
  unescapeLeaf,
  splitUnescaped,
  encodeJsonLeaf,
  decodeJsonLeaf
};
