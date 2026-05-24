import pytest
import asyncio
from app.api.a2a import (
    announce_task, resolve_auction, approve_task, reject_task, BidRequest
)
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC
import uuid
from unittest.mock import patch, AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_a2a_approve_reject_flow_fixed_v3():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        # Status MUST be pending_approval
        t = TaskEntry(id=task_id, task_type="test", description="d", status="pending_approval", requires_approval=1)
        db.add(t)
        await db.commit()
        
        # Approve
        await approve_task(task_id=task_id, db=db)
        await db.refresh(t)
        assert t.approval_status == "approved"
        
        # Reject
        t.status = "pending_approval" 
        await db.commit()
        await reject_task(task_id=task_id, db=db)
        await db.refresh(t)
        assert t.approval_status == "rejected"
        assert t.status == "rejected" 

@pytest.mark.asyncio
async def test_a2a_auction_flow_fixed_v3():
    task_id = "t-" + str(uuid.uuid4())[:8]
    peer_id = "p-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        t = TaskEntry(id=task_id, task_type="test", description="d", status="pending")
        p = PeerEntry(id=peer_id, address="http://loc:1", status="active")
        db.add_all([t, p])
        await db.commit()
        
        # Announce
        with patch("app.api.a2a.httpx.AsyncClient.post") as mock_post:
            mock_post.return_value.status_code = 200
            await announce_task(task_id=task_id, db=db)
            
        # Add a bid
        t.bid_metadata = {"bids": {peer_id: {"bid_value": 10.0, "confidence": 0.9}}}
        await db.commit()
        
        # Resolve
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"task_id": "remote-456", "status": "claimed"}
        
        with patch("app.api.a2a.httpx.AsyncClient.post", return_value=mock_response):
            await resolve_auction(task_id=task_id, db=db)
            
            await db.refresh(t)
            assert t.status == "delegated"
            assert t.assigned_to == peer_id
            assert t.execution_metadata["remote_task_id"] == "remote-456"
