'use strict';

/**
 * Reproducible Benchmark Harness for Medusa Agent-to-Agent Communication Codecs (`Medusa#71`).
 *
 * Evaluates all registered codecs (`nl-baseline-v1`, `compact-json-v1`, `graph-v1`, `graph-delta-v1`, `typed-cmd-v1`,
 * `tuple-table-v1`, `dict-intern-v1`, `json-patch-v1`, `blackboard-ref-v1`) across all 10 standardized scenarios
 * and measures:
 * - Efficiency: input tokens, output tokens, cumulative multi-turn conversation tokens, wire bytes, gzip bytes,
 *   encode/decode latency (microseconds), and estimated USD inference costs.
 * - Correctness: round-trip semantic preservation score (%), constraint retention (%), conflict detection (Scenario 7),
 *   missed-update recovery (Scenario 9), and structural vs. semantic hallucination scrutiny (Scenario 10).
 * - Operational reliability: schema validation, backward-compatible humanAuditText presence, and unknown-codec fallback.
 */

const zlib = require('zlib');
const {
  CodecRegistry,
  SharedGraphStore,
  SharedSymbolTable,
  FlatStateRegister,
  BlackboardStore,
  estimateTokens,
  estimateInferenceCost,
  validateCanonicalMessage
} = require('../../src/medusa/experiments/codecs');
const { BENCHMARK_SCENARIOS } = require('./scenarios');

/**
 * Constructs the per-codec shared-state objects a given codec's `encode`/`decode` context
 * expects, keyed by the exact property name each codec reads (`senderStore`/`receiverStore`,
 * `senderTable`/`receiverTable`, or a single shared `store`). Stateless codecs (`nl-baseline-v1`,
 * `compact-json-v1`, `typed-cmd-v1`, `graph-v1`, `tuple-table-v1`) get an empty object; the extra
 * keys are harmless no-ops for every codec that doesn't read them.
 *
 * @param {string} codecId - A registered codec's `capabilities().id`.
 * @returns {object} Context fragment to spread into both the `encode()` and `decode()` calls.
 */
function createCodecState(codecId) {
  switch (codecId) {
    case 'graph-delta-v1':
      return { senderStore: new SharedGraphStore(), receiverStore: new SharedGraphStore() };
    case 'json-patch-v1':
      return { senderStore: new FlatStateRegister(), receiverStore: new FlatStateRegister() };
    case 'dict-intern-v1':
      return { senderTable: new SharedSymbolTable(), receiverTable: new SharedSymbolTable() };
    case 'blackboard-ref-v1':
      return { store: new BlackboardStore() };
    default:
      return {};
  }
}

const CANONICAL_FIELDS = [
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
  'status',
  'verdict',
  'tests',
  'round',
  'turn',
  'summary',
  'scope',
  'constraints',
  'dependencies',
  'findings',
  'assignments',
  'sharedContext'
];

/**
 * Computes field-by-field semantic preservation between an original canonical message
 * and a decoded canonical message.
 *
 * @param {object} expected - Original canonical message.
 * @param {object} actual - Decoded canonical message.
 * @returns {{ matchedFields: number, totalFields: number, scorePct: number, mismatches: string[], constraintsPreserved: boolean }}
 */
function measureSemanticPreservation(expected, actual) {
  if (!actual || typeof actual !== 'object') {
    return {
      matchedFields: 0,
      totalFields: 1,
      scorePct: 0,
      mismatches: ['Decoded message is null or non-object'],
      constraintsPreserved: false
    };
  }

  let matchedFields = 0;
  let totalFields = 0;
  const mismatches = [];

  for (const field of CANONICAL_FIELDS) {
    if (expected[field] !== undefined) {
      totalFields += 1;
      const expJson = JSON.stringify(expected[field]);
      const actJson = JSON.stringify(actual[field]);
      if (expJson === actJson) {
        matchedFields += 1;
      } else {
        mismatches.push(`Field "${field}" mismatch: expected ${expJson}, got ${actJson}`);
      }
    }
  }

  const constraintsPreserved =
    expected.constraints === undefined ||
    JSON.stringify(expected.constraints) === JSON.stringify(actual.constraints);

  const scorePct = totalFields === 0 ? 100 : Number(((matchedFields / totalFields) * 100).toFixed(2));
  return {
    matchedFields,
    totalFields,
    scorePct,
    mismatches,
    constraintsPreserved
  };
}

/**
 * Runs a single scenario against a single codec and returns detailed per-scenario metrics.
 *
 * @param {object} codec - Instance of BaseCodec.
 * @param {object} scenario - Scenario definition from `BENCHMARK_SCENARIOS`.
 * @returns {object}
 */
function runScenarioWithCodec(codec, scenario) {
  const codecId = codec.capabilities().id;
  const state = createCodecState(codecId);
  const knownContextDigests = new Set();
  const contextCache = new Map();

  let sumOutputTokens = 0;
  let sumInputTokens = 0;
  let cumulativeConversationTokens = 0;
  let runningHistoryTokens = 0;
  let sumWireBytes = 0;
  let sumGzipBytes = 0;
  let sumEncodeUs = 0;
  let sumDecodeUs = 0;

  let totalMatchedFields = 0;
  let totalExpectedFields = 0;
  let constraintsLostCount = 0;
  let humanAuditPresentCount = 0;
  const turnDetails = [];

  for (let idx = 0; idx < scenario.messages.length; idx++) {
    const msg = scenario.messages[idx];

    const t0 = process.hrtime.bigint();
    const envelope = codec.encode(msg, {
      ...state,
      knownContextDigests,
      contextCache
    });
    const t1 = process.hrtime.bigint();

    const decoded = codec.decode(envelope, {
      ...state,
      contextCache
    });
    const t2 = process.hrtime.bigint();

    const encodeUs = Number(t1 - t0) / 1000;
    const decodeUs = Number(t2 - t1) / 1000;
    sumEncodeUs += encodeUs;
    sumDecodeUs += decodeUs;

    const tokenStats = estimateTokens(envelope.wireText);
    const gzipBytes = zlib.gzipSync(Buffer.from(envelope.wireText, 'utf8')).length;

    // Sender generates `tokenStats.tokenCount` output tokens.
    // Receiver ingests the new message PLUS accumulated thread history in multi-turn context.
    const turnOutputTokens = tokenStats.tokenCount;
    runningHistoryTokens += tokenStats.tokenCount;
    const turnInputTokens = runningHistoryTokens;

    sumOutputTokens += turnOutputTokens;
    sumInputTokens += turnInputTokens;
    cumulativeConversationTokens += turnOutputTokens + turnInputTokens;
    sumWireBytes += tokenStats.byteLength;
    sumGzipBytes += gzipBytes;

    if (typeof envelope.humanAuditText === 'string' && envelope.humanAuditText.length > 10) {
      humanAuditPresentCount += 1;
    }

    const sem = measureSemanticPreservation(msg, decoded.message);
    totalMatchedFields += sem.matchedFields;
    totalExpectedFields += sem.totalFields;
    if (!sem.constraintsPreserved) {
      constraintsLostCount += 1;
    }

    turnDetails.push({
      messageId: msg.id,
      wireBytes: tokenStats.byteLength,
      gzipBytes,
      tokens: tokenStats.tokenCount,
      encodeUs: Number(encodeUs.toFixed(2)),
      decodeUs: Number(decodeUs.toFixed(2)),
      semanticScorePct: sem.scorePct,
      mismatches: sem.mismatches
    });
  }

  // Special resilience probe for Scenario 7 (concurrent conflict detection)
  let conflictProbe = null;
  if (scenario.simulateConflict) {
    if (codecId === 'graph-delta-v1') {
      const baseStore = new SharedGraphStore();
      codec.encode(scenario.messages[0], { senderStore: baseStore });
      const laneAStore = baseStore.clone();
      const laneBStore = baseStore.clone();
      const coordinatorStore = baseStore.clone();

      const deltaA = codec.encode(scenario.messages[1], { senderStore: laneAStore });
      const deltaBStale = codec.encode(scenario.messages[2], { senderStore: laneBStore });

      const applyA = codec.decode(deltaA, { receiverStore: coordinatorStore });
      const applyBConflict = codec.decode(deltaBStale, { receiverStore: coordinatorStore });

      // Rebase Lane B onto coordinator's v2 snapshot and re-encode
      laneBStore.importSnapshot(coordinatorStore.exportSnapshot());
      const deltaBRebased = codec.encode(scenario.messages[2], { senderStore: laneBStore });
      const applyBRebased = codec.decode(deltaBRebased, { receiverStore: coordinatorStore });

      conflictProbe = {
        conflictDetectedDeterministically: !applyBConflict.ok && applyBConflict.code === 'VERSION_CONFLICT',
        conflictCode: applyBConflict.code || null,
        recoveredAfterRebase: applyA.ok && applyBRebased.ok && coordinatorStore.version === 3
      };
    } else if (codecId === 'json-patch-v1') {
      const baseStore = new FlatStateRegister();
      codec.encode(scenario.messages[0], { senderStore: baseStore });
      const laneAStore = baseStore.clone();
      const laneBStore = baseStore.clone();
      const coordinatorStore = baseStore.clone();

      const deltaA = codec.encode(scenario.messages[1], { senderStore: laneAStore });
      const deltaBStale = codec.encode(scenario.messages[2], { senderStore: laneBStore });

      const applyA = codec.decode(deltaA, { receiverStore: coordinatorStore });
      const applyBConflict = codec.decode(deltaBStale, { receiverStore: coordinatorStore });

      // Rebase Lane B onto coordinator's v2 snapshot and re-encode
      laneBStore.importSnapshot(coordinatorStore.exportSnapshot());
      const deltaBRebased = codec.encode(scenario.messages[2], { senderStore: laneBStore });
      const applyBRebased = codec.decode(deltaBRebased, { receiverStore: coordinatorStore });

      conflictProbe = {
        conflictDetectedDeterministically: !applyBConflict.ok && applyBConflict.code === 'VERSION_CONFLICT',
        conflictCode: applyBConflict.code || null,
        recoveredAfterRebase: applyA.ok && applyBRebased.ok && coordinatorStore.version === 3
      };
    } else {
      conflictProbe = {
        conflictDetectedDeterministically: false,
        conflictCode: 'STATELESS_OVERWRITE',
        recoveredAfterRebase: true
      };
    }
  }

  // Special resilience probe for Scenario 9 (disconnect & missed-update recovery)
  let disconnectProbe = null;
  if (scenario.simulateDisconnect) {
    if (codecId === 'graph-delta-v1') {
      const sStore = new SharedGraphStore();
      const rStore = new SharedGraphStore();

      const d1 = codec.encode(scenario.messages[0], { senderStore: sStore });
      codec.decode(d1, { receiverStore: rStore });

      // d2 is emitted while receiver is offline (missed)
      codec.encode(scenario.messages[1], { senderStore: sStore });

      // d3 arrives when receiver is still at v1
      const d3 = codec.encode(scenario.messages[2], { senderStore: sStore });
      const missedResult = codec.decode(d3, { receiverStore: rStore });

      // Receiver resyncs via snapshot from sStore and verifies state
      rStore.importSnapshot(sStore.exportSnapshot());
      const recoveredMsg = rStore.extractSubgraph(d3.payload.r || d3.payload.rootId);

      disconnectProbe = {
        detectedMissedUpdate: !missedResult.ok && missedResult.code === 'MISSING_BASE_VERSION',
        errorCode: missedResult.code || null,
        recoveredFidelity: recoveredMsg.nodes.length > 0 && rStore.computeDigest() === sStore.computeDigest()
      };
    } else if (codecId === 'json-patch-v1') {
      const sStore = new FlatStateRegister();
      const rStore = new FlatStateRegister();

      const d1 = codec.encode(scenario.messages[0], { senderStore: sStore });
      codec.decode(d1, { receiverStore: rStore });

      // d2 is emitted while receiver is offline (missed)
      codec.encode(scenario.messages[1], { senderStore: sStore });

      // d3 arrives when receiver is still at v1
      const d3 = codec.encode(scenario.messages[2], { senderStore: sStore });
      const missedResult = codec.decode(d3, { receiverStore: rStore });

      // Receiver resyncs via snapshot from sStore and verifies state
      rStore.importSnapshot(sStore.exportSnapshot());

      disconnectProbe = {
        detectedMissedUpdate: !missedResult.ok && missedResult.code === 'MISSING_BASE_VERSION',
        errorCode: missedResult.code || null,
        recoveredFidelity: rStore.computeDigest() === sStore.computeDigest()
      };
    } else {
      // Stateless codecs carry full state per message (or resolve @ctx from Medusa durable queue)
      disconnectProbe = {
        detectedMissedUpdate: false,
        errorCode: 'SELF_CONTAINED_MESSAGE',
        recoveredFidelity: true
      };
    }
  }

  // Special adversarial / "zero hallucinations" scrutiny for Scenario 10
  let adversarialReport = null;
  if (Array.isArray(scenario.adversarialCases)) {
    const caseResults = [];
    let schemaOnlyCaught = 0;
    let groundedValidatorCaught = 0;

    for (const adv of scenario.adversarialCases) {
      const advState = createCodecState(codecId);
      const advEnv = codec.encode(adv.message, {
        ...advState,
        knownContextDigests: new Set(),
        contextCache: new Map()
      });

      // 1. Validate WITHOUT authoritative state (pure codec schema/graph check)
      const ungroundedCheck = codec.validate(advEnv, { ...advState });
      // 2. Validate WITH authoritative state grounding
      const groundedCheck = codec.validate(advEnv, {
        ...advState,
        authoritativeState: scenario.authoritativeState
      });

      if (!ungroundedCheck.structuralValid) schemaOnlyCaught += 1;
      if (!groundedCheck.valid) groundedValidatorCaught += 1;

      caseResults.push({
        id: adv.id,
        description: adv.description,
        schemaValidAlone: ungroundedCheck.structuralValid,
        caughtBySchemaAlone: !ungroundedCheck.structuralValid,
        caughtByGroundedValidator: !groundedCheck.valid,
        structuralErrors: groundedCheck.structuralErrors,
        groundingErrors: groundedCheck.groundingErrors
      });
    }

    adversarialReport = {
      totalAdversarialCases: scenario.adversarialCases.length,
      caughtBySchemaAlone: schemaOnlyCaught,
      caughtByGroundedValidator: groundedValidatorCaught,
      cases: caseResults
    };
  }

  const semanticPreservationPct =
    totalExpectedFields === 0 ? 100 : Number(((totalMatchedFields / totalExpectedFields) * 100).toFixed(2));
  const cost = estimateInferenceCost(sumInputTokens, sumOutputTokens);

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    codecId,
    messageCount: scenario.messages.length,
    metrics: {
      outputTokens: sumOutputTokens,
      inputTokens: sumInputTokens,
      totalMultiTurnTokens: cumulativeConversationTokens,
      wireBytes: sumWireBytes,
      gzipBytes: sumGzipBytes,
      encodeLatencyUs: Number(sumEncodeUs.toFixed(2)),
      decodeLatencyUs: Number(sumDecodeUs.toFixed(2)),
      totalCpuLatencyUs: Number((sumEncodeUs + sumDecodeUs).toFixed(2)),
      estimatedCostUsd: cost,
      semanticPreservationPct,
      constraintsLostCount,
      humanAuditCoveragePct: Number(((humanAuditPresentCount / scenario.messages.length) * 100).toFixed(2))
    },
    conflictProbe,
    disconnectProbe,
    adversarialReport,
    turnDetails
  };
}

/**
 * Runs the complete 10-scenario benchmark suite across all registered codecs and aggregates comparisons
 * against the `nl-baseline-v1` control condition.
 *
 * @returns {object} Complete machine-readable benchmark report.
 */
function runFullBenchmarkSuite() {
  const registry = new CodecRegistry();
  const capabilities = registry.listCapabilities();
  const codecIds = capabilities.map((c) => c.id);

  const byCodec = {};
  for (const codecId of codecIds) {
    const codec = registry.get(codecId);
    const scenarioResults = BENCHMARK_SCENARIOS.map((sc) => runScenarioWithCodec(codec, sc));

    const totals = scenarioResults.reduce(
      (acc, r) => {
        acc.messages += r.messageCount;
        acc.outputTokens += r.metrics.outputTokens;
        acc.inputTokens += r.metrics.inputTokens;
        acc.totalMultiTurnTokens += r.metrics.totalMultiTurnTokens;
        acc.wireBytes += r.metrics.wireBytes;
        acc.gzipBytes += r.metrics.gzipBytes;
        acc.encodeLatencyUs += r.metrics.encodeLatencyUs;
        acc.decodeLatencyUs += r.metrics.decodeLatencyUs;
        acc.totalCpuLatencyUs += r.metrics.totalCpuLatencyUs;
        acc.constraintsLostCount += r.metrics.constraintsLostCount;
        acc.semanticScoreSum += r.metrics.semanticPreservationPct;
        return acc;
      },
      {
        messages: 0,
        outputTokens: 0,
        inputTokens: 0,
        totalMultiTurnTokens: 0,
        wireBytes: 0,
        gzipBytes: 0,
        encodeLatencyUs: 0,
        decodeLatencyUs: 0,
        totalCpuLatencyUs: 0,
        constraintsLostCount: 0,
        semanticScoreSum: 0
      }
    );

    const avgSemanticPreservationPct = Number((totals.semanticScoreSum / scenarioResults.length).toFixed(2));
    const estimatedCostUsd = estimateInferenceCost(totals.inputTokens, totals.outputTokens);

    byCodec[codecId] = {
      capabilities: codec.capabilities(),
      aggregate: {
        totalScenarios: scenarioResults.length,
        totalMessages: totals.messages,
        outputTokens: totals.outputTokens,
        inputTokens: totals.inputTokens,
        totalMultiTurnTokens: totals.totalMultiTurnTokens,
        wireBytes: totals.wireBytes,
        gzipBytes: totals.gzipBytes,
        encodeLatencyUs: Number(totals.encodeLatencyUs.toFixed(2)),
        decodeLatencyUs: Number(totals.decodeLatencyUs.toFixed(2)),
        totalCpuLatencyUs: Number(totals.totalCpuLatencyUs.toFixed(2)),
        avgSemanticPreservationPct,
        constraintsLostCount: totals.constraintsLostCount,
        estimatedCostUsd
      },
      scenarios: scenarioResults
    };
  }

  // Compute relative savings vs. nl-baseline-v1
  const baseline = byCodec['nl-baseline-v1'].aggregate;
  const comparisons = {};
  for (const codecId of codecIds) {
    const agg = byCodec[codecId].aggregate;
    const outputTokenSavingsPct = Number(
      (((baseline.outputTokens - agg.outputTokens) / baseline.outputTokens) * 100).toFixed(2)
    );
    const multiTurnTokenSavingsPct = Number(
      (((baseline.totalMultiTurnTokens - agg.totalMultiTurnTokens) / baseline.totalMultiTurnTokens) * 100).toFixed(2)
    );
    const wireByteSavingsPct = Number(
      (((baseline.wireBytes - agg.wireBytes) / baseline.wireBytes) * 100).toFixed(2)
    );
    const gzipByteSavingsPct = Number(
      (((baseline.gzipBytes - agg.gzipBytes) / baseline.gzipBytes) * 100).toFixed(2)
    );

    // Also inspect Scenario 8 (30-exchange sprint loop) specifically
    const baseS8 = byCodec['nl-baseline-v1'].scenarios.find((s) => s.scenarioId === 'S08-long-running-30-exchanges');
    const currS8 = byCodec[codecId].scenarios.find((s) => s.scenarioId === 'S08-long-running-30-exchanges');
    const s8TokenSavingsPct = Number(
      (
        ((baseS8.metrics.totalMultiTurnTokens - currS8.metrics.totalMultiTurnTokens) /
          baseS8.metrics.totalMultiTurnTokens) *
        100
      ).toFixed(2)
    );

    comparisons[codecId] = {
      codecId,
      outputTokens: agg.outputTokens,
      outputTokenSavingsPct,
      totalMultiTurnTokens: agg.totalMultiTurnTokens,
      multiTurnTokenSavingsPct,
      s8LongRunningTokenSavingsPct: s8TokenSavingsPct,
      wireBytes: agg.wireBytes,
      wireByteSavingsPct,
      gzipBytes: agg.gzipBytes,
      gzipByteSavingsPct,
      totalCpuLatencyUs: agg.totalCpuLatencyUs,
      avgSemanticPreservationPct: agg.avgSemanticPreservationPct,
      constraintsLostCount: agg.constraintsLostCount,
      frontierCostUsd: agg.estimatedCostUsd.frontierTierUsd
    };
  }

  return {
    benchmarkVersion: '1.0.0',
    issue: 'Jason-Vaughan/Medusa#71',
    branch: 'experiment/agent-communication-protocols',
    executionMode: 'deterministic-offline-fixtures (non-LLM)',
    tokenEstimationMethod: 'deterministic-bpe-subword-v1',
    generatedAt: new Date().toISOString(),
    comparisons,
    byCodec
  };
}

module.exports = {
  createCodecState,
  measureSemanticPreservation,
  runScenarioWithCodec,
  runFullBenchmarkSuite
};
