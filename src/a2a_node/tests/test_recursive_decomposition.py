import pytest
from unittest.mock import patch, AsyncMock
from app.core.decomposition import DecompositionEngine
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid

@pytest.mark.asyncio
async def test_recursive_decomposition_depth_increment():
    """Verifies that decomposition_depth is incremented in children."""
    parent_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        parent = TaskEntry(
            id=parent_id,
            task_type="level_0",
            description="Top level task research and report",
            decomposition_depth=0
        )
        db.add(parent)
        await db.commit()
    
    mock_plan_1 = {"subtasks": [{"type": "level_1", "desc": "Sub-task research and report"}]}
    mock_plan_2 = {"subtasks": [{"type": "level_2", "desc": "Grandchild task"}]}
    
    with patch("app.core.llm.LLMService.decompose_task", new_callable=AsyncMock) as mock_llm:
        # First call
        mock_llm.return_value = mock_plan_1
        await DecompositionEngine.decompose_task(parent_id)
        
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TaskEntry).filter(TaskEntry.parent_id == parent_id))
            child = res.scalars().first()
            assert child is not None
            assert child.decomposition_depth == 1
            
            # Second call
            mock_llm.return_value = mock_plan_2
            await DecompositionEngine.decompose_task(child.id)
            
            res2 = await db.execute(select(TaskEntry).filter(TaskEntry.parent_id == child.id))
            grandchild = res2.scalars().first()
            assert grandchild is not None
            assert grandchild.decomposition_depth == 2

@pytest.mark.asyncio
async def test_max_decomposition_depth_limiting():
    """Verifies that decomposition is rejected if max depth is reached."""
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        # Depth 3 is the default max
        task = TaskEntry(
            id=task_id,
            task_type="deep_task",
            description="Too deep task",
            decomposition_depth=3
        )
        db.add(task)
        await db.commit()
        
    result = await DecompositionEngine.decompose_task(task_id)
    assert "error" in result
    assert "Maximum decomposition depth" in result["error"]

@pytest.mark.asyncio
async def test_decomposition_parent_status_waiting():
    """Verifies that parent status moves to 'waiting' after decomposition."""
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        task = TaskEntry(id=task_id, task_type="test", description="Test task research and report", status="pending")
        db.add(task)
        await db.commit()
        
    mock_plan = {"subtasks": [{"type": "sub", "desc": "Sub"}]}
    with patch("app.core.llm.LLMService.decompose_task", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_plan
        await DecompositionEngine.decompose_task(task_id)
        
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
        parent = res.scalars().first()
        assert parent.status == "waiting"

@pytest.mark.asyncio
async def test_subtask_inheritance():
    """Verifies that sub-tasks inherit context and assigned_to from parent."""
    parent_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        parent = TaskEntry(
            id=parent_id,
            task_type="p",
            description="p research and report",
            context="shared_context",
            assigned_to="node_x",
            assigned_by="user_y"
        )
        db.add(parent)
        await db.commit()
        
    mock_plan = {"subtasks": [{"type": "c", "desc": "c"}]}
    with patch("app.core.llm.LLMService.decompose_task", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = mock_plan
        await DecompositionEngine.decompose_task(parent_id)
        
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TaskEntry).filter(TaskEntry.parent_id == parent_id))
        child = res.scalars().first()
        assert child.context == "shared_context"
        assert child.assigned_to == "node_x"
        assert child.assigned_by == "user_y"
