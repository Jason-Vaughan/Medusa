# CHANGELOG

## [0.7.5-beta] - 2026-04-17
### Added
- **Chunk 22: ADVANCED LLM DECOMPOSITION** completed.
- **Enhanced Task Decomposition:** Replaced basic decomposition with advanced LLM-powered logic using Anthropic and OpenAI.
- **Priority-Aware Sub-tasks:** Sub-tasks now include AI-assigned priorities (1-10) for optimized swarm execution.
- **Resilient LLM Service:** Upgraded `LLMService` with multi-provider fallback, autonomous retries, and strict timeout handling.
- **Refined Medusa Persona:** Injected a superior, witty "Medusa" personality into all task descriptions and prompts.
- **Intelligent Dependency Linking:** Enhanced the `DecompositionEngine` to accurately link sub-tasks based on LLM-defined dependency indices.
- **Improved Fallback Rules:** Updated hardcoded decomposition rules with the new persona and priority metadata.

## [0.7.4-beta] - 2026-04-16
### Added
- **Chunk 21: HISTORICAL ANALYTICS** completed.
- **Performance Snapshots:** Implemented periodic snapshotting (every 60s) of local and global (mesh-wide) performance metrics.
- **Time-Series Database:** Added `performance_snapshots` table via Alembic to store historical success rates, latency, and load.
- **Historical API:** New `/a2a/performance/history` endpoint with support for node-specific or mesh-wide data retrieval.
- **Chart.js Integration:** Integrated Chart.js into the Switchboard dashboard for professional time-series visualization.
- **Mesh Performance Graphs:** Added real-time updating charts for Swarm Success Rate (%) and Mesh Average Latency (s) over the last 50 minutes.
- **Background Monitoring:** Dedicated `Performance-Monitor` supervised task for persistent metrics collection.

## [0.7.3-beta] - 2026-04-16
### Added
- **Chunk 20: DYNAMIC LOAD BALANCING** completed.
- **Load-Aware Bidding:** Nodes now factor in current "active load" (running + pending tasks) when evaluating tasks. Confidence is penalized and bid value increased as load grows to prevent over-commitment.
- **Dynamic Strategic Yield:** Refined yield logic to prioritize peers with lower current load, ensuring even work distribution across the mesh.
- **Swamped Decomposition:** Nodes automatically trigger task decomposition more aggressively when swamped (load > 3) to facilitate sub-task delegation and parallel processing.
- **Enhanced Gossip Protocol:** Strategy sharing now includes real-time load metrics, enabling swarm-wide load balancing awareness.
- **Performance Monitor Enhancement:** Added high-performance load tracking to calculate active task counts across running and pending states.
- **Bug Fix:** Resolved missing `time` import in A2A node execution engine.

## [0.7.2-beta] - 2026-04-16
### Added
- **Chunk 19: GLOBAL STRATEGY DASHBOARD** completed.
- **Swarm Intelligence Overview:** New dashboard component visualizing aggregate mesh success rates, average latency, and active strategies.
- **Integrated Peer Analytics:** Enhanced "Mesh Awareness" with detailed node cards showing success rates (%), avg latency (s), strategy types, and specialized skills.
- **Performance Visualization:** Color-coded status indicators for peer reliability and speed.
- **Hybrid UI Layout:** Combined granular node-specific data with high-level swarm health summaries for optimal transparency.

## [0.7.1-beta] - 2026-04-15
### Added
- **Chunk 18: SWARM PERFORMANCE METRICS** completed.
- **Autonomous Performance Tracking:** Nodes now track local execution success rates and latency per task type via `PerformanceMonitor`.
- **Performance-Aware Gossip:** Shared performance metrics integrated into ping/pong and sync protocols.
- **Refined Strategic Yield:** Enhanced `evaluate_with_swarm_intelligence` to factor in peer performance track records, applying bonuses for high success/low latency and penalties for poor reliability.
- **Database Evolution:** Added `performance` JSON field to `PeerEntry` with associated Alembic migrations.

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
