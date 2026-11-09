'use strict';

/**
 * Automated Test Suite for `tuple-table-v1` and `dict-intern-v1` (`Medusa#72`, Car 01-A).
 *
 * Verifies:
 * 1. `BaseCodec` contract conformance (`encode`, `decode`, `validate`, `capabilities`).
 * 2. 100% lossless round-trip semantic preservation across all 10 benchmark scenarios.
 * 3. `dict-intern-v1` symbol-interning compression (a value is sent in full only once).
 * 4. `UNRESOLVED_SYMBOL_REF` detection and symbol-table snapshot sync/resync.
 * 5. Malformed input rejection for both codecs.
 */

const { BaseCodec } = require('./BaseCodec');
const { TupleTableCodec } = require('./TupleTableCodec');
const { DictionaryInternCodec, SharedSymbolTable } = require('./DictionaryInternCodec');
const { BENCHMARK_SCENARIOS } = require('../../../../benchmarks/agent-communication/scenarios');

const ALL_MESSAGES = BENCHMARK_SCENARIOS.flatMap((scenario) => scenario.messages);

describe('TupleTableCodec and DictionaryInternCodec (Issue #72)', () => {
  describe('1. BaseCodec contract conformance', () => {
    test('TupleTableCodec reports complete capabilities', () => {
      const codec = new TupleTableCodec();
      const caps = codec.capabilities();
      expect(caps.id).toBe('tuple-table-v1');
      expect(caps.schemaVersion).toBe('1.0.0');
      expect(caps.losslessRoundTrip).toBe(true);
      expect(codec).toBeInstanceOf(BaseCodec);
    });

    test('DictionaryInternCodec reports complete capabilities', () => {
      const codec = new DictionaryInternCodec();
      const caps = codec.capabilities();
      expect(caps.id).toBe('dict-intern-v1');
      expect(caps.schemaVersion).toBe('1.0.0');
      expect(caps.losslessRoundTrip).toBe(true);
      expect(caps.requiresSharedState).toBe(true);
      expect(codec).toBeInstanceOf(BaseCodec);
    });
  });

  describe('2. TupleTableCodec lossless round-trip', () => {
    test(`round-trips all ${ALL_MESSAGES.length} benchmark messages across Scenarios 1-10`, () => {
      const codec = new TupleTableCodec();
      expect(ALL_MESSAGES.length).toBeGreaterThan(0);

      for (const message of ALL_MESSAGES) {
        const envelope = codec.encode(message);
        const decoded = codec.decode(envelope);
        expect(decoded.ok).toBe(true);
        expect(decoded.message).toEqual(message);
      }
    });

    test('round-trips a message containing an empty findings array distinctly from an absent one', () => {
      const codec = new TupleTableCodec();

      const withEmptyFindings = { kind: 'review.findings', from: 'Medusa-PRR', to: 'Medusa-PM', verdict: 'PASS', findings: [] };
      const decodedEmpty = codec.decode(codec.encode(withEmptyFindings));
      expect(decodedEmpty.ok).toBe(true);
      expect(decodedEmpty.message.findings).toEqual([]);

      const withoutFindings = { kind: 'task.ack', from: 'Medusa-Lane-A', to: 'Medusa-PM' };
      const decodedAbsent = codec.decode(codec.encode(withoutFindings));
      expect(decodedAbsent.ok).toBe(true);
      expect(decodedAbsent.message).not.toHaveProperty('findings');
    });

    test('decodes a wire string produced from the envelope payload directly', () => {
      const codec = new TupleTableCodec();
      const message = ALL_MESSAGES[0];
      const envelope = codec.encode(message);
      const decoded = codec.decode(envelope.wireText);
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });

    test('preserves field values containing every structural delimiter character', () => {
      const codec = new TupleTableCodec();
      const message = {
        kind: 'state.update',
        from: 'Medusa-Lane-A',
        to: 'Medusa-PM',
        summary: 'Pipes | semicolons ; colons : commas , tildes ~ and backslashes \\ all survive.',
        scope: ['a|b;c:d,e~f\\g'],
        findings: [{ id: 'F1', severity: 'low', file: 'x:y|z', line: 1, summary: 'edge;case~here' }]
      };
      const decoded = codec.decode(codec.encode(message));
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });

    test('preserves non-array, non-tabular overflow fields unknown to the schema', () => {
      const codec = new TupleTableCodec();
      const message = { kind: 'task.assign', from: 'Medusa-PM', to: 'Medusa-Lane-A', futureField: { nested: true, n: 3 } };
      const decoded = codec.decode(codec.encode(message));
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });

    test.each([
      ['null', null],
      ['a plain object', { unexpected: 'shape' }],
      ['a string', 'oops-not-an-array']
    ])('round-trips a non-array findings value (%s) without coercing it to []', (_label, value) => {
      const codec = new TupleTableCodec();
      const message = { kind: 'review.findings', from: 'Medusa-PRR', to: 'Medusa-PM', verdict: 'PASS', findings: value };
      const decoded = codec.decode(codec.encode(message));
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });

    test('round-trips a non-array assignments value (null) without coercing it to []', () => {
      const codec = new TupleTableCodec();
      const message = { kind: 'task.assign', from: 'Medusa-PM', to: 'Medusa-Lane-A', assignments: null };
      const decoded = codec.decode(codec.encode(message));
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });
  });

  describe('3. TupleTableCodec malformed input rejection', () => {
    test('rejects a wire string missing the schema prefix', () => {
      const codec = new TupleTableCodec();
      const decoded = codec.decode('not-a-tuple-record');
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Invalid or missing/);
    });

    test('rejects a record with the wrong slot count', () => {
      const codec = new TupleTableCodec();
      const decoded = codec.decode('@tuple-v1|only|two|slots');
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Malformed TupleTableCodec record/);
    });

    test('rejects an envelope with neither a string payload nor a wireText', () => {
      const codec = new TupleTableCodec();
      const decoded = codec.decode({ codec: 'tuple-table-v1' });
      expect(decoded.ok).toBe(false);
    });

    test('BaseCodec.validate surfaces decode failure without throwing', () => {
      const codec = new TupleTableCodec();
      const result = codec.validate('garbage');
      expect(result.valid).toBe(false);
      expect(result.structuralValid).toBe(false);
    });
  });

  describe('4. DictionaryInternCodec lossless round-trip and interning', () => {
    test(`round-trips all ${ALL_MESSAGES.length} benchmark messages using independent sender/receiver symbol tables`, () => {
      const codec = new DictionaryInternCodec();
      // Independent tables (not one table reused for both sides) so the receiver can only
      // ever learn a value through the wire's `newSymbols`, genuinely exercising delivery
      // across the full corpus rather than trivially hitting an already-populated table.
      const senderTable = new SharedSymbolTable();
      const receiverTable = new SharedSymbolTable();

      for (const message of ALL_MESSAGES) {
        const envelope = codec.encode(message, { senderTable });
        const decoded = codec.decode(envelope, { receiverTable });
        expect(decoded.ok).toBe(true);
        expect(decoded.message).toEqual(message);
      }
    });

    test('interns a repeated workspace name only once across two messages', () => {
      const codec = new DictionaryInternCodec();
      const senderTable = new SharedSymbolTable();

      const first = { kind: 'task.assign', from: 'Medusa-PM', to: 'Medusa-Lane-A', repository: 'Jason-Vaughan/Medusa' };
      const second = { kind: 'task.ack', from: 'Medusa-Lane-A', to: 'Medusa-PM', repository: 'Jason-Vaughan/Medusa' };

      const envelope1 = codec.encode(first, { senderTable });
      expect(envelope1.metadata.newSymbolCount).toBe(3); // Medusa-PM, Medusa-Lane-A, Jason-Vaughan/Medusa

      const envelope2 = codec.encode(second, { senderTable });
      expect(envelope2.metadata.newSymbolCount).toBe(0); // all three values already interned
      expect(envelope2.payload.newSymbols).toEqual([]);
    });

    test('compresses repeated file paths in scope arrays into $ref tokens', () => {
      const codec = new DictionaryInternCodec();
      const senderTable = new SharedSymbolTable();
      const message = {
        kind: 'state.update',
        from: 'Medusa-Lane-A',
        to: 'Medusa-PM',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js']
      };

      codec.encode(message, { senderTable });
      const secondEnvelope = codec.encode(message, { senderTable });
      expect(secondEnvelope.metadata.newSymbolCount).toBe(0);
      expect(secondEnvelope.payload.body.scope).toEqual([{ $ref: 2 }, { $ref: 3 }]);
    });

    test('returns UNRESOLVED_SYMBOL_REF when decoding against a table missing a referenced token', () => {
      const codec = new DictionaryInternCodec();
      const senderTable = new SharedSymbolTable();
      const message = { kind: 'task.assign', from: 'Medusa-PM', to: 'Medusa-Lane-A' };

      const envelope = codec.encode(message, { senderTable });
      // Decode against a table that never received the newSymbols (simulates dropping them).
      const strippedPayload = { v: 1, body: envelope.payload.body, newSymbols: [] };
      const decoded = codec.decode(strippedPayload, { receiverTable: new SharedSymbolTable() });

      expect(decoded.ok).toBe(false);
      expect(decoded.code).toBe('UNRESOLVED_SYMBOL_REF');
      expect(decoded.errors[0]).toMatch(/UNRESOLVED_SYMBOL_REF/);
    });

    test('supports symbol-table snapshot sync for a reconnecting receiver', () => {
      const codec = new DictionaryInternCodec();
      const senderTable = new SharedSymbolTable();

      const first = { kind: 'task.assign', from: 'Medusa-PM', to: 'Medusa-Lane-A' };
      codec.encode(first, { senderTable });

      // A fresh receiver reconnects and resyncs wholesale from a snapshot instead of replaying history.
      const receiverTable = new SharedSymbolTable();
      receiverTable.importSnapshot(senderTable.exportSnapshot());

      const second = { kind: 'task.ack', from: 'Medusa-Lane-A', to: 'Medusa-PM' };
      const envelope2 = codec.encode(second, { senderTable });
      const decoded2 = codec.decode(envelope2, { receiverTable });

      expect(decoded2.ok).toBe(true);
      expect(decoded2.message).toEqual(second);
    });

    test('round-trips a literal {$ref: n} object in message data without misinterpreting it as a symbol reference', () => {
      const codec = new DictionaryInternCodec();
      const table = new SharedSymbolTable();
      const message = {
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-A',
        weirdPayload: { $ref: 0 }
      };

      const decoded = codec.decode(codec.encode(message, { senderTable: table }), { receiverTable: table });
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });

    test('round-trips a literal {$esc: ...} object in message data', () => {
      const codec = new DictionaryInternCodec();
      const table = new SharedSymbolTable();
      const message = {
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-A',
        weirdPayload: { $esc: 'already-escaped-looking' }
      };

      const decoded = codec.decode(codec.encode(message, { senderTable: table }), { receiverTable: table });
      expect(decoded.ok).toBe(true);
      expect(decoded.message).toEqual(message);
    });

    test('rejects decode with SYMBOL_CONFLICT when the wire newSymbols disagrees with an already-known token', () => {
      const codec = new DictionaryInternCodec();
      const receiverTable = new SharedSymbolTable();
      receiverTable.seed(0, 'Medusa-PRR');

      const conflictingPayload = {
        v: 1,
        body: { kind: 'task.assign', from: { $ref: 0 }, to: 'Medusa-Lane-A' },
        newSymbols: [[0, 'Totally-Different-Value']]
      };

      const decoded = codec.decode(conflictingPayload, { receiverTable });
      expect(decoded.ok).toBe(false);
      expect(decoded.code).toBe('SYMBOL_CONFLICT');
      expect(decoded.errors[0]).toMatch(/SYMBOL_CONFLICT/);
    });

    test('rejects decode with SYMBOL_CONFLICT when the wire newSymbols claims a new token for an already-interned value', () => {
      const codec = new DictionaryInternCodec();
      const receiverTable = new SharedSymbolTable();
      receiverTable.seed(7, 'Medusa-PM');

      const conflictingPayload = {
        v: 1,
        body: { kind: 'task.assign', from: { $ref: 3 }, to: 'Medusa-Lane-A' },
        newSymbols: [[3, 'Medusa-PM']]
      };

      const decoded = codec.decode(conflictingPayload, { receiverTable });
      expect(decoded.ok).toBe(false);
      expect(decoded.code).toBe('SYMBOL_CONFLICT');
      expect(decoded.errors[0]).toMatch(/SYMBOL_CONFLICT/);
    });

    test('rolls a rejected newSymbols batch back atomically, leaving the receiver table untouched', () => {
      const codec = new DictionaryInternCodec();
      const receiverTable = new SharedSymbolTable();

      // Self-conflicting batch: token 0 is first seeded as 'A', then immediately contradicted by 'B'.
      const rejectedBatch = {
        v: 1,
        body: { kind: 'task.assign', from: { $ref: 0 }, to: 'Medusa-Lane-A' },
        newSymbols: [
          [0, 'A'],
          [0, 'B']
        ]
      };

      const firstAttempt = codec.decode(rejectedBatch, { receiverTable });
      expect(firstAttempt.ok).toBe(false);
      expect(firstAttempt.code).toBe('SYMBOL_CONFLICT');
      // The rejected batch must not have left token 0 seeded as 'A' behind.
      expect(receiverTable.resolve(0)).toBeUndefined();
      expect(receiverTable.size()).toBe(0);

      // A later, legitimately-ordered frame mapping token 0 to 'B' must still succeed.
      const validFrame = {
        v: 1,
        body: { kind: 'task.ack', from: { $ref: 0 }, to: 'Medusa-PM' },
        newSymbols: [[0, 'B']]
      };
      const secondAttempt = codec.decode(validFrame, { receiverTable });
      expect(secondAttempt.ok).toBe(true);
      expect(secondAttempt.message.from).toBe('B');
    });

    test('SharedSymbolTable.clone produces an independent copy', () => {
      const table = new SharedSymbolTable();
      table.intern('Medusa-PM');
      const clone = table.clone();
      clone.intern('Medusa-Lane-A');
      expect(table.size()).toBe(1);
      expect(clone.size()).toBe(2);
    });
  });

  describe('5. DictionaryInternCodec malformed input rejection', () => {
    test('rejects invalid JSON wire text', () => {
      const codec = new DictionaryInternCodec();
      const decoded = codec.decode('{not-json');
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Invalid JSON/);
    });

    test('rejects a payload with the wrong schema version', () => {
      const codec = new DictionaryInternCodec();
      const decoded = codec.decode({ v: 2, body: {}, newSymbols: [] });
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Unsupported or malformed/);
    });

    test('rejects a payload missing a body', () => {
      const codec = new DictionaryInternCodec();
      const decoded = codec.decode({ v: 1, newSymbols: [] });
      expect(decoded.ok).toBe(false);
    });

    test('BaseCodec.validate surfaces decode failure without throwing', () => {
      const codec = new DictionaryInternCodec();
      const result = codec.validate('{not-json');
      expect(result.valid).toBe(false);
      expect(result.structuralValid).toBe(false);
    });
  });
});
