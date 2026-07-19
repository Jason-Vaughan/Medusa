# Chunk 30: Advanced Consensus 2.0 - Reputation-Weighted Voting & Adaptive Quorums

## 1. Problem Statement
The current consensus mechanism (Chunk 16/24) uses a simple majority vote where every node's vote is equal. This is vulnerable to "Sybil-like" behavior where a low-reputation or malfunctioning node can block consensus or force re-votes. Additionally, critical tasks lack the ability to require higher confidence levels (e.g., unanimity or high-reputation quorum).

## 2. Proposed Solution
Implement **Advanced Consensus 2.0**:
- **Reputation-Weighted Voting**: Voting power scales with a node's long-term reliability.
- **Adaptive Quorum Thresholds**: Support for different consensus strategies (`majority`, `unanimous`, `weighted_threshold`).
- **Reputation-Based Tie-Breaking**: Resolve split votes by favoring results from the most trusted nodes.
- **Visual Voting Progress**: Dashboard visibility into the distribution of results.

## 3. Storage & Schema Changes

### 3.1 `TaskEntry` Evolution
We will add new fields to `src/a2a_node/app/models/ledger.py` to support granular consensus control.

| Column | Type | Description |
|--------|------|-------------|
| consensus_strategy | String | `majority` (default), `unanimous`, `weighted_threshold` |
| quorum_threshold | Float | Required weighted score (e.g., 0.7 for 70% of total available weight) |
| results_metadata | JSON | Metadata about the voting process (e.g., weight per result) |

## 4. Technical Implementation

### 4.1 Reputation-Weighted Logic
Modify `reach_consensus` in `src/a2a_node/app/api/gossip.py`:
1.  For each vote in `results_votes`, fetch the `reputation_score` of the voting node.
2.  Calculate `total_weight` = sum of all voting nodes' reputations.
3.  Group votes by result and calculate `result_weight` = sum of reputations for that specific result.

### 4.2 Consensus Strategies
- **Majority**: `result_weight > (total_weight / 2)`
- **Unanimous**: All voters must agree, and `count >= min_votes`.
- **Weighted Threshold**: `result_weight / total_weight >= quorum_threshold`.

### 4.3 Tie-Breaking Heuristics
If no strategy clears:
1.  Check if a result has > 50% of the *unweighted* count AND the most reputable node (Reputation > 0.9) voted for it.
2.  If yes, achieve consensus.
3.  If no, trigger the existing 2-minute cool-down for re-vote.

### 4.4 Dashboard Integration
Update `src/medusa/dashboard.js` and `src/medusa/dashboard.html` to:
- Show a "Consensus" badge on tasks requiring multiple votes.
- On hover/click, show the current weight distribution (e.g., "Result A: 65% (3 nodes), Result B: 35% (1 node)").

## 5. Verification Plan
1.  **Unit Tests**: Create `test_consensus_weighted.py` to verify:
    - High-reputation node outvoting two low-reputation nodes.
    - `weighted_threshold` strategy success/failure.
    - Tie-breaking logic.
2.  **Integration Tests**: Use `swarm_tester.py` to simulate a 3-node swarm with varying reputation scores providing conflicting results.

---
*"Collective intelligence is not just about counting heads; it's about weighing brains."* 🧠🗳️🐝
