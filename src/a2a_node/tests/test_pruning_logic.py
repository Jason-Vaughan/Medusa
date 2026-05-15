import pytest
from datetime import datetime, UTC, timedelta
from app.core.execution import TaskExecutor
from app.core.messages import MessageManager
from app.models.ledger import TaskEntry, MessageEntry
from app.core.database import AsyncSessionLocal, init_db
from app.core.config import settings
from sqlalchemy import select, delete
import uuid

@pytest.mark.asyncio
async def test_message_pruning():
    """Verifies that messages are pruned correctly based on threshold and limit."""
    await init_db()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(MessageEntry))
        
        # 1. Create stale messages (older than 7 days)
        stale_ts = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=8)
        msgs = [
            MessageEntry(id=f"stale-{i}", sender_id="test", content="old", received_at=stale_ts)
            for i in range(10)
        ]
        
        # 2. Create fresh messages
        fresh_ts = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        msgs += [
            MessageEntry(id=f"fresh-{i}", sender_id="test", content="new", received_at=fresh_ts)
            for i in range(5)
        ]
        
        db.add_all(msgs)
        await db.commit()
        
    # 3. Run pruning with limit 5
    pruned = await MessageManager.prune_messages(retention_days=7, limit=5)
    assert pruned == 5
    
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(MessageEntry))
        remaining = res.scalars().all()
        assert len(remaining) == 10 # 15 - 5
        
    # 4. Run pruning again to clear rest of stale
    pruned = await MessageManager.prune_messages(retention_days=7, limit=10)
    assert pruned == 5
    
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(MessageEntry))
        remaining = res.scalars().all()
        assert len(remaining) == 5
        assert all(m.id.startswith("fresh") for m in remaining)

@pytest.mark.asyncio
async def test_task_pruning_dual_windows():
    """Verifies dual retention windows for routine vs audit tasks."""
    await init_db()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        
        now = datetime.now(UTC).replace(tzinfo=None)
        
        # 1. Routine task, stale (8 days old) -> Should be pruned
        t1 = TaskEntry(
            id="routine-stale", task_type="test", description="t", status="completed",
            requires_approval=0, approval_status="none", updated_at=now - timedelta(days=8)
        )
        
        # 2. Audit task, not yet stale for audit (15 days old, threshold is 30) -> Should NOT be pruned
        t2 = TaskEntry(
            id="audit-fresh", task_type="test", description="t", status="completed",
            requires_approval=1, approval_status="approved", updated_at=now - timedelta(days=15)
        )
        
        # 3. Audit task, stale (35 days old) -> Should be pruned
        t3 = TaskEntry(
            id="audit-stale", task_type="test", description="t", status="completed",
            requires_approval=0, approval_status="pre_approved", updated_at=now - timedelta(days=35)
        )
        
        # 4. Routine task, fresh (2 days old) -> Should NOT be pruned
        t4 = TaskEntry(
            id="routine-fresh", task_type="test", description="t", status="completed",
            requires_approval=0, approval_status="none", updated_at=now - timedelta(days=2)
        )
        
        db.add_all([t1, t2, t3, t4])
        await db.commit()
        
    # Run pruning
    pruned = await TaskExecutor.prune_tasks(days_routine=7, days_audit=30)
    assert pruned == 2 # t1 and t3
    
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TaskEntry))
        remaining = res.scalars().all()
        ids = [t.id for t in remaining]
        assert "audit-fresh" in ids
        assert "routine-fresh" in ids
        assert "routine-stale" not in ids
        assert "audit-stale" not in ids

@pytest.mark.asyncio
async def test_pruning_dry_run():
    """Verifies dry-run mode doesn't delete anything."""
    await init_db()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        stale_ts = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=10)
        t = TaskEntry(id="dry-run-test", task_type="test", description="t", status="completed", updated_at=stale_ts)
        db.add(t)
        await db.commit()
        
    pruned = await TaskExecutor.prune_tasks(days_routine=7, dry_run=True)
    assert pruned == 1
    
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(TaskEntry).filter(TaskEntry.id == "dry-run-test"))
        assert res.scalars().first() is not None
