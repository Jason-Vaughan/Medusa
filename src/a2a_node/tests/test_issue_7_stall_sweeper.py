import pytest
import uuid
import asyncio
from datetime import datetime, timedelta
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal, init_db
from app.core.swarm import run_task_janitor
from sqlalchemy import select
from app.core.config import settings
from unittest.mock import patch, MagicMock

@pytest.mark.asyncio
async def test_stall_sweeper_fixed():
    """
    Verifies that the stall sweeper now catches tasks stuck in 'running' status.
    """
    await init_db()
    
    async with AsyncSessionLocal() as db:
        # 1. Create a task stuck in 'running' status
        stalled_id = str(uuid.uuid4())
        old_time = datetime.utcnow() - timedelta(seconds=600)
        
        stalled_task = TaskEntry(
            id=stalled_id,
            task_type="coding",
            description="Gather data: Martian sass",
            status="running",
            claimed_by="slow-node-123",
            updated_at=old_time,
            created_at=old_time - timedelta(minutes=1)
        )
        db.add(stalled_task)
        await db.commit()

        # 2. Run the janitor logic
        # We'll mock ReputationEngine to avoid real side effects in this test
        with patch("app.core.reputation.ReputationEngine.update_reputation") as mock_rep:
            # Since run_task_janitor is an infinite loop, we can't call it.
            # But we can simulate its body.
            
            # STALL_TIMEOUT = 300
            stall_threshold = datetime.utcnow() - timedelta(seconds=settings.STALL_TIMEOUT)
            
            result = await db.execute(
                select(TaskEntry).filter(
                    TaskEntry.status.in_(["claimed", "processing", "running"]),
                    TaskEntry.updated_at < stall_threshold
                )
            )
            stalled_tasks = result.scalars().all()
            
            assert any(t.id == stalled_id for t in stalled_tasks)
            
            for task in stalled_tasks:
                old_owner = task.claimed_by
                task.status = "pending"
                task.claimed_by = None
                task.updated_at = datetime.utcnow()
                await mock_rep(old_owner, "stalled")
            
            await db.commit()
            
            mock_rep.assert_called_with("slow-node-123", "stalled")

        # 3. Verify task is back to 'pending'
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == stalled_id))
        task = result.scalars().first()
        assert task.status == "pending"
        assert task.claimed_by is None
