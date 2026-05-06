import uuid
import asyncio
from typing import List, Dict, Any, Optional
from sqlalchemy import select, update
from app.core.database import AsyncSessionLocal
from app.models.ledger import TaskEntry
from app.core.llm import LLMService
from datetime import datetime
import sys

class DecompositionEngine:
    """
    Handles the splitting of complex tasks into sub-tasks.
    Uses LLM prompts to intelligently decompose tasks.
    """
    
    MAX_DECOMPOSITION_DEPTH = 3 # Prevent infinite fractal decomposition loops

    @staticmethod
    async def get_decomposition_plan(description: str, context: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Calls the LLM to generate a decomposition plan.
        """
        print(f"🧠 Asking Medusa's brain to decompose: {description[:50]}...", flush=True)
        llm_response = await LLMService.decompose_task(description, context)
        return llm_response.get("subtasks", [])

    @staticmethod
    def get_fallback_rules(task_type: str, description: str) -> List[Dict[str, Any]]:
        """
        Mock decomposition rules as a safety fallback.
        """
        subtasks = []
        desc_lower = description.lower()
        clean_desc = description.replace("Research and report on ", "").replace("Perform a security audit and report findings for ", "")
        
        if "research" in desc_lower and "report" in desc_lower:
            subtasks = [
                {"type": "research", "desc": f"Gather data: {clean_desc}", "priority": 8},
                {"type": "analysis", "desc": f"Analyze gathered data: {clean_desc}", "priority": 7, "depends_on_idx": [0]},
                {"type": "report", "desc": f"Draft the final report: {clean_desc}", "priority": 6, "depends_on_idx": [1]}
            ]
        elif "implement" in desc_lower or "fix" in desc_lower:
            subtasks = [
                {"type": "analysis", "desc": f"Analyze requirements: {clean_desc}", "priority": 9},
                {"type": "coding", "desc": f"Perform implementation: {clean_desc}", "priority": 8, "depends_on_idx": [0]},
                {"type": "testing", "desc": f"Verify implementation: {clean_desc}", "priority": 7, "depends_on_idx": [1]}
            ]
        elif len(description.split()) > 10:
            subtasks = [
                {"type": "subtask_1", "desc": f"Partial execution: {description[:30]}...", "priority": 5},
                {"type": "subtask_2", "desc": f"Remaining execution: {description[30:]}...", "priority": 5}
            ]
        return subtasks

    @classmethod
    async def decompose_task(cls, parent_task_id: str, db: Optional[AsyncSessionLocal] = None) -> Dict[str, Any]:
        """
        Loads a task, generates sub-tasks, and adds them to the ledger.
        """
        if db is None:
            async with AsyncSessionLocal() as new_db:
                return await cls._decompose_with_session(parent_task_id, new_db)
        else:
            return await cls._decompose_with_session(parent_task_id, db)

    @classmethod
    async def _decompose_with_session(cls, parent_task_id: str, db: Any) -> Dict[str, Any]:
        """
        Internal implementation using a provided session.
        """
        # 1. Fetch parent task
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == parent_task_id))
        parent_task = result.scalars().first()
        
        if not parent_task:
            return {"error": "Parent task not found."}
            
        if parent_task.subtask_count > 0:
            return {"error": "Task already decomposed."}
            
        if parent_task.decomposition_depth >= cls.MAX_DECOMPOSITION_DEPTH:
            return {"error": f"Maximum decomposition depth ({cls.MAX_DECOMPOSITION_DEPTH}) reached. Task is now considered atomic."}
        
        # 2. Get decomposition plan from LLM
        subtask_plans = await cls.get_decomposition_plan(parent_task.description, parent_task.context)
        
        # 3. Fallback to hardcoded rules if LLM failed
        if not subtask_plans:
            print(f"⚠️ LLM decomposition failed for {parent_task_id[:8]}. Using fallback rules.", flush=True)
            subtask_plans = cls.get_fallback_rules(parent_task.task_type, parent_task.description)
        
        if not subtask_plans:
            return {"message": "Task is atomic and cannot be decomposed further."}
        
        # 4. Create sub-tasks
        created_ids = []
        
        # Generate IDs first so we can link them
        for _ in subtask_plans:
            created_ids.append(str(uuid.uuid4()))
        
        # Create sub-task objects with dependencies
        for i, plan in enumerate(subtask_plans):
            subtask_id = created_ids[i]
            
            # Resolve dependencies from indices
            deps = []
            if "depends_on_idx" in plan:
                deps = [created_ids[idx] for idx in plan["depends_on_idx"] if idx < len(created_ids)]
                print(f"🔗 Linking subtask {subtask_id[:8]} -> depends on {deps}", flush=True)

            new_subtask = TaskEntry(
                id=subtask_id,
                task_type=plan.get("type", "task"),
                description=plan.get("desc", "No description"),
                context=parent_task.context,
                status="pending",
                priority=plan.get("priority", parent_task.priority),
                assigned_to=parent_task.assigned_to, 
                assigned_by=parent_task.assigned_by,
                parent_id=parent_task.id,
                depends_on=deps,
                decomposition_depth=parent_task.decomposition_depth + 1
            )
            db.add(new_subtask)
        
        # 5. Update parent
        parent_task.status = "decomposing"
        parent_task.subtask_count = len(subtask_plans)
        parent_task.execution_metadata = (parent_task.execution_metadata or {})
        parent_task.execution_metadata["child_ids"] = created_ids
        
        await db.commit()
        
        # Update status to waiting (waiting for children)
        parent_task.status = "waiting"
        await db.commit()
        
        print(f"🐝 Decomposed {parent_task_id[:8]} into {len(created_ids)} subtasks (Depth: {parent_task.decomposition_depth} -> {parent_task.decomposition_depth + 1}).", flush=True)
        
        return {
            "status": "success",
            "parent_id": parent_task_id,
            "subtask_count": len(created_ids),
            "child_ids": created_ids
        }
