# Chunk 25: Node Reputation & Dynamic Bidding Thresholds

## Objective
Enhance swarm-wide reliability and intelligence by implementing a long-term node reputation system and dynamically adjusting bidding aggressiveness based on swarm health.

## Key Files & Context
- `src/a2a_node/app/core/reputation.py`: **NEW** Core reputation engine.
- `src/a2a_node/app/core/heuristics.py`: Bidding logic integration.
- `src/a2a_node/app/core/performance.py`: Swarm health monitoring.
- `src/a2a_node/app/api/gossip.py`: Sync-based reputation updates.
- `src/a2a_node/app/core/swarm.py`: Janitor-based reputation updates.
- `src/a2a_node/app/models/ledger.py`: Schema for reputation data.

## Implementation Steps

### 1. Reputation Engine (`ReputationEngine`)
- **Location:** `src/a2a_node/app/core/reputation.py`.
- **Logic:** Calculate `reputation_score` (0.0 - 1.0) based on:
    - `completed`: +0.1 weight (max 1.0).
    - `failed`: -0.2 penalty.
    - `stalled`: -0.5 penalty (heavy penalty for nodes that claim and disappear).
    - `consensus_disagreement`: -0.1 penalty.
- **Persistence:** Store in `PeerEntry.performance` JSON field.

### 2. Integration: Gossip & Janitor
- **Janitor Integration:** Update `run_task_janitor` in `swarm.py` to call `ReputationEngine.update_reputation(old_owner, "stalled")` when a task is recovered.
- **Sync Integration:** Update `merge_sync_data` in `gossip.py` to detect status changes (claimed -> completed/failed) and update reputation accordingly.

### 3. Dynamic Bidding Thresholds
- **Swarm Health:** Add `get_swarm_health()` to `PerformanceMonitor`.
- **Dynamic Threshold:** In `BiddingHeuristics.evaluate_task`, adjust the `MIN_CONFIDENCE` (default 0.6) based on swarm health.
    - If health < 0.8, increase threshold by 0.1.
    - If health < 0.5, increase threshold by 0.2.
- **Reputation-Aware Yield:** In `evaluate_with_swarm_intelligence`, factor the peer's reputation into the confidence calculation.
    - `peer_confidence *= peer_reputation`.
    - Do not yield to nodes with reputation < `settings.REPUTATION_THRESHOLD_MIN`.

### 4. Testing & Verification
- **Reputation Test:** Simulate task completion, failure, and stalling; verify reputation score changes correctly.
- **Bidding Test:** Verify node stops yielding to "unreliable" peers (low reputation).
- **Dynamic Threshold Test:** Simulate low swarm success rate and verify nodes become more conservative in bidding.

## Verification & Testing
- `pytest src/a2a_node/tests/test_reputation.py` (New tests)
- `pytest src/a2a_node/tests/test_dynamic_thresholds.py` (New tests)
- Manual verification via `scripts/swarm_tester.py`.
