import pytest
from app.core.execution import TaskExecutor
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid
import sys

@pytest.mark.asyncio
async def test_task_execution_shell():
    """
    Verifies that 'shell' tasks are correctly executed.
    """
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        new_task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="echo 'hello world'",
            status="pending"
        )
        db.add(new_task)
        await db.commit()
    
    # Execute
    result = await TaskExecutor.execute(new_task)
    
    assert result["outcome"] == "completed"
    assert result["stdout"] == "hello world"

@pytest.mark.asyncio
async def test_task_execution_mock():
    """
    Verifies that unknown task types are handled by the mock executor.
    """
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        new_task = TaskEntry(
            id=task_id,
            task_type="other_task",
            description="Test Description",
            status="pending"
        )
        db.add(new_task)
        await db.commit()
    
    # Execute
    result = await TaskExecutor.execute(new_task)
    
    assert "outcome" in result
    assert "Success (Simulated)" in result["outcome"]
    assert "Test Description" in result["output"]
