# Chunk 26: Agent Capability Profiles & Scoped Pre-approval

## 1. Problem Statement
The current Human-In-The-Loop (HITL) flow requires manual approval for every "risky" task (e.g., shell commands, destructive operations). This creates a bottleneck for autonomous agents (like Gemini CLI or TangleClaw) that need to perform many small operations to achieve a goal.

## 2. Proposed Solution
Implement **Capability Profiles** and **Scoped Grants**.
- **Capability Profiles**: Structured definitions of allowed/denied tool patterns and command regexes.
- **Scoped Grants**: Time-bounded permissions granted to a specific workspace to execute tasks matching a profile without per-task HITL prompts.

## 3. Storage Mechanism

### 3.1 Reputation & Metadata (Existing)
We will leverage `src/a2a_node/app/models/ledger.py` for new tables.

### 3.2 New Table: `capability_profiles`
Stored in the A2A SQLite ledger.

| Column | Type | Description |
|--------|------|-------------|
| id | String (PK) | Unique profile ID (e.g., "fix-it-agent-default") |
| version | Integer | Incremental version |
| description | Text | Human-readable description |
| allowed_patterns | JSON | List of {tool, commandPattern} objects |
| denied_patterns | JSON | List of {tool, commandPattern} objects |
| path_scope | JSON | List of allowed read/write glob patterns |
| approval_routing | JSON | {targetWorkspace, timeout, onTimeout} |
| created_at | DateTime | |

### 3.3 New Table: `workspace_grants`
Stored in the A2A SQLite ledger.

| Column | Type | Description |
|--------|------|-------------|
| id | String (PK) | Unique grant ID |
| workspace_id | String | The workspace receiving the grant |
| profile_id | String | Reference to capability_profiles.id |
| profile_version | Integer | |
| granted_by | String | Workspace ID of the grantor |
| scope | String | Bounded scope (e.g., "chunk:#5") |
| expires_at | DateTime | Hard time bound |
| revoked | Boolean | Immediate revocation flag |
| created_at | DateTime | |

## 4. Integration with HITL Flow

### 4.1 `GovernanceEngine` Extension
Modify `GovernanceEngine.evaluate_task` to check for active grants.

**Logic:**
1. If `requires_approval` is initially determined as `True` by keyword check.
2. Check `workspace_grants` for an active (not expired, not revoked) grant for the `assigned_by` workspace.
3. If grant exists, load the referenced `capability_profile`.
4. Validate the task against `denied_patterns` (Deny always wins).
5. Validate the task against `allowed_patterns`.
6. If allowed and not denied, set `requires_approval = False` and `approval_status = "pre_approved"`.
7. Log the grant usage in the audit ledger.

### 4.2 API Endpoints (Bridged via Medusa)

#### Profile Management
- `POST /a2a/capabilities/profiles`
- `GET /a2a/capabilities/profiles`
- `GET /a2a/capabilities/profiles/:id`

#### Grant Management
- `POST /a2a/workspaces/:id/grants` (Issue a grant)
- `GET /a2a/workspaces/:id/grants` (List active)
- `DELETE /a2a/grants/:id` (Revoke)

#### Approval Routing
- `POST /a2a/approvals/request` (Manual escalation)
- `POST /a2a/approvals/:id/respond` (HITL response)

## 5. Lifecycle & Revocation
- **Expiration**: A background sweeper or check-at-use logic invalidates expired grants.
- **Revocation**: Propagation via Gossip Protocol (broadcast a "revocation" event).
- **Audit**: Every action taken under a grant is logged in `TaskEntry` with a reference to the `grant_id`.

## 6. Security Guardrails
1. **Hard Deny**: `rm -rf *`, `git push --force`, etc., are in default deny lists and cannot be overridden by pre-approval.
2. **Version Invalidation**: Bumping a profile version invalidates all grants using the old version.
3. **Time Bounds**: Default max duration (e.g., 2 hours).

## 7. Next Steps
1. Implement SQLAlchemy models in `ledger.py`.
2. Implement Alembic migration for new tables.
3. Implement API handlers in `a2a.py`.
4. Extend `GovernanceEngine` logic.
5. Implement background expiration sweeper.
