import pytest
import asyncio
from app.api.gossip import run_gossip
from app.models.ledger import PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC, timedelta
import uuid
from unittest.mock import patch, AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_run_gossip_one_iteration():
    # Setup peers
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        p1 = PeerEntry(id=f"p1-{uid}", address="http://loc:1", status="active", last_seen=datetime.now(UTC).replace(tzinfo=None))
        db.add(p1)
        await db.commit()
        
    with patch("app.api.gossip.settings") as mock_settings:
        mock_settings.GOSSIP_INTERVAL = 0.1
        mock_settings.PROJECT_NAME = "medusa"
        mock_settings.PORT = 3200
        
        # Mock httpx to simulate peer sync
        with patch("app.api.gossip.httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "peers": [], "tasks": [], "messages": []
            }
            mock_get.return_value = mock_response
            
            # Run loop
            gossip_task = asyncio.create_task(run_gossip())
            await asyncio.sleep(0.5)
            gossip_task.cancel()
            try: await gossip_task
            except asyncio.CancelledError: pass
            
            # Should have called mock_get at least once
            assert mock_get.called
