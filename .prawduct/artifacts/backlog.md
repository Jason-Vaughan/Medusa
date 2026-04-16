# Prawduct Backlog

This backlog tracks out-of-scope items, future enhancements, and deferred tasks discovered during the building process.

## ✅ Completed Items

| Item | Origin | Priority | Status | Description |
|------|--------|----------|--------|-------------|
| **Governance & HITL** | Chunk 14 Plan | High | ✅ Done | Implemented human-in-the-loop approval workflow for critical tasks. |
| **Task Retry Logic** | Chunk 14 Plan | Medium | ✅ Done | A2A node now retries failed tasks up to a max_retries limit. |
| **Real-time HITL Dashboard** | Chunk 14 Plan | High | ✅ Done | Integrated approval/rejection controls into the Medusa dashboard. |
| **Multi-node Swarm Testing** | Chunk 12 Plan | High | ✅ Done | Spun up 3 A2A nodes and verified autonomous task claiming and state sync. |
| **Advanced Swarm Heuristics** | Chunk 12 Plan | Medium | ✅ Done | Implemented SwarmIntelligence for autonomous skill-based task stealing. |
| **Gossip Consensus (Work Stealing)** | Chunk 12 Plan | High | ✅ Done | Implemented optimistic locking and conflict resolution for task claims. |
| **Janitor System** | Chunk 12 Plan | Medium | ✅ Done | Automated cleanup of stale locks and temporary files. |
| **Learnings System** | Chunk 12 Plan | High | ✅ Done | Persistent knowledge base for project insights across chunks. |
| **Prawduct Lifecycle Hooks** | Chunk 12 Plan | High | ✅ Done | Automated Start/Stop/Summary hooks for Prawduct governance. |
| **Dynamic Capability Discovery** | Chunk 6 Critic | Medium | ✅ Done | Let nodes advertise their specialized skills during the auction. |
| **Auction Visualizer** | Chunk 6 Design | Medium | ✅ Done | Show the bidding process in real-time on the Medusa dashboard. |
| **Collective Intelligence Heuristics** | Chunk 9 Plan | High | ✅ Done | Shared problem-solving heuristics across the mesh. |
| **Intelligent Error Recovery** | Phase 1 Roadmap | High | ✅ Done | Implemented TaskSupervisor to auto-restart background tasks. |
| **Auction-Based Task Negotiation** | Chunk 6 Plan | High | ✅ Done | Implemented announce, bid, and resolve_auction endpoints. |
| **A2A CLI Integration** | Chunk 6 Plan | Medium | ✅ Done | Added medusa a2a start/stop and unified with medusa start. |
| **Advanced Dashboard Integration** | Phase 2 Roadmap | Medium | ✅ Done | Bridged dashboard to Python A2A Node and added A2A/ZombieDust telemetry. |
| **MCP Tool Restoration** | Chunk 5 Plan | High | ✅ Done | Restored all 7 snarky tools, bridged to A2A Node. |
| **Gossip Protocol Security** | Chunk 2 Critic | Medium | ✅ Done | Implemented `X-Medusa-Secret` auth for all gossip and A2A endpoints. |
| **Alembic Migrations** | Chunk 2 Critic | Medium | ✅ Done | Set up Alembic, initial migration, and auto-runner on startup. |
| **Gossip State Sync** | Phase 3 Plan | High | ✅ Done | Implemented `/sync` endpoint and background sync logic in gossip protocol. |
| **Multi-Node Task Decomposition** | Chunk 8 Plan | High | ✅ Done | Complex tasks can be split into sub-tasks via DecompositionEngine. |
| **Swarm Coordination** | Chunk 8 Plan | High | ✅ Done | Sub-tasks support dependencies and are executed sequentially by the engine. |
| **Global Strategy Dashboard** | Chunk 19 Plan | High | ✅ Done | Visualized shared strategies and performance metrics for the entire swarm. |

## 📥 Pending Items

| Item | Origin | Priority | Status | Description |
|------|--------|----------|--------|-------------|
| **Dynamic Load Balancing** | Chunk 20 Plan | Medium | 📥 Pending | Account for node load (active tasks) in yielding and bidding logic. |
| **Advanced LLM Decomposition** | Chunk 14 Critic | High | 📥 Pending | Replace mock decomposition rules with actual LLM calls. |
| **Exponential Backoff** | Chunk 14 Critic | Low | 📥 Pending | Improve retry logic with smarter wait times between attempts. |
| **Gossip Consensus** | Chunk 12 Critic | Medium | 📥 Pending | Implement multi-node consensus for conflicting execution results. |
| **Dashboard Telemetry UI** | Chunk 11 Critic | Low | 📥 Pending | Add more detailed telemetry graphs to the switchboard. |
