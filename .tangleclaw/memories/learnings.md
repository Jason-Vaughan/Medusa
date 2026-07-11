# Cross-Session Learnings — Medusa

## 2026-07-11 — Active Reaping and Dynamic Identity Mapping in Ephemeral Agent Mesh
Filing a patent disclosure forced an architectural audit that highlighted a critical gap: dynamic client connections (WebSockets) were disconnected on the Hub, but remained "active" in the SQLite A2A database registry, leaking stale connections to listing endpoints (#37). We resolved this by implementing immediate WebSocket-close reaping alongside a `lastSeen` TTL validation check on list queries (Commit `ada48ab`). Furthermore, we verified that software patents must be filed prior to Git release to avoid international priority forfeiture, while US rights are protected under a 1-year grace period.
