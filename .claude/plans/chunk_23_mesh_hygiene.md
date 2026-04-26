# Chunk 23: Mesh Hygiene & Resilience

## Objective
Enhance the long-term stability and security of the Medusa A2A mesh by implementing automated snapshot pruning, real-time resource health telemetry, and a more robust cryptographic handshake for P2P communication.

## Key Files & Context
- `src/a2a_node/app/core/performance.py`: Performance monitoring and snapshot logic.
- `src/a2a_node/app/core/security.py`: Secret verification logic.
- `src/a2a_node/app/api/gossip.py`: P2P discovery and synchronization endpoints.
- `src/a2a_node/app/models/ledger.py`: SQLAlchemy models for the ledger.
- `src/a2a_node/app/core/config.py`: Configuration settings for the A2A node.

## Implementation Steps

### 1. Snapshot Pruning (Janitor)
- **Add `prune_snapshots` method** to `PerformanceMonitor` in `performance.py`:
  - Deletes snapshots older than 7 days (configurable via `settings.RETENTION_DAYS`).
  - Uses `delete(PerformanceSnapshot).where(PerformanceSnapshot.timestamp < threshold)`.
- **Integrate pruning** into the `run_performance_monitor` background loop:
  - Run the pruning task once per hour (3600 seconds).

### 2. Mesh Health Telemetry
- **Enhance `PeerEntry` model** in `ledger.py`:
  - Add `health_metadata` JSON field to store resource stats (CPU, Memory, Uptime).
- **Implement `get_resource_health`** in `performance.py`:
  - Use `psutil` (if available) or standard Python `os`/`sys` calls to gather basic health metrics.
- **Update Gossip Protocol** in `gossip.py`:
  - Include health data in the `/ping` request.
  - Sync health data across the mesh in `merge_sync_data`.

### 3. Enhanced Security Handshake
- **Refactor `security.py`**:
  - Implement `create_signature(payload, secret)` and `verify_signature(signature, payload, secret)`.
  - Signature payload should include a timestamp to prevent replay attacks (valid within a 30s window).
  - Use HMAC-SHA256 for cryptographic integrity.
- **Update API Endpoints**:
  - Replace simple `verify_medusa_secret` with a more robust `verify_medusa_handshake` dependency that checks both the secret and the signature.
- **Update Outbound Clients**:
  - Update `httpx` calls in `gossip.py`, `swarm.py`, and `a2a.py` to generate and attach the `X-Medusa-Signature` header.

## Verification & Testing
- **Pruning Test**: Manually insert an old snapshot and verify it is removed after the pruning cycle.
- **Health Test**: Verify that the dashboard (via `/a2a/gossip/peers`) shows updating resource metrics for each node.
- **Security Test**: 
  - Send a request with a valid secret but invalid signature (should fail).
  - Send a request with a valid signature but expired timestamp (should fail).
  - Verify that authentic nodes can still communicate seamlessly.
