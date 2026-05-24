import pytest
import asyncio
from app.core.swarm import run_task_janitor
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, delete
from datetime import datetime, UTC, timedelta
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_swarm_daily_hygiene_v3():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.commit()
        
    # Mock datetime to simulate 25 hours passing between calls
    start_time = datetime(2026, 5, 24, 12, 0, 0)
    later_time = start_time + timedelta(hours=25)
    
    with patch("app.core.swarm.datetime") as mock_datetime:
        mock_datetime.now.side_effect = [start_time, later_time, later_time, later_time, later_time]
        mock_datetime.fromisoformat = datetime.fromisoformat
        
        with patch("app.core.swarm.settings") as mock_settings:
            # PROVIDE ALL REQUIRED SETTINGS
            mock_settings.PROJECT_NAME = "medusa"
            mock_settings.PORT = 3200
            mock_settings.STALL_TIMEOUT = 300
            mock_settings.TASK_JANITOR_INTERVAL = 0.1
            mock_settings.AUTO_TERM_UPTIME_FLOOR = 1000
            mock_settings.AUTO_TERM_IDLE_TIMEOUT = 1000
            mock_settings.A2A_NODE_TYPE = "seed"
            
            with patch("app.core.execution.TaskExecutor.prune_tasks", new_callable=AsyncMock) as mock_prune:
                janitor = asyncio.create_task(run_task_janitor())
                await asyncio.sleep(0.5)
                janitor.cancel()
                try: await janitor
                except asyncio.CancelledError: pass
                
                assert mock_prune.called
