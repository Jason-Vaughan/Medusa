# Chunk 24: Task Resilience & Global Consensus Refinement

## Objective
Enhance the A2A Swarm's reliability and intelligence by implementing stalled task recovery ("Work Stealing"), resource-aware bidding heuristics, and refined global consensus mechanisms.

## Key Files & Context
- `src/a2a_node/app/core/heuristics.py`: Core bidding and strategic yield logic.
- `src/a2a_node/app/core/swarm.py`: Swarm intelligence background loops.
- `src/a2a_node/app/api/gossip.py`: Gossip protocol and consensus voting.
- `src/a2a_node/app/core/performance.py`: Resource health monitoring.
- `src/a2a_node/main.py`: Startup registration for new background tasks.

## Implementation Steps

### 1. Health-Based Bidding Heuristics
- **Integration:** Update `BiddingHeuristics.evaluate_task` to fetch real-time health from `PerformanceMonitor`.
- **Penalties:**
    - CPU > 80%: -0.3 confidence.
    - Memory > 90%: -0.4 confidence.
    - Load Average (1m) > CPU Cores * 2: -0.2 confidence.
- **Auto-Rejection:** If CPU > 95% or Memory > 98%, force `should_bid = False`.
- **Swarm Intelligence:** Update `evaluate_with_swarm_intelligence` to prefer peers with lower resource utilization, not just lower task load.

### 2. Stalled Task Recovery (Work Stealing)
- **Janitor Loop:** Create `run_task_janitor` in `src/a2a_node/app/core/swarm.py`.
- **Detection:** Identify tasks in `claimed` state that haven't been updated for > 5 minutes (configurable).
- **Recovery (Reset to Pending):** 
    - Reset `status` to `pending`.
    - Clear `claimed_by` and `claim_timestamp`.
    - Increment `retry_count`.
    - Log the "Work Stealing" event: "Node {node_id} was too slow. Releasing task {task_id} back to the wild."
- **Registration:** Register `run_task_janitor` in `main.py` via the `TaskSupervisor`.

### 3. Global Consensus Refinement
- **Majority Voting:** Ensure `reach_consensus` correctly calculates majority based on `min_votes`.
- **Automated Re-vote:** 
    - If a `conflict` is detected (split vote), wait for a 2-minute "Cool-down".
    - After cool-down, reset `consensus_status` to `pending` and clear `results_votes` to trigger a fresh round of voting.
    - If conflict persists after 3 re-votes, escalate to `requires_approval = 1` for Human-in-the-Loop resolution.
- **Metadata Sync:** Ensure `merge_sync_data` properly propagates `results_votes` and triggers consensus checks.

### 4. Testing & Verification
- **Simulated Stress:** Mock high CPU/Memory and verify node stops bidding.
- **Stalled Task Test:** Claim a task and manually kill the node/process, verify another node recovers it after the timeout.
- **Consensus Test:** Trigger a task requiring consensus with 3 nodes, provide conflicting results, and verify conflict detection.

## Verification & Testing
- `pytest src/a2a_node/tests/test_heuristics.py` (New tests)
- `pytest src/a2a_node/tests/test_swarm_resilience.py` (New tests)
- Manual verification using `scripts/swarm_tester.py` to observe work stealing.
