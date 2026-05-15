# Implementation Plan: Issue #19 - Advanced Capabilities & Profiles (Dynamic Trust) & Mesh Hardening

**Proposed Repo Location:** `.claude/plans/issue_19_dynamic_trust_and_hardening.md` (To be moved upon implementation start)
**Status:** Approved / Implementation Pending
**Issue Update:** Title expanded to include "Mesh Hardening".

## 1. Objective
- **CLI Integration:** Provide user-facing commands to manage Capability Profiles and Workspace Grants.
- **Ledger Hygiene:** Prevent database bloat by pruning old tasks and messages.
- **Mesh Governance:** Add CLI tools for manual peer quarantine and unquarantine with mandatory audit logs.
- **Consolidation:** Ensure all "Phase 5/6" features are fully verified and integrated.

## 2. Key Files & Context
- `bin/medusa.js`: CLI entry point to be extended.
- `src/a2a_node/app/api/a2a.py`: A2A node API endpoints for tasks, profiles, and grants.
- `src/a2a_node/app/api/gossip.py`: A2A node API endpoints for peer management.
- `src/a2a_node/app/core/performance.py`: Currently handles snapshot pruning.
- `src/a2a_node/app/core/execution.py`: Logic for task execution and pruning.
- `src/a2a_node/app/core/messages.py`: **NEW** Core module for message-level domain logic.
- `src/a2a_node/app/core/swarm.py`: Background Janitor wiring.

## 3. Implementation Steps

### Phase 1: Medusa CLI Extensions & Admin APIs
**CLI Auth Model:** "Local CLI = Trusted Operator". The CLI uses the `A2A_SECRET` (HMAC-SHA256 signature) to authenticate with the A2A node. 
**Interaction Pattern:** Trust-modifying commands (quarantine, grant revoke, etc.) will use an **interactive prompt by default**, with a `-y` or `--yes` flag to bypass for scripted use.

- **A2A Profile Management:**
  - `medusa a2a profile create`: Interactive wizard or JSON input. (API: `POST /a2a/capabilities/profiles` - *Exists*)
  - `medusa a2a profile list`: Tabular output. (API: `GET /a2a/capabilities/profiles` - *Exists*)
  - `medusa a2a profile show <id>`: Detailed view. (API: `GET /a2a/capabilities/profiles/{id}` - *Exists*)
- **A2A Grant Management:**
  - `medusa a2a grant create <workspace_id> <profile_id> [hours]`: (API: `POST /a2a/workspaces/{workspace_id}/grants` - *Exists*)
  - `medusa a2a grant list [workspace_id]`: (API: `GET /a2a/workspaces/{workspace_id}/grants` - *Exists*)
  - `medusa a2a grant revoke <grant_id>`: (API: `DELETE /a2a/grants/{grant_id}` - *Exists*)
- **A2A Peer Management & Audit:**
  - `medusa a2a peer list`: Shows health, reputation, and quarantine status. (API: `GET /a2a/gossip/peers` - *Exists*)
  - `medusa a2a peer quarantine <node_id> --reason <text>`: Manually isolate a node. (API: `POST /a2a/peers/{node_id}/quarantine` - **NEEDS ADDING**)
  - `medusa a2a peer unquarantine <node_id> --reason <text>`: (API: `POST /a2a/peers/{node_id}/unquarantine` - **NEEDS ADDING**)
  - **Audit Hook:** Manual quarantine actions MUST record the OS user, reason, and previous state in the `health_metadata` or a dedicated audit log. 
    - *Note:* Future multi-operator or remote-CLI scenarios will require a stronger identity (token + operator profile); v1 uses OS user as a placeholder under the Trusted Operator model.

### Phase 2: Ledger Pruning & Hygiene
**Pruning Safety Analysis:**
- **FK Integrity:** Messages and Peer metrics do not currently have hard FK constraints to Tasks in SQLite, but logical relationships exist. We will prune **Messages first**, then **Tasks**, then **PerformanceSnapshots**.
- **Audit Preservation:** Tasks with `approval_status == 'pre_approved'` or involving manual HITL are preserved longer (`RETENTION_DAYS_AUDIT`) than routine autonomous tasks (`RETENTION_DAYS_ROUTINE`).
- **Rate Limiting:** Pruning will be capped at 1,000 rows per table per Janitor pass to prevent I/O spikes.
- **Dry-Run Mode:** Pruning functions will support `dry_run=True` to log expected deletions without executing.
- **Idempotency:** Time-based predicates (`updated_at < threshold`) ensure safe re-runs.

- **Task Pruning:** Implement `TaskExecutor.prune_tasks(days_routine, days_audit, dry_run=False)` in `execution.py`.
- **Message Pruning:** Implement `MessageManager.prune_messages(retention_days, dry_run=False)` in a new `core/messages.py`.
- **Janitor Integration:** Update `run_task_janitor` in `swarm.py` to trigger daily pruning.
- **Retention Settings:**
  - `settings.RETENTION_DAYS_ROUTINE = 7` (Default window for post-mortem debugging of routine tasks).
  - `settings.RETENTION_DAYS_AUDIT = 30` (Default window for HITL and pre-approved tasks to ensure audit trail).

### Phase 3: Verification & Hardening
- **Automated Test Suite:**
  - `src/a2a_node/tests/test_admin_cli.py`: Functional tests for CLI commands against a live A2A node.
  - `src/a2a_node/tests/test_pruning_logic.py`: Unit tests for pruning order, rate limits, and safety.
- **Documentation:** Create `src/a2a_node/README.md` covering architecture, security (HMAC), and governance.

### PR Sequencing
- **PR1 (Trust):** CLI Profile + Grant commands (using existing API endpoints).
- **PR2 (Governance):** Quarantine/Unquarantine API endpoints + CLI peer commands + audit hook.
- **PR3 (Hygiene):** Ledger pruning logic + Janitor integration + retention settings + tests.

## 4. Verification & Testing
- **CLI Verification:** Verify correct HMAC headers and payload for new subcommands.
- **Integration Tests:** Issue a grant via CLI, verify task pre-approval, then revoke and verify rejection.
- **Hygiene Tests:** Inject 2,000 stale tasks, run Janitor, verify exactly 1,000 are pruned (rate limit) and audit rows remain.

## 5. Migration & Rollback
- **Schema:** No new tables required; reusing `health_metadata` for manual quarantine audits.
- **Rollback:** Revert `bin/medusa.js` and `swarm.py`.
