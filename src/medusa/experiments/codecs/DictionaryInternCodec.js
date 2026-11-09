'use strict';

/**
 * Approach G — Session-Scoped Symbol-Interned Dictionary Codec (`dict-intern-v1`).
 *
 * Even after `compact-json-v1` shortens field names, the same workspace names, repository
 * slugs, file paths, and constraint strings are retransmitted in full on every turn. This
 * codec interns those recurring string values into a `SharedSymbolTable`: the first time a
 * value is seen it is sent alongside its new numeric token (`newSymbols`); every later
 * occurrence sends only a `{ $ref: token }` placeholder.
 *
 * A receiver whose table has fallen behind (missed turns, reconnect) can resync it wholesale
 * via `SharedSymbolTable#exportSnapshot()` / `#importSnapshot()` instead of replaying history.
 */

const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');

const INTERNABLE_KEYS = new Set([
  'from',
  'to',
  'repository',
  'base',
  'head',
  'scope',
  'constraints',
  'car',
  'lane',
  'files',
  'file',
  'blockedByCar',
  'sharedFile',
  'coordinator',
  'architect',
  'reviewer',
  'integrator',
  'observer',
  'builders',
  'sprintId',
  'baseBranch',
  'rulesInForce'
]);

/**
 * Session-scoped bidirectional string<->token symbol table shared between a sender and a
 * receiver to support `dict-intern-v1` encoding and decoding.
 */
class SharedSymbolTable {
  /**
   * Initializes an empty symbol table.
   */
  constructor() {
    this.valueToToken = new Map();
    this.tokenToValue = new Map();
    this.nextToken = 0;
  }

  /**
   * Returns whether `value` already has an assigned token.
   *
   * @param {string} value - Candidate string value.
   * @returns {boolean}
   */
  has(value) {
    return this.valueToToken.has(value);
  }

  /**
   * Returns the token for `value`, assigning the next sequential token if it is new.
   *
   * @param {string} value - String value to intern.
   * @returns {number} The value's token.
   */
  intern(value) {
    const existing = this.valueToToken.get(value);
    if (existing !== undefined) return existing;
    const token = this.nextToken;
    this.nextToken += 1;
    this.valueToToken.set(value, token);
    this.tokenToValue.set(token, value);
    return token;
  }

  /**
   * Resolves a token back to its original string value.
   *
   * @param {number} token - Token to resolve.
   * @returns {string|undefined} The original value, or `undefined` if the token is unknown.
   */
  resolve(token) {
    return this.tokenToValue.get(token);
  }

  /**
   * Directly registers a known `(token, value)` pair without going through the sequential
   * counter, used to seed a receiver's table from a sender's `newSymbols` or a snapshot.
   *
   * @param {number} token - Token to register.
   * @param {string} value - Value the token maps to.
   */
  seed(token, value) {
    this.tokenToValue.set(token, value);
    this.valueToToken.set(value, token);
    if (token >= this.nextToken) this.nextToken = token + 1;
  }

  /**
   * Returns the number of interned symbols.
   *
   * @returns {number}
   */
  size() {
    return this.tokenToValue.size;
  }

  /**
   * Exports a full snapshot of this table for wholesale resync by another table.
   *
   * @returns {{ nextToken: number, entries: Array<[number, string]> }}
   */
  exportSnapshot() {
    return {
      nextToken: this.nextToken,
      entries: Array.from(this.tokenToValue.entries())
    };
  }

  /**
   * Replaces this table's contents with a snapshot from `exportSnapshot()`.
   *
   * @param {{ nextToken: number, entries: Array<[number, string]> }} snapshot - Snapshot to import.
   */
  importSnapshot(snapshot) {
    this.valueToToken.clear();
    this.tokenToValue.clear();
    this.nextToken = (snapshot && snapshot.nextToken) || 0;
    for (const [token, value] of (snapshot && snapshot.entries) || []) {
      this.tokenToValue.set(token, value);
      this.valueToToken.set(value, token);
    }
  }

  /**
   * Creates an independent deep copy of this table.
   *
   * @returns {SharedSymbolTable}
   */
  clone() {
    const copy = new SharedSymbolTable();
    copy.importSnapshot(this.exportSnapshot());
    return copy;
  }
}

/**
 * Interns `value` into `table`, recording it in `newSymbols` the first time it is seen.
 *
 * @param {string} value - String value to intern.
 * @param {SharedSymbolTable} table - Table to intern into.
 * @param {Array<[number, string]>} newSymbols - Accumulator for symbols newly created this call.
 * @returns {{ $ref: number }} A reference placeholder for `value`'s token.
 */
function internValue(value, table, newSymbols) {
  const wasKnown = table.has(value);
  const token = table.intern(value);
  if (!wasKnown) newSymbols.push([token, value]);
  return { $ref: token };
}

/**
 * Recursively walks a message tree, replacing string values under `INTERNABLE_KEYS` with
 * `{ $ref: token }` placeholders. Keys outside `INTERNABLE_KEYS` are recursed into unchanged
 * so nested structures (`findings`, `assignments`, `dependencies`, `sharedContext`) are still
 * covered when they themselves carry an internable key.
 *
 * @param {*} node - Current message subtree.
 * @param {SharedSymbolTable} table - Table to intern new values into.
 * @param {Array<[number, string]>} newSymbols - Accumulator for symbols newly created this call.
 * @returns {*} The transformed subtree.
 */
function transformForEncode(node, table, newSymbols) {
  if (Array.isArray(node)) {
    return node.map((item) => transformForEncode(item, table, newSymbols));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (INTERNABLE_KEYS.has(key) && typeof value === 'string') {
        out[key] = internValue(value, table, newSymbols);
      } else if (INTERNABLE_KEYS.has(key) && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        out[key] = value.map((v) => internValue(v, table, newSymbols));
      } else {
        out[key] = transformForEncode(value, table, newSymbols);
      }
    }
    return out;
  }
  return node;
}

/**
 * Recursively walks a decoded message tree, replacing `{ $ref: token }` placeholders with
 * their resolved values. Pushes an error for any token absent from `table`.
 *
 * @param {*} node - Current encoded subtree.
 * @param {SharedSymbolTable} table - Table to resolve tokens against.
 * @param {string[]} errors - Accumulator for `UNRESOLVED_SYMBOL_REF` error messages.
 * @returns {*} The resolved subtree.
 */
function transformForDecode(node, table, errors) {
  if (Array.isArray(node)) {
    return node.map((item) => transformForDecode(item, table, errors));
  }
  if (node && typeof node === 'object') {
    if (Object.prototype.hasOwnProperty.call(node, '$ref') && Object.keys(node).length === 1) {
      const resolved = table.resolve(node.$ref);
      if (resolved === undefined) {
        errors.push(`UNRESOLVED_SYMBOL_REF: token $${node.$ref} is not present in the symbol table`);
        return undefined;
      }
      return resolved;
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = transformForDecode(value, table, errors);
    }
    return out;
  }
  return node;
}

/**
 * Session-scoped symbol-interning codec implementing the shared `BaseCodec` contract.
 */
class DictionaryInternCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'dict-intern-v1',
      schemaVersion: '1.0.0',
      description:
        'Session-scoped symbol-interning codec compressing repeated workspace names, repository slugs, file paths, and constraint strings into short numeric tokens',
      supportsDeltas: false,
      supportsArtifactRefs: false,
      requiresSharedState: true,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message, replacing recurring internable string values with symbol
   * references against `context.senderTable` (or a fresh, ephemeral table).
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Context with an optional `senderTable` (`SharedSymbolTable`).
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('DictionaryInternCodec.encode requires a message object');
    }

    const table = context.senderTable instanceof SharedSymbolTable ? context.senderTable : new SharedSymbolTable();
    const newSymbols = [];
    const body = transformForEncode(message, table, newSymbols);
    const payload = { v: 1, body, newSymbols };
    const wireText = JSON.stringify(payload);

    return {
      codec: 'dict-intern-v1',
      schemaVersion: '1.0.0',
      payload,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        newSymbolCount: newSymbols.length,
        tableSize: table.size()
      }
    };
  }

  /**
   * Decodes a `dict-intern-v1` envelope (or raw wire string) back into a canonical message,
   * resolving symbol references against `context.receiverTable` (or a fresh, ephemeral table)
   * after first seeding it with any `newSymbols` carried on the payload.
   *
   * @param {object|string} envelopeOrWireText - Output of `encode()` or a raw wire string.
   * @param {object} [context={}] - Context with an optional `receiverTable` (`SharedSymbolTable`).
   * @returns {object}
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
          errors: [`Invalid JSON in DictionaryInternCodec: ${err.message}`],
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

    if (!payload || typeof payload !== 'object' || payload.v !== 1 || typeof payload.body === 'undefined') {
      return {
        ok: false,
        message: null,
        errors: [`Unsupported or malformed DictionaryInternCodec payload (expected { v: 1, body, newSymbols })`],
        warnings: []
      };
    }

    const table = context.receiverTable instanceof SharedSymbolTable ? context.receiverTable : new SharedSymbolTable();
    for (const entry of payload.newSymbols || []) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [token, value] = entry;
      if (table.resolve(token) === undefined) {
        table.seed(token, value);
      }
    }

    const errors = [];
    const message = transformForDecode(payload.body, table, errors);

    if (errors.length > 0) {
      return {
        ok: false,
        code: 'UNRESOLVED_SYMBOL_REF',
        message: null,
        errors,
        warnings: []
      };
    }

    return { ok: true, message, errors: [], warnings: [] };
  }
}

module.exports = {
  DictionaryInternCodec,
  SharedSymbolTable
};
