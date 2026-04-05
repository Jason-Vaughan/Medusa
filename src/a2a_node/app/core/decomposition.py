import uuid
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
        # (Rest of existing rules logic...)
        subtasks = []
        desc_lower = description.lower()
        
        # ... (same as before)

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
        
        # 2. Get decomposition plan from LLM
        subtask_plans = await cls.get_decomposition_plan(parent_task.description, parent_task.context)
        
        # 3. Fallback to hardcoded rules if LLM failed
        if not subtask_plans:
            print(f"⚠️ LLM decomposition failed for {parent_task_id[:8]}. Using fallback rules.", flush=True)
            # Re-implementing a simplified version of get_fallback_rules logic inline or calling it
            desc_lower = parent_task.description.lower()
            clean_desc = parent_task.description.replace("Research and report on ", "").replace("Perform a security audit and report findings for ", "")
            
            if "research" in desc_lower and "report" in desc_lower:
                subtask_plans = [
                    {"type": "research", "desc": f"Gather data: {clean_desc}"},
                    {"type": "analysis", "desc": f"Analyze gathered data: {clean_desc}", "depends_on_idx": [0]},
                    {"type": "report", "desc": f"Draft the final report: {clean_desc}", "depends_on_idx": [1]}
                ]
            elif "implement" in desc_lower or "fix" in desc_lower:
                subtask_plans = [
                    {"type": "analysis", "desc": f"Analyze requirements: {clean_desc}"},
                    {"type": "coding", "desc": f"Perform implementation: {clean_desc}", "depends_on_idx": [0]},
                    {"type": "testing", "desc": f"Verify implementation: {clean_desc}", "depends_on_idx": [1]}
                ]
            elif len(parent_task.description.split()) > 10:
                subtask_plans = [
                    {"type": "subtask_1", "desc": f"Partial execution: {parent_task.description[:30]}..."},
                    {"type": "subtask_2", "desc": f"Remaining execution: {parent_task.description[30:]}..."}
                ]
        
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
                priority=parent_task.priority,
                assigned_to=parent_task.assigned_to, 
                assigned_by=parent_task.assigned_by,
                parent_id=parent_task.id,
                depends_on=deps
            )
            db.add(new_subtask)
        
        # 5. Update parent
        parent_task.status = "decomposing"
        parent_task.subtask_count = len(subtask_plans)
        parent_task.execution_metadata = (parent_task.execution_metadata or {})
        parent_task.execution_metadata["child_ids"] = created_ids
        
        await db.commit()
        
        # Update status to waiting
        parent_task.status = "waiting"
        await db.commit()
        
        print(f"🐝 Decomposed {parent_task_id[:8]} into {len(created_ids)} subtasks via LLM.", flush=True)
        
        return {
            "status": "success",
            "parent_id": parent_task_id,
            "subtask_count": len(created_ids),
            "child_ids": created_ids
        }
