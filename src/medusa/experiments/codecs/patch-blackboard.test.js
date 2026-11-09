'use strict';

/**
 * Automated Test Suite for the Flat State-Register Diff (`json-patch-v1`) and Blackboard
 * Artifact-Reference (`blackboard-ref-v1`) Communication Codecs (`Medusa#73`).
 *
 * Verifies:
 * 1. BaseCodec contract (`capabilities`, `encode`, `decode`) for both codecs.
 * 2. 100% lossless round-trip semantic preservation across all 10 benchmark scenarios and every
 *    message in `benchmarks/agent-communication/scenarios.js`.
 * 3. `computeDiff` / `applyDiff` RFC 6902 JSON Patch primitives in isolation.
 * 4. Optimistic concurrency conflict detection (`VERSION_CONFLICT`) and recovery via snapshot rebase.
 * 5. Disconnect / missed-delta detection (`MISSING_BASE_VERSION`) and recovery via snapshot sync.
 * 6. Base-state divergence detection (`BASE_HASH_MISMATCH`) and malformed-input rejection.
 * 7. Blackboard content-addressed deduplication, pointer-only token savings, and missing-artifact
 *    (`MISSING_ARTIFACT`) error handling.
 */

const { JsonPatchDeltaCodec, FlatStateRegister, computeDiff, applyDiff } = require('./JsonPatchDeltaCodec');
const { BlackboardRefCodec, BlackboardStore, HEAVY_FIELDS, isArtifactPointer } = require('./BlackboardRefCodec');
const { BENCHMARK_SCENARIOS } = require('../../../../benchmarks/agent-communication/scenarios');

describe('Flat State-Register Diff & Blackboard Artifact-Reference Codecs (Issue #73)', () => {
  describe('1. BaseCodec contract & capabilities', () => {
    test('JsonPatchDeltaCodec reports complete capabilities manifest', () => {
      const caps = new JsonPatchDeltaCodec().capabilities();
      expect(caps.id).toBe('json-patch-v1');
      expect(caps.schemaVersion).toBe('1.0.0');
      expect(caps.supportsDeltas).toBe(true);
      expect(caps.requiresSharedState).toBe(true);
      expect(caps.losslessRoundTrip).toBe(true);
    });

    test('BlackboardRefCodec reports complete capabilities manifest', () => {
      const caps = new BlackboardRefCodec().capabilities();
      expect(caps.id).toBe('blackboard-ref-v1');
      expect(caps.schemaVersion).toBe('1.0.0');
      expect(caps.supportsArtifactRefs).toBe(true);
      expect(caps.requiresSharedState).toBe(true);
      expect(caps.losslessRoundTrip).toBe(true);
    });
  });

  describe('2. Round-trip semantic fidelity across all benchmark scenarios', () => {
    const totalMessages = BENCHMARK_SCENARIOS.reduce((sum, s) => sum + (s.messages || []).length, 0);

    test('benchmark fixtures expose at least 49 scenario messages', () => {
      expect(totalMessages).toBeGreaterThanOrEqual(49);
    });

    test('JsonPatchDeltaCodec achieves lossless field-level round-trip across every scenario', () => {
      const codec = new JsonPatchDeltaCodec();

      for (const scenario of BENCHMARK_SCENARIOS) {
        const senderStore = new FlatStateRegister();
        const receiverStore = new FlatStateRegister();

        for (const msg of scenario.messages) {
          const envelope = codec.encode(msg, { senderStore });

          expect(envelope.codec).toBe('json-patch-v1');
          expect(typeof envelope.wireText).toBe('string');
          expect(envelope.wireText.length).toBeGreaterThan(0);
          expect(envelope.humanAuditText).toContain(msg.kind);

          const decoded = codec.decode(envelope, { receiverStore });
          expect(decoded.ok).toBe(true);
          expect(decoded.errors).toEqual([]);
          expect(decoded.message).toEqual(msg);
        }
      }
    });

    test('BlackboardRefCodec achieves lossless field-level round-trip across every scenario message', () => {
      const codec = new BlackboardRefCodec();
      const store = new BlackboardStore();

      for (const scenario of BENCHMARK_SCENARIOS) {
        for (const msg of scenario.messages) {
          const envelope = codec.encode(msg, { store });

          expect(envelope.codec).toBe('blackboard-ref-v1');
          expect(typeof envelope.wireText).toBe('string');
          expect(envelope.humanAuditText).toContain(msg.kind);

          const decoded = codec.decode(envelope, { store });
          expect(decoded.ok).toBe(true);
          expect(decoded.errors).toEqual([]);
          expect(decoded.message).toEqual(msg);
        }
      }
    });
  });

  describe('3. computeDiff / applyDiff RFC 6902 primitives', () => {
    test('emits "add" ops for every field when the base state is empty', () => {
      const ops = computeDiff({}, { a: 1, b: { c: 2 } });
      expect(ops).toEqual(
        expect.arrayContaining([
          { op: 'add', path: '/a', value: 1 },
          { op: 'add', path: '/b', value: { c: 2 } }
        ])
      );
      expect(applyDiff({}, ops)).toEqual({ a: 1, b: { c: 2 } });
    });

    test('emits "replace" for changed leaves, including nested objects', () => {
      const prev = { status: 'working', nested: { x: 1, y: 2 } };
      const next = { status: 'complete', nested: { x: 1, y: 3 } };
      const ops = computeDiff(prev, next);

      expect(ops).toEqual(
        expect.arrayContaining([
          { op: 'replace', path: '/status', value: 'complete' },
          { op: 'replace', path: '/nested/y', value: 3 }
        ])
      );
      expect(applyDiff(prev, ops)).toEqual(next);
    });

    test('emits "remove" for fields dropped between states', () => {
      const prev = { a: 1, b: 2 };
      const next = { a: 1 };
      const ops = computeDiff(prev, next);
      expect(ops).toEqual([{ op: 'remove', path: '/b' }]);
      expect(applyDiff(prev, ops)).toEqual(next);
    });

    test('treats arrays as atomic values rather than diffing per-index', () => {
      const prev = { scope: ['a.js', 'b.js'] };
      const next = { scope: ['a.js', 'b.js', 'c.js'] };
      const ops = computeDiff(prev, next);
      expect(ops).toEqual([{ op: 'replace', path: '/scope', value: ['a.js', 'b.js', 'c.js'] }]);
      expect(applyDiff(prev, ops)).toEqual(next);
    });

    test('produces no ops when states are identical', () => {
      const state = { a: 1, nested: { b: [1, 2, 3] } };
      expect(computeDiff(state, state)).toEqual([]);
    });

    test('escapes "~" and "/" in JSON Pointer path segments', () => {
      const ops = computeDiff({}, { 'a/b~c': 1 });
      expect(ops).toEqual([{ op: 'add', path: '/a~1b~0c', value: 1 }]);
      expect(applyDiff({}, ops)).toEqual({ 'a/b~c': 1 });
    });
  });

  describe('4. JsonPatchDeltaCodec resilience: conflict detection (Scenario 7) & disconnect recovery (Scenario 9)', () => {
    test('detects concurrent conflicting writes (VERSION_CONFLICT) and recovers via snapshot rebase', () => {
      const codec = new JsonPatchDeltaCodec();
      const s7 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S07-conflicting-shared-state-writes');

      const coordinatorStore = new FlatStateRegister();
      const initEnv = codec.encode(s7.messages[0], { senderStore: coordinatorStore });
      expect(initEnv.metadata.targetVersion).toBe(1);

      // Both Lane A and Lane B fork from v1
      const laneAStore = coordinatorStore.clone();
      const laneBStore = coordinatorStore.clone();

      const deltaA = codec.encode(s7.messages[1], { senderStore: laneAStore });
      const deltaBStale = codec.encode(s7.messages[2], { senderStore: laneBStore });

      // Coordinator applies Lane A's delta (advances v1 -> v2)
      const applyA = codec.decode(deltaA, { receiverStore: coordinatorStore });
      expect(applyA.ok).toBe(true);
      expect(coordinatorStore.version).toBe(2);

      // Coordinator rejects Lane B's stale v1-based delta with VERSION_CONFLICT
      const applyBStale = codec.decode(deltaBStale, { receiverStore: coordinatorStore });
      expect(applyBStale.ok).toBe(false);
      expect(applyBStale.code).toBe('VERSION_CONFLICT');

      // Lane B rebases onto coordinator's v2 snapshot and re-encodes
      laneBStore.importSnapshot(coordinatorStore.exportSnapshot());
      const deltaBRebased = codec.encode(s7.messages[2], { senderStore: laneBStore });
      const applyBRebased = codec.decode(deltaBRebased, { receiverStore: coordinatorStore });
      expect(applyBRebased.ok).toBe(true);
      expect(coordinatorStore.version).toBe(3);
      expect(applyBRebased.message.headRefOid).toBe('9d02e4c');
    });

    test('detects missed intermediate deltas (MISSING_BASE_VERSION) and recovers after snapshot sync', () => {
      const codec = new JsonPatchDeltaCodec();
      const s9 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S09-disconnect-missed-delta-recovery');

      const senderStore = new FlatStateRegister();
      const receiverStore = new FlatStateRegister();

      // Turn 1 delivered normally
      const d1 = codec.encode(s9.messages[0], { senderStore });
      expect(codec.decode(d1, { receiverStore }).ok).toBe(true);

      // Turn 2 dropped while receiver offline
      codec.encode(s9.messages[1], { senderStore });

      // Turn 3 arrives while receiver is still at v1
      const d3 = codec.encode(s9.messages[2], { senderStore });
      const missed = codec.decode(d3, { receiverStore });
      expect(missed.ok).toBe(false);
      expect(missed.code).toBe('MISSING_BASE_VERSION');

      // Receiver imports snapshot and verifies state digest match
      receiverStore.importSnapshot(senderStore.exportSnapshot());
      expect(receiverStore.computeDigest()).toBe(senderStore.computeDigest());
    });

    test('detects base-state divergence (BASE_HASH_MISMATCH) when a store silently drifts', () => {
      const codec = new JsonPatchDeltaCodec();
      const senderStore = new FlatStateRegister();
      const receiverStore = new FlatStateRegister();

      codec.decode(codec.encode({ status: 'working' }, { senderStore }), { receiverStore });

      // Receiver's state drifts without going through a delta (e.g. local corruption)
      receiverStore.state.status = 'tampered';

      const delta = codec.encode({ status: 'complete' }, { senderStore });
      const applied = codec.decode(delta, { receiverStore });
      expect(applied.ok).toBe(false);
      expect(applied.code).toBe('BASE_HASH_MISMATCH');
    });
  });

  describe('5. Malformed input rejection', () => {
    test('JsonPatchDeltaCodec.decode fails safely on invalid JSON wire text', () => {
      const decoded = new JsonPatchDeltaCodec().decode('{not json');
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Invalid JSON/);
    });

    test('JsonPatchDeltaCodec.decode fails safely on an unsupported schema version', () => {
      const decoded = new JsonPatchDeltaCodec().decode({ v: 99, baseVersion: 0, targetVersion: 1, ops: [] });
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Unsupported or missing schemaVersion/);
    });

    test('BlackboardRefCodec.decode fails safely on invalid JSON wire text', () => {
      const decoded = new BlackboardRefCodec().decode('{not json');
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Invalid JSON/);
    });

    test('BlackboardRefCodec.decode fails safely on an unsupported schema version', () => {
      const decoded = new BlackboardRefCodec().decode({ v: 99, fields: {} });
      expect(decoded.ok).toBe(false);
      expect(decoded.errors[0]).toMatch(/Unsupported or missing schemaVersion/);
    });
  });

  describe('6. BlackboardRefCodec content-addressed deduplication & missing-artifact handling', () => {
    test('stores each distinct heavy-field value exactly once across repeated messages', () => {
      const codec = new BlackboardRefCodec();
      const store = new BlackboardStore();
      const sharedContext = { sprintId: 'x', builders: ['a', 'b'] };

      codec.encode({ kind: 'task.assign', sharedContext, scope: ['f1.js'] }, { store });
      codec.encode({ kind: 'task.ack', sharedContext, scope: ['f1.js'] }, { store });
      codec.encode({ kind: 'task.ack', sharedContext, scope: ['f2.js'] }, { store });

      // sharedContext (identical twice) + scope ['f1.js'] (identical twice) + scope ['f2.js'] = 3 distinct artifacts
      expect(store.artifacts.size).toBe(3);
    });

    test('pointer-only routing payload is smaller than the fully dereferenced payload once content repeats', () => {
      const codec = new BlackboardRefCodec();
      const store = new BlackboardStore();
      const s3 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S03-review-findings-revision');

      // Prime the store with the first message so later ones can reference shared artifacts.
      codec.encode(s3.messages[0], { store });
      const envelope = codec.encode(s3.messages[1], { store });

      expect(envelope.metadata.pointerRoutingTokens).toBeLessThan(envelope.metadata.fullDereferencedTokens);
      for (const field of HEAVY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(envelope.payload.fields, field)) {
          expect(isArtifactPointer(envelope.payload.fields[field])).toBe(true);
        }
      }
    });

    test('fails with MISSING_ARTIFACT when a receiver has not seen the referenced artifacts', () => {
      const codec = new BlackboardRefCodec();
      const senderStore = new BlackboardStore();
      const emptyReceiverStore = new BlackboardStore();

      const envelope = codec.encode(
        { kind: 'task.assign', scope: ['a.js'], constraints: ['bind_host=127.0.0.1'] },
        { store: senderStore }
      );

      const decoded = codec.decode(envelope, { store: emptyReceiverStore });
      expect(decoded.ok).toBe(false);
      expect(decoded.code).toBe('MISSING_ARTIFACT');
      expect(decoded.errors.length).toBeGreaterThanOrEqual(2);
      expect(decoded.errors.some((e) => e.includes('"scope"'))).toBe(true);
      expect(decoded.errors.some((e) => e.includes('"constraints"'))).toBe(true);
    });

    test('succeeds once the receiver has imported a clone of the sender store', () => {
      const codec = new BlackboardRefCodec();
      const senderStore = new BlackboardStore();

      const envelope = codec.encode({ kind: 'task.assign', scope: ['a.js'] }, { store: senderStore });
      const receiverStore = senderStore.clone();

      const decoded = codec.decode(envelope, { store: receiverStore });
      expect(decoded.ok).toBe(true);
      expect(decoded.message.scope).toEqual(['a.js']);
    });
  });
});
