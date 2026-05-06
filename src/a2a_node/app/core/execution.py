import asyncio
import subprocess
import os
import time
from sqlalchemy import select, update, or_, and_
from app.core.database import AsyncSessionLocal
from app.models.ledger import TaskEntry
from app.core.config import settings
from app.core.heuristics import BiddingHeuristics
from app.core.decomposition import DecompositionEngine
from app.core.governance import GovernanceEngine
from app.core.reputation import ReputationEngine
from datetime import datetime
import json

class TaskExecutor:
    """
    Handles actual task execution based on task types.
    """
    @staticmethod
    async def execute(task: TaskEntry):
        """
        Dispatches execution based on task type.
        """
        task_type = task.task_type.lower()
        
        if task_type == "shell" or task_type == "command":
            return await TaskExecutor.run_shell_command(task.description)
        elif task_type.startswith("medusa_") or task_type.startswith("mcp_"):
            return await TaskExecutor.invoke_mcp_tool(task_type, task.description, task.context)
        else:
            # Fallback for unknown types (simulated for now)
            await asyncio.sleep(2)
            return {
                "outcome": "Success (Simulated)",
                "processed_by": f"{settings.PROJECT_NAME}-{settings.PORT}",
                "timestamp": datetime.utcnow().isoformat(),
                "output": f"Processed '{task.description}' with extreme efficiency and moderate sass."
            }

    @staticmethod
    async def run_shell_command(command: str):
        """
        Runs a local shell command and returns the output.
        """
        try:
            # Dangerous: In a production environment, this should be heavily sandboxed
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            return {
                "outcome": "completed" if process.returncode == 0 else "failed",
                "exit_code": process.returncode,
                "stdout": stdout.decode().strip(),
                "stderr": stderr.decode().strip(),
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                "outcome": "failed",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }

    @staticmethod
    async def invoke_mcp_tool(tool_name: str, description: str, context: dict = None):
        """
        Invokes a Medusa MCP tool via the medusa CLI.
        """
        try:
            # Construct command: medusa medusa send ...
            # This bridges A2A tasks back to our CLI tools
            cmd = f"medusa {tool_name.replace('medusa_', 'medusa ')} \"{description}\""
            
            process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            return {
                "outcome": "completed" if process.returncode == 0 else "failed",
                "tool": tool_name,
                "stdout": stdout.decode().strip(),
                "stderr": stderr.decode().strip(),
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                "outcome": "failed",
                "tool": tool_name,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }

async def sync_parent_status(db: Optional[AsyncSession] = None):
    """
    Checks on 'waiting' parent tasks and completes them if all children are done.
    """
    if db is None:
        async with AsyncSessionLocal() as new_db:
            await _sync_parent_status_with_session(new_db)
    else:
        await _sync_parent_status_with_session(db)

async def _sync_parent_status_with_session(db: AsyncSession):
    """
    Internal implementation of parent status sync using a provided session.
    """
    # 1. Fetch 'waiting' tasks
    result = await db.execute(
        select(TaskEntry).filter(TaskEntry.status == "waiting")
    )
    parents = result.scalars().all()

    for parent in parents:
        # 2. Check children
        child_result = await db.execute(
            select(TaskEntry).filter(TaskEntry.parent_id == parent.id)
        )
        children = child_result.scalars().all()

        if not children:
            continue

        all_done = all(c.status in ["completed", "failed"] for c in children)

        if all_done:
            print(f"🐝 Hive sync: Parent {parent.id} all children finished. Aggregating results.", flush=True)

            # Aggregate results
            results = []
            for c in children:
                results.append({
                    "id": c.id,
                    "type": c.task_type,
                    "status": c.status,
                    "result": c.result
                })

            parent.status = "completed"
            parent.result = {
                "outcome": "Sub-tasks completed",
                "subtask_results": results,
                "timestamp": datetime.utcnow().isoformat()
            }
            # We don't commit here if session is provided, caller handles it.
            # Actually, for safety with this specific background logic, we should commit.
            await db.commit()

async def check_dependencies(db, task):
    """
    Checks if all tasks this task depends on are completed.
    Returns True if no dependencies or all are completed.
    """
    if not task.depends_on:
        return True
    
    # Check status of all dependency IDs
    result = await db.execute(
        select(TaskEntry).filter(TaskEntry.id.in_(task.depends_on))
    )
    deps = result.scalars().all()
    
    # If some dependencies are missing from DB, we assume they're not done
    if len(deps) < len(task.depends_on):
        return False
        
    # We allow 'failed' dependencies to unblock the chain, otherwise the system stalls forever.
    # The dependent task itself will decide how to handle the failure in its execution logic if needed.
    return all(d.status in ["completed", "failed"] for d in deps)

async def run_execution_engine():
    """
    Background task that processes pending local tasks.
    """
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    print(f"⚙️ Execution Engine started for node {node_id}", flush=True)

    while True:
        try:
            # First, sync parent statuses
            await sync_parent_status()

            async with AsyncSessionLocal() as db:
                # 1. Fetch pending tasks assigned to local or claimed by local
                # Or tasks that require consensus and haven't achieved it yet
                # Filter by next_retry_at (Chunk 28)
                node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
                now = datetime.utcnow()
                result = await db.execute(
                    select(TaskEntry)
                    .filter(
                        and_(
                            or_(
                                and_(TaskEntry.status == "pending", TaskEntry.assigned_to == "local"),
                                and_(TaskEntry.status == "claimed", TaskEntry.claimed_by == node_id),
                                and_(TaskEntry.requires_consensus == 1, TaskEntry.consensus_status != "achieved")
                            ),
                            or_(
                                TaskEntry.next_retry_at == None,
                                TaskEntry.next_retry_at <= now
                            )
                        )
                    )
                    .order_by(TaskEntry.priority.desc(), TaskEntry.created_at.asc())
                )


                for task in tasks:
                    # Governance Check: Skip tasks requiring approval
                    if task.status == "pending_approval":
                        continue

                    # Consensus Check: Skip if we already voted
                    if task.requires_consensus:
                        votes = task.results_votes or {}
                        if node_id in votes:
                            continue
                        # If it achieved consensus while we were waiting, skip
                        if task.consensus_status == "achieved":
                            continue

                    # Yield Logic: If someone else claimed it better/earlier (and not consensus-required)
                    # We check the DB state again to be sure (gossip might have updated it)
                    if not task.requires_consensus and task.claimed_by and task.claimed_by != node_id:
                        # Someone else claimed it. Yield.
                        continue

                    # NEW: Dependency Check for Swarm Coordination
                    if not await check_dependencies(db, task):
                        # print(f"⏳ Task {task.id} waiting for dependencies: {task.depends_on}", flush=True)
                        continue

                    # Load Check (Chunk 20)
                    from app.core.performance import PerformanceMonitor
                    load_info = await PerformanceMonitor.get_current_load()
                    current_load = load_info.get("total_load", 0)

                    # NEW: Autonomous Decomposition Check
                    decomp_eval = BiddingHeuristics.evaluate_decomposition(task.task_type, task.description, current_load=current_load)
                    if decomp_eval["should_decompose"] and task.subtask_count == 0:
                        print(f"🐝 Swarm Intelligence: Task {task.id[:8]} is complex. Decomposing...", flush=True)
                        decomp_result = await DecompositionEngine.decompose_task(task.id, db=db)
                        if "error" not in decomp_result:
                            print(f"✅ Successfully decomposed into {decomp_result.get('subtask_count')} sub-tasks.", flush=True)
                            continue # Parent is now 'waiting', move to next task
                        else:
                            print(f"⚠️ Decomposition failed: {decomp_result.get('error')}. Executing atomically.", flush=True)

                    print(f"🚀 Executing task: {task.id} ({task.task_type})", flush=True)
                    
                    # Mark as running
                    task.status = "running"
                    await db.commit()
                    
                    # 2. Real Execution with latency tracking
                    start_time = time.time()
                    result = await TaskExecutor.execute(task)
                    latency = time.time() - start_time
                    
                    # 3. Update Status and Result with Retry Logic
                    outcome = result.get("outcome")
                    
                    # Record performance metrics
                    await PerformanceMonitor.record_execution(
                        task.task_type, 
                        outcome != "failed", 
                        latency
                    )

                    # Trigger Reputation and Skill Evolution (Chunk 27)
                    rep_event = "completed"
                    if outcome == "failed":
                        rep_event = "failed" if task.retry_count >= task.max_retries else "retried"

                    await ReputationEngine.update_reputation(
                        node_id, 
                        rep_event,
                        {"task_type": task.task_type, "latency": latency}
                    )
                    
                    if outcome == "failed" and task.retry_count < task.max_retries:
                        task.retry_count += 1
                        task.status = "pending" # Put it back in queue
                        
                        # Exponential Backoff (Chunk 28)
                        import random
                        from datetime import timedelta
                        base_delay = 10
                        delay = base_delay * (2 ** task.retry_count)
                        jitter = delay * 0.2
                        final_delay = delay + random.uniform(-jitter, jitter)
                        task.next_retry_at = datetime.utcnow() + timedelta(seconds=final_delay)
                        
                        print(f"🔄 Task {task.id[:8]} failed. Retrying in {final_delay:.1f}s ({task.retry_count}/{task.max_retries})...", flush=True)
                        
                        # Add failure info to metadata
                        if not task.execution_metadata:
                            task.execution_metadata = {}
                        
                        retries = task.execution_metadata.get("retries", [])
                        retries.append({
                            "retry": task.retry_count,
                            "error": result.get("error") or result.get("stderr"),
                            "timestamp": datetime.utcnow().isoformat()
                        })
                        task.execution_metadata["retries"] = retries
                        
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(task, "execution_metadata")
                    else:
                        # SUCCESS or FINAL FAILURE
                        task.status = "completed" if outcome != "failed" else "failed"
                        task.result = result
                        
                        # Phase 12: Consensus Update
                        if task.requires_consensus:
                            votes = task.results_votes or {}
                            votes[node_id] = result
                            task.results_votes = votes
                            task.consensus_status = "pending"
                            
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(task, "results_votes")
                            
                            # Locally attempt to reach consensus
                            from app.api.gossip import reach_consensus
                            await reach_consensus(task)
                        
                        print(f"✅ Finished task: {task.id[:8]} with status: {task.status}", flush=True)
                    
                    await db.commit()
                    
        except Exception as e:
            print(f"⚠️ Execution engine error: {str(e)}", flush=True)
            
        await asyncio.sleep(5) # Poll every 5 seconds
