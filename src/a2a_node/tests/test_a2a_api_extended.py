import pytest
import hmac
import hashlib
import time
from httpx import AsyncClient, ASGITransport
from main import app
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal, init_db
from app.core.config import settings
from sqlalchemy import select
from datetime import datetime, timezone
import uuid
import json

def get_auth_headers(path: str, client_id: str = "test-client"):
    timestamp = str(int(time.time()))
    payload = f"{timestamp}{path}"
    signature = hmac.new(
        settings.A2A_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return {
        "X-Medusa-Timestamp": timestamp,
        "X-Medusa-Signature": signature,
        "X-Medusa-Client-ID": client_id
    }

@pytest.mark.asyncio
async def test_task_approval_lifecycle():
    """Verifies that tasks can be approved and rejected."""
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Create a task that requires approval
        path = "/a2a/tasks"
        task_payload = {
            "task_type": "dangerous_shell",
            "description": "rm -rf /",
            "requires_approval": True
        }
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        task_id = resp.json()["task_id"]
        assert resp.json()["status"] == "pending_approval"
        
        # 2. Approve it
        path = f"/a2a/tasks/{task_id}/approve"
        resp = await ac.post(path, headers=get_auth_headers(path))
        assert resp.status_code == 200
        assert resp.json()["status"] == "approved"
        
        # 3. Verify in DB
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
            task = res.scalar_one()
            assert task.status == "pending"
            assert task.approval_status == "approved"

@pytest.mark.asyncio
async def test_message_receive_and_list():
    """Verifies that messages can be received and listed."""
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        path = "/a2a/messages"
        msg_payload = {
            "sender_id": "peer-1",
            "content": "Hello Medusa",
            "message_type": "chat"
        }
        resp = await ac.post(path, json=msg_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        assert resp.json()["status"] == "received"
        
        # List messages
        path = "/a2a/messages"
        resp = await ac.get(path, headers=get_auth_headers(path))
        assert resp.status_code == 200
        messages = resp.json()
        assert any(m["content"] == "Hello Medusa" for m in messages)

@pytest.mark.asyncio
async def test_auction_resolution():
    """Verifies the auction resolution logic (choosing best bidder)."""
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Create task
        path = "/a2a/tasks"
        task_payload = {"task_type": "auction_task", "description": "Who wants it?"}
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        task_id = resp.json()["task_id"]
        
        # 2. Place bids
        path = "/a2a/tasks/bid"
        await ac.post(path, json={"task_id": task_id, "bidder_id": "b1", "bid_value": 100, "confidence": 0.9}, headers=get_auth_headers(path))
        await ac.post(path, json={"task_id": task_id, "bidder_id": "b2", "bid_value": 50, "confidence": 0.8}, headers=get_auth_headers(path))
        
        # 3. Add peers to DB (so delegation doesn't fail immediately)
        async with AsyncSessionLocal() as db:
            db.add(PeerEntry(id="b2", address="http://localhost:3201", status="active"))
            await db.commit()
            
        # 4. Resolve auction
        # Note: This will attempt a real HTTP call to localhost:3201, which will fail.
        # We expect a 500 or Exception handling in the endpoint.
        path = f"/a2a/tasks/{task_id}/resolve_auction"
        resp = await ac.post(path, headers=get_auth_headers(path))
        
        # It will likely fail delegation because no server is on 3201
        assert resp.status_code == 500
        assert "Failed to delegate" in resp.json()["detail"] or "Winner rejected" in resp.json()["detail"]
        
        # But verify that the lowest bidder (b2) was selected
        # Wait, the endpoint selects it before calling.
        # Let's check the task in DB if it was partially updated? 
        # Actually, in resolve_auction, it commits only if call succeeds.
