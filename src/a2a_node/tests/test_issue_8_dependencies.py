import pytest
import uuid
import asyncio
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal, init_db
from app.core.execution import check_dependencies, sync_parent_status
from sqlalchemy import select, or_, and_
from app.core.config import settings
from unittest.mock import patch, MagicMock

@pytest.mark.asyncio
async def test_dependency_eligibility_scenarios():
    """
    Comprehensive test for Issue #8: Dependency resolution and stall prevention.
    """
    await init_db()
    
    async with AsyncSessionLocal() as db:
        # Scenario 1: Completed dependency (Should work)
        dep1_id = str(uuid.uuid4())
        db.add(TaskEntry(id=dep1_id, task_type="t", description="d", status="completed"))
        
        task1_id = str(uuid.uuid4())
        task1 = TaskEntry(id=task1_id, task_type="t", description="d", status="pending", assigned_to="local", depends_on=[dep1_id])
        db.add(task1)
        
        # Scenario 2: Multiple dependencies, one incomplete (Should NOT be eligible)
        dep2a_id = str(uuid.uuid4())
        dep2b_id = str(uuid.uuid4())
        db.add(TaskEntry(id=dep2a_id, task_type="t", description="d", status="completed"))
        db.add(TaskEntry(id=dep2b_id, task_type="t", description="d", status="pending"))
        
        task2_id = str(uuid.uuid4())
        task2 = TaskEntry(id=task2_id, task_type="t", description="d", status="pending", assigned_to="local", depends_on=[dep2a_id, dep2b_id])
        db.add(task2)

        # Scenario 3: Failed dependency (Does it stall or fail-forward?)
        dep3_id = str(uuid.uuid4())
        db.add(TaskEntry(id=dep3_id, task_type="t", description="d", status="failed"))
        
        task3_id = str(uuid.uuid4())
        task3 = TaskEntry(id=task3_id, task_type="t", description="d", status="pending", assigned_to="local", depends_on=[dep3_id])
        db.add(task3)
        
        await db.commit()

        # Check Scenario 1
        assert await check_dependencies(db, task1) is True
        
        # Check Scenario 2
        assert await check_dependencies(db, task2) is False
        
        # Check Scenario 3
        is_task3_eligible = await check_dependencies(db, task3)
        print(f"DEBUG: Task 3 (failed dep) eligibility: {is_task3_eligible}")
        # If this is False, task3 stalls forever if dep3 fails! This is a likely bug.
        
        # Scenario 4: Parent/Child Sync
        parent_id = str(uuid.uuid4())
        parent = TaskEntry(id=parent_id, task_type="complex", description="d", status="waiting", subtask_count=1)
        db.add(parent)
        
        child_id = str(uuid.uuid4())
        child = TaskEntry(id=child_id, task_type="t", description="d", status="completed", parent_id=parent_id)
        db.add(child)
        await db.commit()
        
        # Run sync
        await sync_parent_status(db=db)
        
        # Reload parent
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == parent_id))
        parent = result.scalars().first()
        print(f"DEBUG: Parent status after sync: {parent.status}")
        assert parent.status == "completed"

@pytest.mark.asyncio
async def test_dependency_db_type_repro():
    """
    Check if JSON columns are handled correctly in SQLite (list vs string).
    """
    await init_db()
    async with AsyncSessionLocal() as db:
        task_id = str(uuid.uuid4())
        dep_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        db.add(TaskEntry(id=task_id, task_type="t", description="d", depends_on=dep_ids))
        await db.commit()
        
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
        task = result.scalars().first()
        print(f"DEBUG: depends_on value: {task.depends_on} (type: {type(task.depends_on)})")
        assert isinstance(task.depends_on, list)
