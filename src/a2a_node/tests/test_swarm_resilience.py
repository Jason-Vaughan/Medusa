import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock
from app.core.swarm import run_task_janitor
from app.api.gossip import reach_consensus
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select

@pytest.mark.asyncio
async def test_task_janitor_recovery():
    """
    Verifies that the Task Janitor correctly recovers stalled tasks (Chunk 24).
    """
    async with AsyncSessionLocal() as db:
        # 1. Create a stalled task
        import uuid
        task_id = f"stalled-task-{uuid.uuid4().hex[:8]}"
        stalled_time = datetime.utcnow() - timedelta(minutes=10)
        
        task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="echo 'stalled'",
            status="claimed",
            claimed_by="node-1",
            claim_timestamp=stalled_time,
            updated_at=stalled_time,
            retry_count=0
        )
        db.add(task)
        await db.commit()
        
        # 2. Run Janitor once (mocking the loop)
        # We can't easily run the infinite loop, but we can call the logic
        with patch("app.core.swarm.settings") as mock_settings:
            mock_settings.PROJECT_NAME = "medusa"
            mock_settings.PORT = 3200
            mock_settings.STALL_TIMEOUT = 300 # 5 minutes
            
            # We'll use a timeout to let the janitor run one iteration and then cancel it
            janitor_task = asyncio.create_task(run_task_janitor())
            await asyncio.sleep(2) # Give it time to run one loop
            janitor_task.cancel()
            
        # 3. Verify task was reset (using a fresh session to avoid cache)
        async with AsyncSessionLocal() as db_check:
            result = await db_check.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
            updated_task = result.scalars().first()
            
            assert updated_task.status == "pending"
            assert updated_task.claimed_by is None
            assert updated_task.retry_count == 1
            assert updated_task.updated_at > stalled_time
            
            # Cleanup
            await db_check.delete(updated_task)
            await db_check.commit()

@pytest.mark.asyncio
async def test_automated_revote_conflict():
    """
    Verifies that reach_consensus triggers re-vote cool-down on conflict (Chunk 24).
    """
    task = TaskEntry(
        id="conflict-task",
        task_type="consensus_task",
        description="test",
        min_votes=2,
        requires_consensus=1,
        results_votes={
            "node-1": {"output": "A"},
            "node-2": {"output": "B"}
        },
        consensus_status="pending",
        execution_metadata={}
    )
    
    # 1. First consensus check -> Should trigger conflict and cool-down
    await reach_consensus(task)
    assert task.consensus_status == "conflict"
    assert "last_conflict_ts" in task.execution_metadata
    
    # 2. Check again before cool-down -> Should still be conflict
    await reach_consensus(task)
    assert task.consensus_status == "conflict"
    
    # 3. Mock cool-down finished
    task.execution_metadata["last_conflict_ts"] = (datetime.utcnow() - timedelta(minutes=3)).isoformat()
    
    # 4. Check again -> Should trigger RE-VOTE
    await reach_consensus(task)
    assert task.consensus_status == "pending"
    assert task.results_votes == {} # Votes cleared
    assert task.execution_metadata["revote_count"] == 1
    assert task.execution_metadata["last_conflict_ts"] is None
