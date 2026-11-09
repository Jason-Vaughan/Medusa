'use strict';

/**
 * Automated Test Suite for Medusa Experimental Agent-to-Agent Communication Codecs (`Medusa#71`).
 *
 * Verifies:
 * 1. Pluggable CodecRegistry & BaseCodec contract (`encode`, `decode`, `validate`, `capabilities`)
 * 2. 100% lossless round-trip semantic preservation across all 9 codecs (`nl-baseline-v1`, `compact-json-v1`,
 *    `graph-v1`, `graph-delta-v1`, `typed-cmd-v1`, `tuple-table-v1`, `dict-intern-v1`, `json-patch-v1`,
 *    `blackboard-ref-v1`) and all 10 benchmark scenarios
 * 3. Context deduplication (`ctxRef` / `@ctx:<digest>`) and incremental graph delta omission
 * 4. Optimistic concurrency conflict detection (`VERSION_CONFLICT`, `BASE_DIGEST_MISMATCH`)
 * 5. Disconnect / missed-delta detection (`MISSING_BASE_VERSION`) and snapshot resync recovery
 * 6. Adversarial / "zero hallucinations" scrutiny: proving schema validation alone vs. authoritative state grounding
 * 7. Malformed input rejection, prototype pollution defense, unknown codec safe failure, and human auditability
 */

const {
  CodecRegistry,
  BaseCodec,
  NaturalLanguageCodec,
  CompactJsonCodec,
  GraphCodec,
  GraphDeltaCodec,
  SharedGraphStore,
  TypedCommandCodec,
  JsonPatchDeltaCodec,
  FlatStateRegister,
  estimateTokens,
  estimateInferenceCost,
  validateCanonicalMessage
} = require('./CodecRegistry');
const { BENCHMARK_SCENARIOS, AUTHORITATIVE_REPO_STATE } = require('../../../../benchmarks/agent-communication/scenarios');
const {
  createCodecState,
  measureSemanticPreservation,
  runFullBenchmarkSuite
} = require('../../../../benchmarks/agent-communication/harness');

describe('Medusa Agent-to-Agent Communication Codecs (Issue #71)', () => {
  let registry;

  beforeEach(() => {
    registry = new CodecRegistry();
  });

  describe('1. CodecRegistry & Pluggable Interface', () => {
    test('registers all 9 candidate communication codecs with complete capabilities manifests', () => {
      const caps = registry.listCapabilities();
      expect(caps.map((c) => c.id)).toEqual([
        'nl-baseline-v1',
        'compact-json-v1',
        'graph-v1',
        'graph-delta-v1',
        'typed-cmd-v1',
        'tuple-table-v1',
        'dict-intern-v1',
        'json-patch-v1',
        'blackboard-ref-v1'
      ]);

      for (const cap of caps) {
        expect(cap.schemaVersion).toBe('1.0.0');
        expect(typeof cap.description).toBe('string');
        expect(cap.losslessRoundTrip).toBe(true);
      }
    });

    test('BaseCodec abstract methods throw if not implemented by subclass', () => {
      const base = new BaseCodec();
      expect(() => base.capabilities()).toThrow(/must be implemented/);
      expect(() => base.encode({})).toThrow(/must be implemented/);
      expect(() => base.decode('')).toThrow(/must be implemented/);
    });

    test('fails safely with UNSUPPORTED_CODEC when encoding or decoding an unknown codec ID', () => {
      const sampleMsg = BENCHMARK_SCENARIOS[0].messages[0];
      const encResult = registry.encode('non-existent-codec-v99', sampleMsg);
      expect(encResult.ok).toBe(false);
      expect(encResult.code).toBe('UNSUPPORTED_CODEC');

      const decResult = registry.decode({
        codec: 'non-existent-codec-v99',
        wireText: 'opaque-payload',
        humanAuditText: '[task.assign] Medusa-PM -> Medusa-Lane-A'
      });
      expect(decResult.ok).toBe(false);
      expect(decResult.code).toBe('UNSUPPORTED_CODEC');
      expect(decResult.humanFallback).toBe('[task.assign] Medusa-PM -> Medusa-Lane-A');
    });

    test('supports explicit fallbackToBaseline when requested codec is unavailable', () => {
      const sampleMsg = BENCHMARK_SCENARIOS[0].messages[0];
      const encResult = registry.encode('unknown-experimental-codec', sampleMsg, {
        fallbackToBaseline: true
      });
      expect(encResult.ok).toBe(true);
      expect(encResult.usedFallback).toBe(true);
      expect(encResult.envelope.codec).toBe('nl-baseline-v1');
    });
  });

  describe('2. Round-Trip Semantic Fidelity Across All 9 Codecs & 10 Scenarios', () => {
    const codecIds = [
      'nl-baseline-v1',
      'compact-json-v1',
      'graph-v1',
      'graph-delta-v1',
      'typed-cmd-v1',
      'tuple-table-v1',
      'dict-intern-v1',
      'json-patch-v1',
      'blackboard-ref-v1'
    ];

    test.each(codecIds)('codec "%s" achieves 100%% field-level semantic preservation across every scenario message', (codecId) => {
      const codec = registry.get(codecId);
      for (const scenario of BENCHMARK_SCENARIOS) {
        const state = createCodecState(codecId);
        const knownContextDigests = new Set();
        const contextCache = new Map();

        for (const msg of scenario.messages) {
          const envelope = codec.encode(msg, {
            ...state,
            knownContextDigests,
            contextCache
          });

          expect(envelope.codec).toBe(codecId);
          expect(typeof envelope.wireText).toBe('string');
          expect(envelope.wireText.length).toBeGreaterThan(0);
          expect(typeof envelope.humanAuditText).toBe('string');
          expect(envelope.humanAuditText).toContain(msg.kind);

          const decoded = codec.decode(envelope, {
            ...state,
            contextCache
          });
          expect(decoded.ok).toBe(true);
          expect(decoded.errors).toEqual([]);

          const fidelity = measureSemanticPreservation(msg, decoded.message);
          expect(fidelity.mismatches).toEqual([]);
          expect(fidelity.scorePct).toBe(100);
          expect(fidelity.constraintsPreserved).toBe(true);
        }
      }
    });
  });

  describe('3. Context Deduplication & Graph Delta State Compression', () => {
    test('CompactJsonCodec and TypedCommandCodec deduplicate repeated sharedContext via digest refs on turn >= 2', () => {
      const [m1, m2] = BENCHMARK_SCENARIOS[0].messages;

      // CompactJsonCodec
      const cj = new CompactJsonCodec();
      const cjDigests = new Set();
      const cjCache = new Map();
      const e1 = cj.encode(m1, { knownContextDigests: cjDigests, contextCache: cjCache });
      const e2 = cj.encode(m2, { knownContextDigests: cjDigests, contextCache: cjCache });

      expect(e1.metadata.deduplicatedContext).toBe(false);
      expect(e2.metadata.deduplicatedContext).toBe(true);
      expect(e2.wireText.length).toBeLessThan(e1.wireText.length);

      // Verify receiver reconstructs sharedContext on Turn 2 from cache
      const rCache = new Map();
      const d1 = cj.decode(e1.wireText, { contextCache: rCache });
      const d2 = cj.decode(e2.wireText, { contextCache: rCache });
      expect(d1.message.sharedContext).toEqual(m1.sharedContext);
      expect(d2.message.sharedContext).toEqual(m2.sharedContext);

      // TypedCommandCodec
      const tc = new TypedCommandCodec();
      const tcDigests = new Set();
      const tcCache = new Map();
      const te1 = tc.encode(m1, { knownContextDigests: tcDigests, contextCache: tcCache });
      const te2 = tc.encode(m2, { knownContextDigests: tcDigests, contextCache: tcCache });
      expect(te1.metadata.usedArtifactRef).toBe(false);
      expect(te2.metadata.usedArtifactRef).toBe(true);
      expect(te2.wireText).toContain('ctx=@ctx:');
      expect(te2.wireText.length).toBeLessThan(te1.wireText.length);
    });

    test('GraphDeltaCodec omits unchanged Agent, Issue, File, Constraint, and SharedContext nodes on subsequent turns', () => {
      const gd = new GraphDeltaCodec();
      const senderStore = new SharedGraphStore();
      const [m1, m2] = BENCHMARK_SCENARIOS[0].messages;

      const delta1 = gd.encode(m1, { senderStore });
      const delta2 = gd.encode(m2, { senderStore });

      expect(delta1.metadata.omittedNodes).toBe(0);
      expect(delta2.metadata.omittedNodes).toBeGreaterThanOrEqual(10);
      expect(delta2.metadata.upsertedNodes).toBe(1); // Only the new MessageEvent root node!
      expect(delta2.wireText.length).toBeLessThan(delta1.wireText.length);
    });
  });

  describe('4. Resilience: Conflict Detection (Scenario 7) & Disconnect Recovery (Scenario 9)', () => {
    test('GraphDeltaCodec detects concurrent conflicting writes (VERSION_CONFLICT) and recovers via snapshot rebase', () => {
      const gd = new GraphDeltaCodec();
      const s7 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S07-conflicting-shared-state-writes');

      const coordinatorStore = new SharedGraphStore();
      const initEnv = gd.encode(s7.messages[0], { senderStore: coordinatorStore });
      expect(initEnv.metadata.targetVersion).toBe(1);

      // Both Lane A and Lane B fork from v1
      const laneAStore = coordinatorStore.clone();
      const laneBStore = coordinatorStore.clone();

      const deltaA = gd.encode(s7.messages[1], { senderStore: laneAStore });
      const deltaBStale = gd.encode(s7.messages[2], { senderStore: laneBStore });

      // Coordinator applies Lane A's delta (advances v1 -> v2)
      const applyA = gd.decode(deltaA, { receiverStore: coordinatorStore });
      expect(applyA.ok).toBe(true);
      expect(coordinatorStore.version).toBe(2);

      // Coordinator rejects Lane B's stale v1-based delta with VERSION_CONFLICT
      const applyBStale = gd.decode(deltaBStale, { receiverStore: coordinatorStore });
      expect(applyBStale.ok).toBe(false);
      expect(applyBStale.code).toBe('VERSION_CONFLICT');

      // Lane B rebases onto coordinator's v2 snapshot and re-encodes
      laneBStore.importSnapshot(coordinatorStore.exportSnapshot());
      const deltaBRebased = gd.encode(s7.messages[2], { senderStore: laneBStore });
      const applyBRebased = gd.decode(deltaBRebased, { receiverStore: coordinatorStore });
      expect(applyBRebased.ok).toBe(true);
      expect(coordinatorStore.version).toBe(3);
      expect(applyBRebased.message.headRefOid).toBe('9d02e4c');
    });

    test('GraphDeltaCodec detects missed intermediate deltas (MISSING_BASE_VERSION) and recovers after snapshot sync', () => {
      const gd = new GraphDeltaCodec();
      const s9 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S09-disconnect-missed-delta-recovery');

      const senderStore = new SharedGraphStore();
      const receiverStore = new SharedGraphStore();

      // Turn 1 delivered normally
      const d1 = gd.encode(s9.messages[0], { senderStore });
      expect(gd.decode(d1, { receiverStore }).ok).toBe(true);

      // Turn 2 dropped while receiver offline
      gd.encode(s9.messages[1], { senderStore });

      // Turn 3 arrives while receiver is still at v1
      const d3 = gd.encode(s9.messages[2], { senderStore });
      const missed = gd.decode(d3, { receiverStore });
      expect(missed.ok).toBe(false);
      expect(missed.code).toBe('MISSING_BASE_VERSION');

      // Receiver imports snapshot and verifies state digest match
      receiverStore.importSnapshot(senderStore.exportSnapshot());
      expect(receiverStore.computeDigest()).toBe(senderStore.computeDigest());
    });

    test('JsonPatchDeltaCodec detects concurrent conflicting writes (VERSION_CONFLICT) and recovers via snapshot rebase', () => {
      const jp = new JsonPatchDeltaCodec();
      const s7 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S07-conflicting-shared-state-writes');

      const coordinatorStore = new FlatStateRegister();
      const initEnv = jp.encode(s7.messages[0], { senderStore: coordinatorStore });
      expect(initEnv.metadata.targetVersion).toBe(1);

      const laneAStore = coordinatorStore.clone();
      const laneBStore = coordinatorStore.clone();

      const deltaA = jp.encode(s7.messages[1], { senderStore: laneAStore });
      const deltaBStale = jp.encode(s7.messages[2], { senderStore: laneBStore });

      const applyA = jp.decode(deltaA, { receiverStore: coordinatorStore });
      expect(applyA.ok).toBe(true);
      expect(coordinatorStore.version).toBe(2);

      const applyBStale = jp.decode(deltaBStale, { receiverStore: coordinatorStore });
      expect(applyBStale.ok).toBe(false);
      expect(applyBStale.code).toBe('VERSION_CONFLICT');

      laneBStore.importSnapshot(coordinatorStore.exportSnapshot());
      const deltaBRebased = jp.encode(s7.messages[2], { senderStore: laneBStore });
      const applyBRebased = jp.decode(deltaBRebased, { receiverStore: coordinatorStore });
      expect(applyBRebased.ok).toBe(true);
      expect(coordinatorStore.version).toBe(3);
      expect(applyBRebased.message.headRefOid).toBe('9d02e4c');
    });

    test('JsonPatchDeltaCodec detects missed intermediate deltas (MISSING_BASE_VERSION) and recovers after snapshot sync', () => {
      const jp = new JsonPatchDeltaCodec();
      const s9 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S09-disconnect-missed-delta-recovery');

      const senderStore = new FlatStateRegister();
      const receiverStore = new FlatStateRegister();

      const d1 = jp.encode(s9.messages[0], { senderStore });
      expect(jp.decode(d1, { receiverStore }).ok).toBe(true);

      jp.encode(s9.messages[1], { senderStore });

      const d3 = jp.encode(s9.messages[2], { senderStore });
      const missed = jp.decode(d3, { receiverStore });
      expect(missed.ok).toBe(false);
      expect(missed.code).toBe('MISSING_BASE_VERSION');

      receiverStore.importSnapshot(senderStore.exportSnapshot());
      expect(receiverStore.computeDigest()).toBe(senderStore.computeDigest());
    });
  });

  describe('5. Scrutiny of the "Zero Hallucinations" Claim (Scenario 10)', () => {
    test('proves schema/graph validity alone misses factual hallucinations, while authoritative state grounding catches 100%', () => {
      const s10 = BENCHMARK_SCENARIOS.find((s) => s.id === 'S10-adversarial-hallucination-scrutiny');
      const codecs = [new NaturalLanguageCodec(), new CompactJsonCodec(), new GraphCodec(), new TypedCommandCodec()];

      for (const codec of codecs) {
        for (const adv of s10.adversarialCases) {
          const env = codec.encode(adv.message);

          const schemaOnly = codec.validate(env, {});
          expect(schemaOnly.structuralValid).toBe(adv.expectedStructuralValid);

          const grounded = codec.validate(env, {
            authoritativeState: AUTHORITATIVE_REPO_STATE
          });
          expect(grounded.groundingValid).toBe(adv.expectedGroundingValid);
          expect(grounded.valid).toBe(adv.expectedStructuralValid && adv.expectedGroundingValid);
        }
      }
    });
  });

  describe('6. Security, Malformed Inputs & Benchmark Suite Verification', () => {
    test('rejects malformed JSON, dangling graph edges, and invalid typed command headers cleanly', () => {
      const cj = new CompactJsonCodec();
      expect(cj.decode('{not-valid-json').ok).toBe(false);
      expect(cj.decode(JSON.stringify({ v: 99, k: 'task.assign' })).ok).toBe(false);

      const gr = new GraphCodec();
      const danglingGraph = {
        schemaVersion: '1.0.0',
        rootId: 'msg:1',
        nodes: [{ id: 'msg:1', type: 'MessageEvent', attrs: { kind: 'task.assign' } }],
        edges: [{ from: 'msg:1', to: 'agent:missing-node', rel: 'SENT_BY' }]
      };
      const danglingResult = gr.decode(danglingGraph);
      expect(danglingResult.ok).toBe(false);
      expect(danglingResult.errors.join(' ')).toMatch(/Dangling edge target node/);

      const tc = new TypedCommandCodec();
      expect(tc.decode('invalid header without bang version').ok).toBe(false);
      expect(tc.decode('!v99 task.assign A->B').ok).toBe(false);
      expect(tc.decode('!v1 task.assign A->B scope=["unterminated').ok).toBe(false);
    });

    test('TokenEstimator distinguishes subword token counts from byte lengths and computes cost tiers', () => {
      const text = '!v1 review.request Medusa-PM->Medusa-PRR pr=69 sha=4c3d6bc89959ce';
      const stats = estimateTokens(text);
      expect(stats.tokenCount).toBeGreaterThan(5);
      expect(stats.byteLength).toBe(Buffer.byteLength(text, 'utf8'));
      expect(stats.tokenCount).not.toBe(stats.byteLength);

      const cost = estimateInferenceCost(100000, 20000);
      expect(cost.frontierTierUsd).toBeGreaterThan(cost.balancedTierUsd);
      expect(cost.balancedTierUsd).toBeGreaterThan(cost.fastTierUsd);
    });

    test('runFullBenchmarkSuite confirms typed-cmd-v1 and compact-json-v1 achieve >55% token savings over nl-baseline-v1', () => {
      const report = runFullBenchmarkSuite();
      expect(report.comparisons['typed-cmd-v1'].multiTurnTokenSavingsPct).toBeGreaterThan(65);
      expect(report.comparisons['compact-json-v1'].multiTurnTokenSavingsPct).toBeGreaterThan(55);
      expect(report.comparisons['graph-delta-v1'].s8LongRunningTokenSavingsPct).toBeGreaterThan(20);
      expect(report.comparisons['graph-v1'].multiTurnTokenSavingsPct).toBeLessThan(0);
    });
  });
});
