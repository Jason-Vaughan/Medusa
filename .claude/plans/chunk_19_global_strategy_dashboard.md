# Build Plan: Chunk 19 - Global Strategy Dashboard 📊🐝

This chunk focuses on visualizing the collective intelligence and performance metrics implemented in Chunk 18. The Medusa Switchboard will be enhanced to show how nodes are performing and what strategies they are employing across the mesh.

## Objective
Update the Medusa Dashboard to visualize shared swarm strategies and global performance metrics (latency, success rate).

## Key Files & Context
- `src/medusa/dashboard.html`: Main UI layout.
- `src/medusa/dashboard.js`: Dashboard logic and data fetching.
- `src/medusa/medusa-server.js`: API bridge (already supports necessary endpoints).

## Implementation Steps

### 1. Dashboard UI Enhancement (HTML)
- Refactor "Mesh Awareness & Skills" section in `src/medusa/dashboard.html` to support more detailed node cards.
- Add a new section for "Swarm Performance Overview" if needed, or integrate it into the peer list.
- Ensure the layout is responsive and handle potential overflow for many peers.

### 2. Peer Data Visualization (JS) - Integrated View
- Update `loadPeers()` in `src/medusa/dashboard.js` to:
    - Extract `performance` metrics (success_count, total_tasks, total_latency).
    - Calculate and display Success Rate (%) and Average Latency (s) on each peer card.
    - Extract and display `strategies` (strategy type, min_confidence) and skills prominently.
- Add a color-coded status for performance (e.g., green for >95% success, red for <80%).

### 3. Global Strategy Insights - Swarm Summary
- Add a "Swarm Intelligence Overview" component that shows the aggregate mesh "health":
    - Total swarm success rate (average of all active nodes).
    - Global average swarm latency.
    - List of dominant skills and strategy types currently active.

## Verification & Testing
- **Manual Verification:** Open the dashboard with multiple nodes running and verify that performance data appears for each node.
- **Visual Check:** Ensure success rates and latencies are calculated correctly from the raw metrics.
- **Strategy Check:** Verify that node skills and strategy names are correctly displayed.
