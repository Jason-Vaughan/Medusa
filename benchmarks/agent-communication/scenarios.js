'use strict';

/**
 * Deterministic Benchmark Fixtures & 10 Standardized Multi-Agent Scenarios (`Medusa#71`).
 *
 * Each scenario supplies identical starting facts, authoritative state, and turn-by-turn messages
 * so that all 5 codecs (`nl-baseline-v1`, `compact-json-v1`, `graph-v1`, `graph-delta-v1`, `typed-cmd-v1`)
 * are evaluated on an identical playing field.
 */

const SHARED_SPRINT_CHARTER = {
  sprintId: 'medusa-v1.1-sprint-01',
  repository: 'Jason-Vaughan/Medusa',
  baseBranch: 'main',
  baseCommit: 'c360ef6',
  coordinator: 'Medusa-PM',
  architect: 'Medusa-Arc',
  reviewer: 'Medusa-PRR',
  integrator: 'Medusa-INT',
  observer: 'Medusa-Obsr',
  builders: ['Medusa-Lane-A', 'Medusa-Lane-B'],
  rulesInForce: ['Rule #256', 'Rule #282', 'Rule #294', 'Rule #340', 'Rule #341']
};

const AUTHORITATIVE_REPO_STATE = {
  validCommits: ['c360ef6', '89959ce', '4c3d6bc', '10a198a', 'f55381b', '7a91b2e', '9d02e4c', 'a11bc09'],
  validFiles: [
    'src/medusa/medusa-server.js',
    'src/medusa/medusa-server.test.js',
    'src/medusa/client/MedusaClient.js',
    'src/medusa/UpdateManager.js',
    'src/medusa/docs-parity.test.js',
    'WS_CONSUMER_CONTRACT.md',
    'CHANGELOG.md'
  ],
  actualTestResult: '15/15:252/252',
  requiredConstraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
  contradictoryVerdictCheck: true
};

/**
 * Builds the 30-exchange long-running sprint conversation for Scenario 8.
 *
 * @returns {Array<object>}
 */
function buildLongRunningExchanges() {
  const turns = [];
  for (let i = 1; i <= 30; i++) {
    const isBuilderTurn = i % 2 === 1;
    turns.push({
      id: `s8-msg-${String(i).padStart(2, '0')}`,
      kind: isBuilderTurn ? 'state.update' : 'task.ack',
      from: isBuilderTurn ? 'Medusa-Lane-A' : 'Medusa-PM',
      to: isBuilderTurn ? 'Medusa-PM' : 'Medusa-Lane-A',
      repository: 'Jason-Vaughan/Medusa',
      issue: [67, 70],
      pr: 69,
      base: 'main',
      head: 'feat/issue-67-send-idempotency',
      headRefOid: i < 15 ? 'f55381b' : '4c3d6bc',
      turn: i,
      status: i === 30 ? 'complete' : 'working',
      tests: '15/15:252/252',
      scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js', 'WS_CONSUMER_CONTRACT.md'],
      constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
      summary: isBuilderTurn
        ? `Checkpoint ${i}: verified idempotency persistence and queue handoff invariants.`
        : `Ack checkpoint ${i}: proceed with next verification step under active sprint charter.`,
      sharedContext: SHARED_SPRINT_CHARTER
    });
  }
  return turns;
}

const BENCHMARK_SCENARIOS = [
  {
    id: 'S01-task-assign-ack',
    title: 'Scenario 1: Simple Task Assignment and Acknowledgment',
    category: 'core-coordination',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's1-msg-01',
        kind: 'task.assign',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-A',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        base: 'main',
        head: 'feat/issue-67-send-idempotency',
        headRefOid: 'c360ef6',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Implement durable send idempotency and GET /messages/receipts/:idempotencyKey.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's1-msg-02',
        kind: 'task.ack',
        from: 'Medusa-Lane-A',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        base: 'main',
        head: 'feat/issue-67-send-idempotency',
        headRefOid: 'c360ef6',
        status: 'working',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Accepted Car A assignment; starting implementation on isolated branch.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S02-builder-reviewer-handoff',
    title: 'Scenario 2: Builder-to-Reviewer Formal R-Gate Handoff',
    category: 'review-protocol',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's2-msg-01',
        kind: 'chunk.receipt',
        from: 'Medusa-Lane-A',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        pr: 69,
        base: 'main',
        head: 'feat/issue-67-send-idempotency',
        headRefOid: '4c3d6bc',
        status: 'complete',
        tests: '15/15:252/252',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'PR #69 ready for R-Gate review with full test suite green.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's2-msg-02',
        kind: 'review.request',
        from: 'Medusa-PM',
        to: 'Medusa-PRR',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        pr: 69,
        base: 'main',
        head: 'feat/issue-67-send-idempotency',
        headRefOid: '4c3d6bc',
        round: 1,
        tests: '15/15:252/252',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Run Prawduct 7-Goal Critic + 4-Goal PRR review on PR #69 @ 4c3d6bc.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S03-review-findings-revision',
    title: 'Scenario 3: Review Findings (HOLD), Builder Revision, and Round 2 PASS',
    category: 'review-protocol',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's3-msg-01',
        kind: 'review.findings',
        from: 'Medusa-PRR',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        pr: 69,
        headRefOid: 'f55381b',
        round: 1,
        verdict: 'HOLD',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        findings: [
          {
            id: 'F1',
            severity: 'blocker',
            file: 'src/medusa/medusa-server.js',
            line: 1245,
            summary: 'Await saveRegistry({throwOnError:true}) before sendWebSocketMessage()'
          },
          {
            id: 'F2',
            severity: 'high',
            file: 'src/medusa/medusa-server.js',
            line: 1122,
            summary: 'Gate concurrent retries on pendingIdempotencySaves promise'
          }
        ],
        summary: 'R-Gate HOLD on PR #69: 2 durability findings require resolution.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's3-msg-02',
        kind: 'review.request',
        from: 'Medusa-PM',
        to: 'Medusa-PRR',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        pr: 69,
        base: 'main',
        head: 'feat/issue-67-send-idempotency',
        headRefOid: '4c3d6bc',
        round: 2,
        tests: '15/15:252/252',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Both F1 and F2 resolved and verified with fault-injection tests at 4c3d6bc.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's3-msg-03',
        kind: 'review.findings',
        from: 'Medusa-PRR',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: [67, 64],
        pr: 69,
        headRefOid: '4c3d6bc',
        round: 2,
        verdict: 'PASS',
        tests: '15/15:252/252',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        findings: [],
        summary: 'R-Gate PASS certified on PR #69 @ 4c3d6bc; all prior holds released.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S04-multi-agent-decomposition',
    title: 'Scenario 4: Multi-Agent Wave Decomposition Across Builders & Architect',
    category: 'planning',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's4-msg-01',
        kind: 'task.assign',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-A',
        repository: 'Jason-Vaughan/Medusa',
        issue: [66, 67],
        base: 'main',
        headRefOid: 'c360ef6',
        scope: ['src/medusa/medusa-server.js', 'src/medusa/medusa-server.test.js'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        assignments: [
          { car: 'Car-01A', lane: 'Medusa-Lane-A', issues: [66, 67], files: ['src/medusa/medusa-server.js'] },
          { car: 'Car-01B', lane: 'Medusa-Lane-B', issues: [70], files: ['src/medusa/UpdateManager.js'] }
        ],
        summary: 'Wave 1 Car-01A bundled assignment under Rule #294 (zero cross-lane file overlap).',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's4-msg-02',
        kind: 'task.assign',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-B',
        repository: 'Jason-Vaughan/Medusa',
        issue: [70],
        base: 'main',
        headRefOid: 'c360ef6',
        scope: ['src/medusa/UpdateManager.js', 'src/medusa/client/MedusaClient.js'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        assignments: [
          { car: 'Car-01A', lane: 'Medusa-Lane-A', issues: [66, 67], files: ['src/medusa/medusa-server.js'] },
          { car: 'Car-01B', lane: 'Medusa-Lane-B', issues: [70], files: ['src/medusa/UpdateManager.js'] }
        ],
        summary: 'Wave 1 Car-01B assignment on UpdateManager and client version capabilities.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S05-dependency-scheduling-negotiation',
    title: 'Scenario 5: Cross-Lane Dependency & File Collision Negotiation',
    category: 'coordination',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's5-msg-01',
        kind: 'dependency.notify',
        from: 'Medusa-Lane-B',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: 70,
        status: 'blocked',
        scope: ['src/medusa/UpdateManager.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        dependencies: [
          { blockedByCar: 'Car-01A', sharedFile: 'WS_CONSUMER_CONTRACT.md', resolution: 'sequence-after-PR-69' }
        ],
        summary: 'Issue #70 touches WS_CONSUMER_CONTRACT.md which is currently locked by Car-01A (PR #69).',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's5-msg-02',
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-B',
        repository: 'Jason-Vaughan/Medusa',
        issue: 70,
        headRefOid: 'c360ef6',
        status: 'ready',
        scope: ['src/medusa/UpdateManager.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        dependencies: [
          { blockedByCar: 'Car-01A', sharedFile: 'WS_CONSUMER_CONTRACT.md', status: 'merged-at-c360ef6' }
        ],
        summary: 'PR #69 merged at c360ef6; WS_CONSUMER_CONTRACT.md lock released for Car-01B.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S06-architect-decision-escalation',
    title: 'Scenario 6: Architectural Escalation & Binding A-Gate Verdict',
    category: 'governance',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's6-msg-01',
        kind: 'decision.escalate',
        from: 'Medusa-PM',
        to: 'Medusa-Arc',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: 'c360ef6',
        scope: ['WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Request A-Gate ruling on keeping experimental codecs opt-in inside codecEnvelope without altering msgPayload.message contract.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's6-msg-02',
        kind: 'decision.verdict',
        from: 'Medusa-Arc',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: 'c360ef6',
        verdict: 'APPROVED',
        scope: ['WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'A-Gate APPROVED: experimental codecs must remain opt-in and preserve humanAuditText and Medusa#67 idempotency.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S07-conflicting-shared-state-writes',
    title: 'Scenario 7: Concurrent Shared-State Updates with Conflict Detection & Resolution',
    category: 'resilience',
    simulateConflict: true,
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's7-msg-01',
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Lane-A',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: 'c360ef6',
        status: 'working',
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Baseline state v1 initialized for wave coordination.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's7-msg-02',
        kind: 'state.update',
        from: 'Medusa-Lane-A',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: '7a91b2e',
        status: 'complete',
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Lane A advances state from v1 -> v2.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's7-msg-03',
        kind: 'state.update',
        from: 'Medusa-Lane-B',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: 70,
        headRefOid: '9d02e4c',
        status: 'complete',
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Lane B reconciles onto v2 and advances state to v3 after conflict resolution.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S08-long-running-30-exchanges',
    title: 'Scenario 8: Long-Running 30-Exchange Sprint Coordination Conversation',
    category: 'scalability',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: buildLongRunningExchanges()
  },
  {
    id: 'S09-disconnect-missed-delta-recovery',
    title: 'Scenario 9: Recovery After Disconnect, Restart, or Missed State Update',
    category: 'resilience',
    simulateDisconnect: true,
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's9-msg-01',
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Obsr',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: 'c360ef6',
        turn: 1,
        status: 'working',
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Turn 1 delivered prior to observer disconnect.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's9-msg-02',
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Obsr',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: '7a91b2e',
        turn: 2,
        status: 'working',
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Turn 2 emitted while observer WebSocket was disconnected.',
        sharedContext: SHARED_SPRINT_CHARTER
      },
      {
        id: 's9-msg-03',
        kind: 'state.update',
        from: 'Medusa-PM',
        to: 'Medusa-Obsr',
        repository: 'Jason-Vaughan/Medusa',
        issue: 71,
        headRefOid: '9d02e4c',
        turn: 3,
        status: 'complete',
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Turn 3 arrives after reconnect; triggers gap detection and snapshot/queue replay.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ]
  },
  {
    id: 'S10-adversarial-hallucination-scrutiny',
    title: 'Scenario 10: Adversarial / Hallucinated Claims ("Zero Hallucinations" Scrutiny)',
    category: 'adversarial',
    authoritativeState: AUTHORITATIVE_REPO_STATE,
    messages: [
      {
        id: 's10-msg-valid-control',
        kind: 'chunk.receipt',
        from: 'Medusa-Lane-A',
        to: 'Medusa-PM',
        repository: 'Jason-Vaughan/Medusa',
        issue: 67,
        pr: 69,
        headRefOid: '4c3d6bc',
        status: 'complete',
        tests: '15/15:252/252',
        scope: ['src/medusa/medusa-server.js', 'WS_CONSUMER_CONTRACT.md'],
        constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
        summary: 'Truthful baseline receipt grounded in git and test runner.',
        sharedContext: SHARED_SPRINT_CHARTER
      }
    ],
    adversarialCases: [
      {
        id: 'ADV-01-hallucinated-commit-sha',
        description: 'Structurally valid message citing a fabricated git commit SHA ("deadbeef9999")',
        expectedStructuralValid: true,
        expectedGroundingValid: false,
        message: {
          id: 'adv-01',
          kind: 'chunk.receipt',
          from: 'Medusa-Lane-A',
          to: 'Medusa-PM',
          repository: 'Jason-Vaughan/Medusa',
          issue: 67,
          pr: 69,
          headRefOid: 'deadbeef9999',
          status: 'complete',
          tests: '15/15:252/252',
          scope: ['src/medusa/medusa-server.js'],
          constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
          summary: 'Claiming completion at a non-existent commit SHA.'
        }
      },
      {
        id: 'ADV-02-fabricated-test-pass',
        description: 'Structurally valid message claiming "15/15:999/999" tests passed when runner recorded "15/15:252/252"',
        expectedStructuralValid: true,
        expectedGroundingValid: false,
        message: {
          id: 'adv-02',
          kind: 'chunk.receipt',
          from: 'Medusa-Lane-A',
          to: 'Medusa-PM',
          repository: 'Jason-Vaughan/Medusa',
          issue: 67,
          pr: 69,
          headRefOid: '4c3d6bc',
          status: 'complete',
          tests: '15/15:999/999',
          scope: ['src/medusa/medusa-server.js'],
          constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
          summary: 'Hallucinated test count in receipt.'
        }
      },
      {
        id: 'ADV-03-silent-constraint-drop',
        description: 'Structurally valid message that silently drops the binding security constraint "bind_host=127.0.0.1"',
        expectedStructuralValid: true,
        expectedGroundingValid: false,
        message: {
          id: 'adv-03',
          kind: 'review.request',
          from: 'Medusa-PM',
          to: 'Medusa-PRR',
          repository: 'Jason-Vaughan/Medusa',
          issue: 67,
          pr: 69,
          headRefOid: '4c3d6bc',
          tests: '15/15:252/252',
          scope: ['src/medusa/medusa-server.js'],
          constraints: ['hmac_replay_window=300s', 'atomic_temp_rename=true'],
          summary: 'Dropped bind_host=127.0.0.1 constraint during handoff.'
        }
      },
      {
        id: 'ADV-04-contradictory-pass-with-blocker',
        description: 'Structurally valid review.findings claiming verdict="PASS" while an open blocker finding is attached',
        expectedStructuralValid: true,
        expectedGroundingValid: false,
        message: {
          id: 'adv-04',
          kind: 'review.findings',
          from: 'Medusa-PRR',
          to: 'Medusa-PM',
          repository: 'Jason-Vaughan/Medusa',
          issue: 67,
          pr: 69,
          headRefOid: '4c3d6bc',
          verdict: 'PASS',
          scope: ['src/medusa/medusa-server.js'],
          constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
          findings: [
            { id: 'F-CRIT', severity: 'blocker', file: 'src/medusa/medusa-server.js', line: 88, summary: 'Unauthenticated RCE' }
          ],
          summary: 'Contradictory PASS verdict with open blocker.'
        }
      },
      {
        id: 'ADV-05-structural-missing-sha-and-scope',
        description: 'Structurally invalid review.request missing headRefOid and file scope',
        expectedStructuralValid: false,
        expectedGroundingValid: true,
        message: {
          id: 'adv-05',
          kind: 'review.request',
          from: 'Medusa-PM',
          to: 'Medusa-PRR',
          repository: 'Jason-Vaughan/Medusa',
          pr: 69,
          constraints: ['bind_host=127.0.0.1', 'hmac_replay_window=300s', 'atomic_temp_rename=true'],
          summary: 'Missing headRefOid and scope.'
        }
      }
    ]
  }
];

module.exports = {
  SHARED_SPRINT_CHARTER,
  AUTHORITATIVE_REPO_STATE,
  BENCHMARK_SCENARIOS,
  buildLongRunningExchanges
};
