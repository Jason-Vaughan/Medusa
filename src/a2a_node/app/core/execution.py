import asyncio
import subprocess
import os
from sqlalchemy import select, update, or_, and_
from app.core.database import AsyncSessionLocal
from app.models.ledger import TaskEntry
from app.core.config import settings
from app.core.heuristics import BiddingHeuristics
from app.core.decomposition import DecompositionEngine
from app.core.governance import GovernanceEngine
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

async def sync_parent_status():
    """
    Checks on 'waiting' parent tasks and completes them if all children are done.
    """
    async with AsyncSessionLocal() as db:
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
        
    return all(d.status == "completed" for d in deps)

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
                node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
                result = await db.execute(
                    select(TaskEntry)
                    .filter(
                        or_(
                            and_(TaskEntry.status == "pending", TaskEntry.assigned_to == "local"),
                            and_(TaskEntry.status == "claimed", TaskEntry.claimed_by == node_id),
                            and_(TaskEntry.requires_consensus == 1, TaskEntry.consensus_status != "achieved")
                        )
                    )
                    .order_by(TaskEntry.priority.desc(), TaskEntry.created_at.asc())
                )
                tasks = result.scalars().all()

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

                    # NEW: Autonomous Decomposition Check
                    decomp_eval = BiddingHeuristics.evaluate_decomposition(task.task_type, task.description)
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
                    
                    # 2. Real Execution
                    result = await TaskExecutor.execute(task)
                    
                    # 3. Update Status and Result with Retry Logic
                    outcome = result.get("outcome")
                    
                    if outcome == "failed" and task.retry_count < task.max_retries:
                        task.retry_count += 1
                        task.status = "pending" # Put it back in queue
                        print(f"🔄 Task {task.id[:8]} failed. Retrying ({task.retry_count}/{task.max_retries})...", flush=True)
                        
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
