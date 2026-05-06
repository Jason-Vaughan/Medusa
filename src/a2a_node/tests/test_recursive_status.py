import pytest
from unittest.mock import patch, AsyncMock
from app.core.execution import _sync_parent_status_with_session, check_dependencies, TaskExecutor
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, delete
import uuid

@pytest.mark.asyncio
async def test_sync_parent_status_success():
    """Verifies parent moves to completed when all children are successful."""
    parent_id = "parent-1"
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        parent = TaskEntry(id=parent_id, task_type="test", description="parent", status="waiting", subtask_count=2)
        c1 = TaskEntry(id="c1", parent_id=parent_id, task_type="test", description="c1", status="completed", result={"ok": True})
        c2 = TaskEntry(id="c2", parent_id=parent_id, task_type="test", description="c2", status="completed", result={"ok": True})
        db.add_all([parent, c1, c2])
        await db.commit()
        
        await _sync_parent_status_with_session(db)
        
        await db.refresh(parent)
        assert parent.status == "completed"
        assert "subtask_results" in parent.result
        assert len(parent.result["subtask_results"]) == 2

@pytest.mark.asyncio
async def test_sync_parent_status_failure_propagation():
    """Verifies parent moves to failed if any child fails."""
    parent_id = "parent-fail"
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        parent = TaskEntry(id=parent_id, task_type="test", description="parent", status="waiting", subtask_count=2)
        c1 = TaskEntry(id="c1-fail", parent_id=parent_id, task_type="test", description="c1", status="failed", result={"error": "boom"})
        c2 = TaskEntry(id="c2-ok", parent_id=parent_id, task_type="test", description="c2", status="completed", result={"ok": True})
        db.add_all([parent, c1, c2])
        await db.commit()
        
        await _sync_parent_status_with_session(db)
        
        await db.refresh(parent)
        assert parent.status == "failed"
        assert "One or more sub-tasks failed" in parent.result["outcome"]

@pytest.mark.asyncio
async def test_sync_parent_status_still_waiting():
    """Verifies parent stays waiting if some children are not finished."""
    parent_id = "parent-wait"
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        parent = TaskEntry(id=parent_id, task_type="test", description="parent", status="waiting", subtask_count=2)
        c1 = TaskEntry(id="c1-running", parent_id=parent_id, task_type="test", description="c1", status="running")
        c2 = TaskEntry(id="c2-done", parent_id=parent_id, task_type="test", description="c2", status="completed")
        db.add_all([parent, c1, c2])
        await db.commit()
        
        await _sync_parent_status_with_session(db)
        
        await db.refresh(parent)
        assert parent.status == "waiting"

@pytest.mark.asyncio
async def test_check_dependencies():
    """Verifies dependency blocking and unblocking logic."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        
        t1 = TaskEntry(id="dep-1", task_type="test", description="d1", status="completed")
        t2 = TaskEntry(id="dep-2", task_type="test", description="d2", status="running")
        t3 = TaskEntry(id="target", task_type="test", description="t", status="pending", depends_on=["dep-1", "dep-2"])
        db.add_all([t1, t2, t3])
        await db.commit()
        
        # Should be blocked by t2
        assert await check_dependencies(db, t3) is False
        
        # Unblock t2
        t2.status = "completed"
        await db.commit()
        assert await check_dependencies(db, t3) is True

@pytest.mark.asyncio
async def test_recursive_sync_propagation():
    """Verifies that status propagates from grandchild to child to parent."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        
        parent = TaskEntry(id="p", task_type="test", description="p", status="waiting", subtask_count=1)
        child = TaskEntry(id="c", parent_id="p", task_type="test", description="c", status="waiting", subtask_count=1)
        grandchild = TaskEntry(id="g", parent_id="c", task_type="test", description="g", status="completed")
        db.add_all([parent, child, grandchild])
        await db.commit()
        
        # First sync: grandchild -> child
        await _sync_parent_status_with_session(db)
        await db.refresh(child)
        assert child.status == "completed"
        
        # Second sync (or same loop if handled correctly): child -> parent
        await _sync_parent_status_with_session(db)
        await db.refresh(parent)
        assert parent.status == "completed"
