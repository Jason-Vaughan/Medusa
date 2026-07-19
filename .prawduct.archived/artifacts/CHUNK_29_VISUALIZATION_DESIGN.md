# Chunk 29: Mesh Visualization 2.0 - Design Document

**Goal:** Surface the new "hidden" intelligence built in Chunks 27 (Skills) and 28 (Backoff) on the Medusa Dashboard.

## 🎯 Objectives
- **Visualize Skill Evolution:** Show how nodes have specialized over time.
- **Display Reputation:** Make peer trust levels visible and intuitive.
- **Live Retry Monitoring:** Show countdowns for tasks in exponential backoff.
- **Mesh Health Heatmap:** Visualize node stress levels (CPU/Memory).

## 🛠 UI Components

### 1. Peer Card Enhancements (`loadPeers`)
The peer card in the "Mesh Awareness" section will be upgraded with:

#### A. Skill Weight Progress Bars
Instead of a simple list of tags, skills will be displayed with progress bars representing their weight in the `skills_matrix`.
- **Logic:** `weight` (typically 0.1 to 1.0+) mapped to a percentage.
- **Colors:**
  - `> 0.8`: Success Green
  - `0.4 - 0.8`: Primary Purple
  - `< 0.4`: Muted Gray

#### B. Reputation Badges
A prominent badge next to the peer's name based on `performance.reputation_score`.
- **Tiers:**
  - 🏆 `Rep > 0.9`: Legendary
  - 🥇 `Rep > 0.7`: Veteran
  - 🥈 `Rep > 0.5`: Reliable
  - 🥉 `Rep > 0.3`: Novice
  - 💀 `Rep <= 0.3`: Untrusted

#### C. Health Heatmap
A small "Vitality" bar or icon that changes color based on `health_metadata`.
- **Green:** Healthy (Low load)
- **Yellow:** Melting (Medium load)
- **Red:** Critical (High load)

### 2. Task Tree Enhancements (`renderTaskTree`)
The task tree will be updated to handle the new backoff state.

#### A. Retry Countdown
Tasks that are in a retry state (detected by `next_retry_at > now` and `status === 'failed'` or a new `backoff` state) will show a live countdown.
- **Display:** `[BACKOFF] Retry in 14s (Attempt 2/3)`
- **Behavior:** JavaScript `setInterval` will update these countdowns every second without requiring a full re-poll.

## 📡 API Integration

### 1. `GET /mesh/peers` (A2A Node)
Already provides `skills_matrix`, `performance.reputation_score`, and `health_metadata`.
- **Action:** Ensure `medusa-server.js` proxy correctly forwards these fields if it doesn't already.

### 2. `GET /a2a/tasks/tree` (A2A Node)
Already provides `next_retry_at`, `retry_count`, and `max_retries`.

## 🚀 Implementation Plan

### Step 1: Research & Infrastructure
- Verify `medusa-server.js` forwards all necessary fields in `/mesh/peers` and `/a2a/tasks/tree`.
- Add a CSS class for progress bars and badges in `dashboard.html`.

### Step 2: Peer Card Refactor
- Update `loadPeers` in `dashboard.js` to render skill bars.
- Implement the `getReputationBadge` helper function.
- Add health metadata visualization.

### Step 3: Task Tree Refactor
- Update `renderTaskTree` in `dashboard.js` to detect backoff tasks.
- Implement a client-side timer registry to update countdowns.

### Step 4: Validation
- Use the `swarm_tester.py` to trigger task failures and verify backoff countdowns.
- Run manual skills evolution tests to see progress bars grow.

---
**Status:** Design Phase
**Author:** Gemini CLI
**Next Step:** Apply CSS changes to `dashboard.html`.
