import pytest
from app.core.execution import check_dependencies, _sync_parent_status_with_session
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid

@pytest.mark.asyncio
async def test_check_dependencies_none():
    """Tasks with no dependencies should return True."""
    task = TaskEntry(id=str(uuid.uuid4()), depends_on=None)
    assert await check_dependencies(None, task) is True

@pytest.mark.asyncio
async def test_check_dependencies_completed():
    """Should return True if all dependencies are completed or failed."""
    dep_id1 = str(uuid.uuid4())
    dep_id2 = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        db.add(TaskEntry(id=dep_id1, status="completed", task_type="t", description="d1"))
        db.add(TaskEntry(id=dep_id2, status="failed", task_type="t", description="d2"))
        await db.commit()
        
        task = TaskEntry(id=str(uuid.uuid4()), depends_on=[dep_id1, dep_id2], description="main")
        assert await check_dependencies(db, task) is True

@pytest.mark.asyncio
async def test_check_dependencies_missing_or_pending():
    """Should return False if any dependency is missing or not finished."""
    dep_id1 = str(uuid.uuid4())
    dep_id2 = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        db.add(TaskEntry(id=dep_id1, status="completed", task_type="t", description="d1"))
        db.add(TaskEntry(id=dep_id2, status="pending", task_type="t", description="d2"))
        await db.commit()
        
        task = TaskEntry(id=str(uuid.uuid4()), depends_on=[dep_id1, dep_id2, str(uuid.uuid4())], description="main")
        assert await check_dependencies(db, task) is False

@pytest.mark.asyncio
async def test_sync_parent_status_success():
    """Parent should complete if all children are finished."""
    parent_id = str(uuid.uuid4())
    child_id1 = str(uuid.uuid4())
    child_id2 = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        db.add(TaskEntry(id=parent_id, status="waiting", task_type="parent", description="p"))
        db.add(TaskEntry(id=child_id1, parent_id=parent_id, status="completed", task_type="child", result={"r":1}, description="c1"))
        db.add(TaskEntry(id=child_id2, parent_id=parent_id, status="completed", task_type="child", result={"r":2}, description="c2"))
        await db.commit()
        
        await _sync_parent_status_with_session(db)
        
        # Verify parent
        res = await db.execute(select(TaskEntry).filter(TaskEntry.id == parent_id))
        parent = res.scalar_one()
        assert parent.status == "completed"
        assert len(parent.result["subtask_results"]) == 2

@pytest.mark.asyncio
async def test_sync_parent_status_one_failed():
    """Parent should fail if any child fails."""
    parent_id = str(uuid.uuid4())
    child_id1 = str(uuid.uuid4())
    child_id2 = str(uuid.uuid4())
    
    async with AsyncSessionLocal() as db:
        db.add(TaskEntry(id=parent_id, status="waiting", task_type="parent", description="p"))
        db.add(TaskEntry(id=child_id1, parent_id=parent_id, status="completed", task_type="child", description="c1"))
        db.add(TaskEntry(id=child_id2, parent_id=parent_id, status="failed", task_type="child", description="c2"))
        await db.commit()
        
        await _sync_parent_status_with_session(db)
        
        res = await db.execute(select(TaskEntry).filter(TaskEntry.id == parent_id))
        parent = res.scalar_one()
        assert parent.status == "failed"
        assert parent.result["outcome"] == "One or more sub-tasks failed"
