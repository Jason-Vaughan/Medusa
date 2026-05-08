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
from datetime import datetime, UTC
import json
from typing import Optional

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
                "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat(),
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
                "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat()
            }
        except Exception as e:
            return {
                "outcome": "failed",
                "error": str(e),
                "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat()
            }

    @staticmethod
    async def invoke_mcp_tool(tool_name: str, description: str, context: dict = None):
        """
        Invokes a Medusa MCP tool via the medusa CLI.
        """
        try:
            # Construct command: medusa medusa send ...
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
                "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat()
            }
        except Exception as e:
            return {
                "outcome": "failed",
                "tool": tool_name,
                "error": str(e),
                "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat()
            }

async def sync_parent_status(db: Optional[AsyncSessionLocal] = None):
    """
    Checks on 'waiting' parent tasks and completes them if all children are done.
    """
    if db is None:
        async with AsyncSessionLocal() as new_db:
            await _sync_parent_status_with_session(new_db)
    else:
        await _sync_parent_status_with_session(db)

async def _sync_parent_status_with_session(db):
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

            # Aggregate results and check for any failures
            aggregated_results = []
            any_failed = False
            for c in children:
                aggregated_results.append({
                    "id": c.id,
                    "type": c.task_type,
                    "status": c.status,
                    "result": c.result
                })
                if c.status == "failed":
                    any_failed = True

            parent.status = "failed" if any_failed else "completed"
            parent.result = {
                "outcome": "One or more sub-tasks failed" if any_failed else "Sub-tasks completed",
                "subtask_results": aggregated_results,
                "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat()
            }
            await db.commit()

async def check_dependencies(db, task):
    """
    Checks if all tasks this task depends on are completed.
    Returns True if no dependencies or all are completed.
    """
    if not task.depends_on:
        return True
    
    result = await db.execute(
        select(TaskEntry).filter(TaskEntry.id.in_(task.depends_on))
    )
    deps = result.scalars().all()
    
    if len(deps) < len(task.depends_on):
        return False
        
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
                node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
                now = datetime.now(UTC).replace(tzinfo=None)
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
                tasks = result.scalars().all()

                for task in tasks:
                    if task.status == "pending_approval":
                        continue

                    if task.requires_consensus:
                        votes = task.results_votes or {}
                        if node_id in votes:
                            continue
                        if task.consensus_status == "achieved":
                            continue

                    if not task.requires_consensus and task.claimed_by and task.claimed_by != node_id:
                        continue

                    if not await check_dependencies(db, task):
                        continue

                    from app.core.performance import PerformanceMonitor
                    load_info = await PerformanceMonitor.get_current_load()
                    current_load = load_info.get("total_load", 0)

                    decomp_eval = BiddingHeuristics.evaluate_decomposition(task.task_type, task.description, current_load=current_load)
                    if decomp_eval["should_decompose"] and task.subtask_count == 0:
                        print(f"🐝 Swarm Intelligence: Task {task.id[:8]} is complex. Decomposing...", flush=True)
                        decomp_result = await DecompositionEngine.decompose_task(task.id, db=db)
                        if "error" not in decomp_result:
                            print(f"✅ Successfully decomposed into {decomp_result.get('subtask_count')} sub-tasks.", flush=True)
                            continue 
                        else:
                            print(f"⚠️ Decomposition failed: {decomp_result.get('error')}. Executing atomically.", flush=True)

                    print(f"🚀 Executing task: {task.id} ({task.task_type})", flush=True)
                    
                    task.status = "running"
                    await db.commit()
                    
                    start_time = time.time()
                    result = await TaskExecutor.execute(task)
                    latency = time.time() - start_time
                    
                    outcome = result.get("outcome")
                    await PerformanceMonitor.record_execution(
                        task.task_type, 
                        outcome != "failed", 
                        latency
                    )

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
                        task.status = "pending"
                        
                        import random
                        from datetime import timedelta
                        base_delay = 10
                        delay = base_delay * (2 ** task.retry_count)
                        jitter = delay * 0.2
                        final_delay = delay + random.uniform(-jitter, jitter)
                        task.next_retry_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=final_delay)
                        
                        print(f"🔄 Task {task.id[:8]} failed. Retrying in {final_delay:.1f}s ({task.retry_count}/{task.max_retries})...", flush=True)
                        
                        if not task.execution_metadata:
                            task.execution_metadata = {}
                        
                        retries = task.execution_metadata.get("retries", [])
                        retries.append({
                            "retry": task.retry_count,
                            "error": result.get("error") or result.get("stderr"),
                            "timestamp": datetime.now(UTC).replace(tzinfo=None).isoformat()
                        })
                        task.execution_metadata["retries"] = retries
                        
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(task, "execution_metadata")
                    else:
                        task.status = "completed" if outcome != "failed" else "failed"
                        task.result = result
                        
                        if task.requires_consensus:
                            votes = task.results_votes or {}
                            votes[node_id] = result
                            task.results_votes = votes
                            task.consensus_status = "pending"
                            
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(task, "results_votes")
                            
                            from app.api.gossip import reach_consensus
                            await reach_consensus(task)
                        
                        print(f"✅ Finished task: {task.id[:8]} with status: {task.status}", flush=True)
                    
                    await db.commit()
                    
        except Exception as e:
            print(f"⚠️ Execution engine error: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            
        await asyncio.sleep(5)
