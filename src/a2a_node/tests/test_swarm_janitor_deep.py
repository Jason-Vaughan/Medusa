import pytest
import asyncio
from app.core.swarm import run_task_janitor, check_auto_termination
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, update, delete
from datetime import datetime, UTC, timedelta
import uuid
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_janitor_stalled_task_recovery_v7():
    uid = str(uuid.uuid4())[:8]
    task_id = f"t-{uid}"
    node_id = f"n-{uid}"
    async with AsyncSessionLocal() as db:
        now = datetime.now(UTC).replace(tzinfo=None)
        old_time = now - timedelta(minutes=10)
        t = TaskEntry(id=task_id, task_type="t", description="d", status="claimed", claimed_by=node_id, updated_at=old_time)
        p = PeerEntry(id=node_id, address="h", status="active", last_seen=now)
        db.add_all([t, p])
        await db.commit()
        await db.execute(update(TaskEntry).where(TaskEntry.id == task_id).values(updated_at=old_time))
        await db.commit()
        
    with patch("app.core.swarm.settings") as mock_settings:
        mock_settings.PROJECT_NAME = "medusa"
        mock_settings.PORT = 3200
        mock_settings.STALL_TIMEOUT = 300
        mock_settings.TASK_JANITOR_INTERVAL = 0.1
        mock_settings.AUTO_TERM_UPTIME_FLOOR = 1000
        mock_settings.AUTO_TERM_IDLE_TIMEOUT = 1000
        mock_settings.A2A_NODE_TYPE = "seed"
        
        # MOCK ReputationEngine to prevent failures in janitor loop
        with patch("app.core.reputation.ReputationEngine.update_reputation", new_callable=AsyncMock):
            janitor = asyncio.create_task(run_task_janitor())
            
            task_fixed = False
            for i in range(20):
                await asyncio.sleep(0.5)
                async with AsyncSessionLocal() as db_check:
                    res = await db_check.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
                    task = res.scalars().first()
                    if task and task.status == "pending":
                        task_fixed = True
                        break
            
            janitor.cancel()
            try: await janitor
            except asyncio.CancelledError: pass
            
            assert task_fixed, f"Janitor failed to reset task status. Last status: {task.status if task else 'None'}"

@pytest.mark.asyncio
async def test_check_auto_termination_trigger_v7():
    with patch("app.core.swarm.settings") as mock_settings:
        mock_settings.A2A_NODE_TYPE = "spawned"
        mock_settings.AUTO_TERM_UPTIME_FLOOR = 5
        mock_settings.AUTO_TERM_IDLE_TIMEOUT = 3
        
        now = datetime.now(UTC)
        with patch("app.core.swarm._start_time", now - timedelta(seconds=10)):
            with patch("app.core.swarm._last_active_time", now - timedelta(seconds=5)):
                with patch("app.core.swarm._is_shutting_down", False):
                    with patch("app.core.swarm.perform_graceful_shutdown", new_callable=AsyncMock) as mock_shutdown:
                        await check_auto_termination()
                        assert mock_shutdown.called
