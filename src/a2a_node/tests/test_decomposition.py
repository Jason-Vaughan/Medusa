import pytest
from unittest.mock import patch, AsyncMock
from app.core.decomposition import DecompositionEngine
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid
import json

@pytest.mark.asyncio
async def test_task_decomposition_llm_success():
    """
    Verifies that tasks are correctly decomposed using mocked LLM responses.
    """
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        new_task = TaskEntry(
            id=task_id,
            task_type="complex_request",
            description="Build a spaceship with sass",
            status="pending"
        )
        db.add(new_task)
        await db.commit()
    
    # Mock LLM response
    mock_llm_response = {
        "subtasks": [
            {"type": "design", "desc": "Design the warp drive, human.", "depends_on_idx": []},
            {"type": "coding", "desc": "Code the autopilot so you don't crash.", "depends_on_idx": [0]},
            {"type": "testing", "desc": "Test if it actually flies or just explodes.", "depends_on_idx": [1]}
        ]
    }
    
    with patch("app.core.llm.LLMService.decompose_task", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = mock_llm_response
        
        # Trigger decomposition
        result = await DecompositionEngine.decompose_task(task_id)
        
        assert result["status"] == "success"
        assert result["subtask_count"] == 3
        mock_decompose.assert_called_once()
    
    # Verify sub-tasks and dependencies in DB
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TaskEntry).filter(TaskEntry.parent_id == task_id))
        children = res.scalars().all()
        
        assert len(children) == 3
        
        # Check dependency linking
        testing_task = next(c for c in children if "explode" in c.description)
        coding_task = next(c for c in children if "autopilot" in c.description)
        
        assert coding_task.id in testing_task.depends_on

@pytest.mark.asyncio
async def test_task_decomposition_fallback():
    """
    Verifies that decomposition falls back to hardcoded rules if LLM fails.
    """
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        new_task = TaskEntry(
            id=task_id,
            task_type="research_report",
            description="Research and report on Martian sass",
            status="pending"
        )
        db.add(new_task)
        await db.commit()
    
    # Mock LLM failure (returning empty subtasks)
    with patch("app.core.llm.LLMService.decompose_task", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = {"subtasks": []}
        
        # Trigger decomposition
        result = await DecompositionEngine.decompose_task(task_id)
        
        assert result["status"] == "success"
        assert result["subtask_count"] == 3 # Should match fallback rule for 'research'
    
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TaskEntry).filter(TaskEntry.parent_id == task_id))
        children = res.scalars().all()
        assert len(children) == 3
        assert any("Gather data" in c.description for c in children)
