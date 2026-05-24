import pytest
import asyncio
from app.core.swarm import run_swarm_intelligence
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC
import uuid
from unittest.mock import patch, AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_swarm_bidding_and_claim_fixed_v3():
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        t = TaskEntry(id=f"bid-t-{uid}", task_type="research", description="d", status="pending", assigned_to="all")
        db.add(t)
        await db.commit()
        
    with patch("app.core.swarm.settings") as mock_settings:
        mock_settings.PROJECT_NAME = "medusa"
        mock_settings.PORT = 3200
        mock_settings.MEDUSA_SKILLS = "research"
        mock_settings.GOSSIP_INTERVAL = 0.1
        mock_settings.BIDDING_CONFIDENCE_THRESHOLD = 0.5
        mock_settings.STALL_TIMEOUT = 300
        mock_settings.TASK_JANITOR_INTERVAL = 1.0
        
        # Mock ALL dependencies for run_swarm_intelligence
        with patch("app.core.performance.PerformanceMonitor.get_local_load", new_callable=AsyncMock) as mock_load:
            mock_load.return_value = {"total_load": 0}
            
            with patch("app.api.gossip.list_peers", new_callable=AsyncMock) as mock_peers:
                mock_peers.return_value = []
                
                with patch("app.core.swarm.BiddingHeuristics.evaluate_with_swarm_intelligence", new_callable=AsyncMock) as mock_eval:
                    mock_eval.return_value = {"should_bid": True, "confidence": 0.9, "bid_value": 5.0}
                    
                    with patch("app.core.swarm.httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                        mock_response = MagicMock()
                        mock_response.status_code = 200
                        mock_response.json.return_value = {"status": "claimed"}
                        mock_post.return_value = mock_response
                        
                        swarm_task = asyncio.create_task(run_swarm_intelligence())
                        await asyncio.sleep(0.5)
                        swarm_task.cancel()
                        try: await swarm_task
                        except asyncio.CancelledError: pass
                        
                        assert mock_post.called
