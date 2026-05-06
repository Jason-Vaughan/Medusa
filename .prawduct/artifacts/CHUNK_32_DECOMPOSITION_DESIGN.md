# Chunk 32: Advanced Task Decomposition 2.0 - Recursive Splitting & Dependency Mesh

## 1. Problem Statement
The current decomposition logic (Chunk 22) is shallow: a parent task is split into one level of sub-tasks. If a sub-task is still complex, it is executed as a single unit, which might be inefficient or exceed local node capabilities. Additionally, while sub-tasks have dependency indices, the swarm lacks a robust "Dependency Mesh" to visualize and manage these relationships in real-time across different nodes.

## 2. Proposed Solution
Implement **Advanced Task Decomposition 2.0**:
- **Recursive Decomposition**: Allow sub-tasks to be further decomposed if they meet the complexity threshold.
- **Dependency Mesh**: Enhanced tracking of sub-task status and result propagation back to parents.
- **Recursive Success/Failure**: Propagate status changes up the tree (e.g., if any required sub-task fails, the parent marks as failed or triggers re-decomposition).
- **Consensus on Sub-tasks**: Support `requires_consensus` for individual sub-tasks.

## 3. Technical Implementation

### 3.1 Recursive Splitting
Modify `app/core/decomposition.py`:
- In the task execution loop, before a node starts a task, it calls `evaluate_decomposition`.
- If a task is a sub-task (has `parent_id`), it is still eligible for decomposition.
- Ensure depth limits (e.g., max 3 levels) to prevent "decomposition loops."

### 3.2 Dependency Mesh Logic
Modify `app/core/execution.py` and `app/api/gossip.py`:
- When a sub-task completes, the node must notify the node holding the parent task.
- Parents should "listen" for child completions to unblock subsequent sub-tasks (if `depends_on` is present).
- Implement `check_parent_unblocking` in the gossip loop.

### 3.3 Dashboard Visualization
Update `src/medusa/dashboard.js`:
- Support nested task trees (recursive rendering).
- Visualize dependencies with lines or color coding in the task list.

## 4. Verification Plan
1. **Unit Tests**: `tests/test_recursive_decomposition.py`
   - Verify a task splits into sub-tasks, and one sub-task splits further.
   - Verify depth limiting.
2. **Integration Tests**: `swarm_tester.py`
   - Simulate a complex multi-stage project (e.g., "Build a website" -> "Frontend", "Backend" -> "Frontend" -> "Logo", "Layout").

---
*"One level is for amateurs. Medusa thinks in fractals."* 🕸️💎👑
