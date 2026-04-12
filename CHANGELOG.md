# CHANGELOG

## [0.7.0-beta] - 2026-04-12
### Changed
- **OFFICIAL PUBLIC BETA LAUNCH** 🚀
- Transitioned repository to Public Beta status.
- Added comprehensive `CONTRIBUTING.md` and `SECURITY.md`.
- Updated documentation for public community involvement.
- Refined `README.md` with public beta roadmap and status.

## [0.6.9-beta] - 2026-04-04
### Added
- **Chunk 17: COLLECTIVE STRATEGY SHARING** completed.
- **Dynamic Strategy Sharing:** Nodes now share their internal heuristics, bidding thresholds, and skills via `/a2a/gossip/strategy`.
- **Strategic Yield:** Implemented swarm-aware task evaluation where nodes intelligently yield tasks to better-qualified peers.
- **Enhanced Peer Tracking:** Updated `PeerEntry` to store and synchronize strategies across the gossip mesh.
- **Automatic Strategy Sync:** Integrated strategy sharing into ping/pong and ledger synchronization flows.

## [0.6.8-beta] - 2026-03-31
### Added
- **Chunk 16: DISTRIBUTED GOSSIP CONSENSUS** completed.
- **Multi-Node Result Reconciliation:** Implemented majority voting for task results to ensure swarm-wide agreement.
- **Redundant Execution Support:** Added `requires_consensus` and `min_votes` fields to tasks, allowing multiple nodes to verify results.
- **Consensus Status Tracking:** New states (`none`, `pending`, `achieved`, `conflict`) for transparent verification progress.
- **Yield Logic:** Nodes now intelligently abort non-consensus tasks if a superior claim is detected during execution.
- **Atomic Vote Merging:** Enhanced gossip protocol to handle concurrent result collection and deterministic winner selection.

## [0.6.7-beta] - 2026-03-31
### Added
- **Chunk 15: ADVANCED LLM DECOMPOSITION** completed.
- **Intelligent Task Splitting:** Replaced mock decomposition with actual LLM calls (Anthropic Claude/OpenAI GPT).
- **Multi-Provider Fallback:** Implemented `LLMService` in Python with automatic fallback between providers if one fails.
- **Snarky Personality Integration:** Specialized prompts ensure Medusa's "savage" personality is maintained in generated subtasks.
- **Dependency Resolution:** Subtasks now support complex dependency mapping derived directly from LLM reasoning.
- **Robust Fallback:** Maintained hardcoded rules as a safety net for offline or unconfigured environments.

## [0.6.6-beta] - 2026-03-31
### Added
- **Chunk 12: COLLECTIVE INTELLIGENCE (The Swarm)** completed.
- **Autonomous Swarm Intelligence:** Nodes now autonomously claim and execute tasks based on specialized skills using `BiddingHeuristics`.
- **Work Stealing & Consensus:** Implemented deterministic conflict resolution for multi-node task claims in `gossip.py`.
- **Multi-Node Verification:** Created `scripts/swarm_tester.py` for automated mesh testing across multiple A2A nodes.
- **Janitor System:** Automated hygiene for stale locks, temp files, and database "nuking" via Medusa CLI.
- **Learnings System:** Persistent, cross-session project knowledge base integrated into A2A and Prawduct layers.
- **DB Stability:** Fixed simultaneous database migrations for multi-node environments.

## [0.6.5-beta] - 2026-03-31
### Added
- **Chunk 11: GOVERNANCE BRIDGE** completed.
- **Prawduct Governance:** Implemented `PrawductManager` for automated session, chunk, and wrap management.
- **Medusa Prawduct CLI:** Added `medusa prawduct` command group (`start`, `stop`, `wrap`, `backlog`, `learn`).
- **A2A Task Execution:** Upgraded A2A node with `TaskExecutor` supporting real shell commands and MCP tool bridging.
- **Integrated Persistence:** Switched to `js-yaml` for managing `project-state.yaml`.

## [0.6.4-beta] - 2026-03-30
### Added
- **Dynamic Capability Discovery:** Nodes now advertise specialized "skills" (e.g., `skill:python_expert`) in their agent cards via `MEDUSA_SKILLS` configuration.
- **Collective Intelligence Heuristics:** Implemented `BiddingHeuristics` module for skill-based task evaluation and confidence scoring.
- **Mesh Awareness Dashboard:** Added "Mesh Awareness" panel to Switchboard for viewing discovered peers and their skills.
- **Enhanced Auction Visualizer:** Improved auction display with auto-polling and bidder skills/confidence visualization.
- **Medusa-A2A Mesh Bridge:** Added `/mesh/peers` endpoint to `medusa-server.js` for dashboard peer discovery.

## [0.6.3-beta] - 2026-03-27
### Added
- **Dynamic Capability Advertising:** A2A node now dynamically serves `agent-card.json` with capabilities derived from local MCP tools.
- **Dashboard Auction View:** Implemented "The Domain" dashboard interface for viewing active task auctions, placing manual bids, and resolving auctions.
- **Medusa-A2A Bridge Expansion:** Added server-side bridging for auction discovery, bidding, and resolution between Node.js Medusa and Python A2A nodes.
- **Bug Fix:** Fixed missing `readRequestBody` helper in `medusa-server.js` that caused POST request failures.

## [0.6.2-beta] - 2026-03-27
### Added
- **Task Execution Engine:** Implemented background execution service for processing pending A2A tasks.
- **Task Delegation:** Added `/tasks/delegate` endpoint for cross-node hand-off.
- **Persistence:** Upgraded SQLite ledger schema with task assignment, results, and execution metadata.
- **Gossip Stability:** Switched to asynchronous `httpx` and implemented "muted" error reporting to prevent log spam.
- **HTTPS Discovery:** Migrated TangleClaw PortHub communication to HTTPS with self-signed certificate support.

## [0.6.1-beta] - 2026-03-26
### Added
- **A2A Node Foundation:** Initialized Python/FastAPI environment in `src/a2a_node`.
- **Discovery Endpoint:** Implemented `/.well-known/agent-card.json` serving agent capabilities and A2A metadata.
- **JSON-RPC Endpoints:** Added `/a2a/tasks` and `/a2a/messages` for P2P coordination.
- **Port Management:** Integrated with TangleClaw PortHub for dynamic port registration (defaulting to 3200).
- **Project Structure:** Established modular FastAPI architecture with dedicated core, models, and API layers.
