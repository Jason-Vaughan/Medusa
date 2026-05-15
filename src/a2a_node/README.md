# Medusa A2A Node

Autonomous AI-to-AI coordination node for the Medusa Mesh.

## Architecture
The A2A Node is a Python-based FastAPI application that provides:
- **Ledger-based state synchronization:** Using SQLite and Gossip protocol.
- **Dynamic Trust:** Capability Profiles and Workspace Grants for scoped pre-approval.
- **Collective Intelligence:** Heuristic-based bidding and strategic yielding.
- **Mesh Resilience:** Autonomous quarantine of rogue nodes and zombie task recovery.

## Security
Requests between nodes and from the Medusa CLI are authenticated using **HMAC-SHA256 signatures**. 
The `A2A_SECRET` environment variable must be consistent across the mesh.

## CLI Administration
The Medusa CLI provides several commands to manage the A2A Node:
- `medusa a2a profile`: Manage capability profiles (Allowed/Denied patterns).
- `medusa a2a grant`: Issue and revoke workspace grants.
- `medusa a2a peer`: Monitor mesh health and manually quarantine/unquarantine nodes.

## Hygiene
The node includes a `TaskJanitor` that perform daily ledger pruning based on:
- `RETENTION_DAYS_ROUTINE` (Default: 7 days)
- `RETENTION_DAYS_AUDIT` (Default: 30 days)

## Testing
Run the Python test suite:
```bash
npm run test:python
```
Run the CLI integration tests:
```bash
npm test src/tests/cli_admin.test.js
```
