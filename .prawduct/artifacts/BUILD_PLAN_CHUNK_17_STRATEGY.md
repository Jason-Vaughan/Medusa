# BUILD PLAN: CHUNK 17 - COLLECTIVE STRATEGY SHARING 🧠🐝

## 🎯 **OBJECTIVE**
Enable nodes in the A2A swarm to share their internal problem-solving strategies and heuristics. This allows the swarm to dynamically optimize task allocation based on the collective "intelligence" of all active peers, rather than just individual local skills.

## 🏗️ **ARCHITECTURAL CHANGES**

### **1. Database Evolution (`src/a2a_node/models/ledger.py`)**
- Update `PeerEntry` to include a `strategies` JSON field.
- This field will store the heuristics shared by the peer (e.g., their bidding thresholds, specialized sub-strategies, and current performance metrics).

### **2. Heuristics Enhancement (`src/a2a_node/app/core/heuristics.py`)**
- Expand `BiddingHeuristics.share_heuristic()` to return more detailed strategy data.
- Add a new method `evaluate_with_swarm_intelligence(task, peers)` that considers the strategies of other nodes when deciding whether to bid.
- *Example:* If another node has a much higher confidence/strategy for a specific task type, the local node might "yield" the bid to prevent redundant execution or suboptimal results.

### **3. Gossip Protocol Update (`src/a2a_node/app/api/gossip.py`)**
- **New Endpoint:** `GET /a2a/gossip/strategy` - Returns the local node's current strategy.
- **Sync Logic:** Update `merge_sync_data` to synchronize the `strategies` field from the `PeerEntry` data received during gossip.
- **Ping/Pong Update:** Include strategy summaries in the `ping` capabilities/metadata to ensure immediate awareness of new peer strategies.

### **4. Swarm Intelligence Loop (`src/a2a_node/app/core/swarm.py`)**
- Update `run_swarm_intelligence` to fetch all active peers and their strategies before evaluating pending tasks.
- Implement "Strategic Yield": A node will skip bidding if it detects a peer with a significantly better-matching strategy for the task.

## 🛠️ **IMPLEMENTATION STEPS**

1.  **DB Migration:** Create an Alembic migration to add the `strategies` column to the `peers` table.
2.  **Model Update:** Add the `strategies` field to the `PeerEntry` SQLAlchemy model and the `LedgerPeer` Pydantic model.
3.  **Heuristics Logic:** Implement the enhanced sharing and swarm-aware evaluation logic in `heuristics.py`.
4.  **API/Gossip Integration:**
    - Implement the `/strategy` endpoint.
    - Update `ping` and `sync` logic to handle strategy sharing.
5.  **Swarm Loop Integration:** Update the background swarm task to use the new "Strategic Yield" logic.
6.  **Verification:** Write unit tests to verify that nodes correctly yield tasks to "better-suited" peers based on shared strategies.

## 🧪 **VERIFICATION PLAN**

### **Automated Tests (`src/a2a_node/tests/test_strategy.py`)**
- `test_strategy_sharing`: Verify that the `/strategy` endpoint returns correct data.
- `test_strategic_yield`: Mock a peer with a "superior" strategy and verify that the local node yields a matching task.
- `test_swarm_strategy_sync`: Verify that strategies are correctly merged during the gossip sync process.

### **Manual Verification**
- Spin up two A2A nodes with different skills/strategies.
- Observe via logs/dashboard that they intelligently divide labor based on their shared strategies.

---

*"Individual nodes have skills; a swarm has a strategy."* 🧠🐝🔥
