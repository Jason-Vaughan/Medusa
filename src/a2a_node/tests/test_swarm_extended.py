import pytest
import asyncio
from app.core.swarm import (
    run_swarm_intelligence, run_task_janitor, 
    perform_graceful_shutdown, mark_active
)
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC, timedelta
import uuid
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_swarm_intelligence_iteration():
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        # Create a task suitable for local node
        t = TaskEntry(
            id=f"swarm-t-{uid}",
            task_type="research", 
            description="swarm test",
            status="pending",
            assigned_to="all"
        )
        db.add(t)
        await db.commit()
        
    with patch("app.core.swarm.settings") as mock_settings:
        mock_settings.PROJECT_NAME = "medusa"
        mock_settings.PORT = 3200
        mock_settings.MEDUSA_SKILLS = "research"
        mock_settings.BIDDING_CONFIDENCE_THRESHOLD = 0.1
        
        # Run one iteration of swarm intelligence
        swarm_task = asyncio.create_task(run_swarm_intelligence())
        await asyncio.sleep(0.5)
        swarm_task.cancel()
        try: await swarm_task
        except asyncio.CancelledError: pass

@pytest.mark.asyncio
async def test_graceful_shutdown_v3():
    with patch("app.core.swarm.settings") as mock_settings:
        mock_settings.PORT = 3200
        mock_settings.A2A_NODE_TYPE = "spawned"
        mock_settings.MEDUSA_SERVER_URL = "http://mock-server"
        
        # PerformanceMonitor.get_local_load is called
        with patch("app.core.performance.PerformanceMonitor.get_local_load", new_callable=AsyncMock) as mock_load:
            mock_load.return_value = {"total_load": 0}
            
            with patch("app.core.swarm.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                mock_post.return_value.status_code = 200
                
                # Mock release_port and os._exit
                with patch("app.core.tangleclaw.release_port"):
                    with patch("os._exit") as mock_exit:
                        await perform_graceful_shutdown()
                        mock_exit.assert_called_once_with(0)

def test_mark_active():
    mark_active()
    # Verified by no errors
