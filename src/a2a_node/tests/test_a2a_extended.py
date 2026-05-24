import pytest
import asyncio
from app.api.a2a import (
    create_task, list_tasks, get_task, 
    delegate_task, resolve_auction, send_message, list_messages,
    DelegateRequest, TaskRequest, MessageRequest
)
from app.models.ledger import TaskEntry, MessageEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, update
from datetime import datetime, UTC
import uuid
from unittest.mock import patch, AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_a2a_task_lifecycle():
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        # Create
        task_data = TaskRequest(task_type="research", description="test", priority=5)
        # Mock DecompositionEngine.decompose_task (actual method name)
        with patch("app.core.decomposition.DecompositionEngine.decompose_task", new_callable=AsyncMock) as mock_dec:
            mock_dec.return_value = {"subtasks": []}
            response = await create_task(task=task_data, db=db, caller_id=f"client-{uid}")
            task_id = response.task_id
            
        # Get
        task = await get_task(task_id=task_id, db=db)
        assert task.task_type == "research"
        
        # Update
        await db.execute(update(TaskEntry).where(TaskEntry.id == task_id).values(status="running"))
        await db.commit()
        task = await get_task(task_id=task_id, db=db)
        assert task.status == "running"
        
        # List
        tasks = await list_tasks(db=db)
        assert any(t.id == task_id for t in tasks)

@pytest.mark.asyncio
async def test_a2a_messages_fixed_v2():
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        peer_id = f"p-{uid}"
        # ADD PEER TO DB
        p = PeerEntry(id=peer_id, address="http://loc:1", status="active")
        db.add(p)
        await db.commit()
        
        msg_data = MessageRequest(sender_id="me", content="hello", message_type="chat", recipient_id=peer_id)
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "delivered"}
        
        with patch("app.api.a2a.httpx.AsyncClient.post", return_value=mock_response):
            await send_message(message=msg_data, db=db)
        
        msgs = await list_messages(db=db)
        assert any("hello" in m.content for m in msgs)

@pytest.mark.asyncio
async def test_a2a_delegate_task_success_fixed_v2():
    task_id = "t-" + str(uuid.uuid4())[:8]
    peer_id = "p-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        t = TaskEntry(id=task_id, task_type="test", description="d", status="pending")
        p = PeerEntry(id=peer_id, address="http://loc:1", status="active")
        db.add_all([t, p])
        await db.commit()
        
        # Correctly mock httpx response
        mock_response = MagicMock()
        mock_response.status_code = 200
        # Ensure json() returns a dict, not a mock or coroutine
        mock_response.json.return_value = {"task_id": "remote-123"}
        
        with patch("app.api.a2a.httpx.AsyncClient.post", return_value=mock_response):
            await delegate_task(req=DelegateRequest(task_id=task_id, peer_id=peer_id), db=db)
            
            await db.refresh(t)
            assert t.status == "delegated"
            assert t.assigned_to == peer_id
            assert t.execution_metadata["remote_task_id"] == "remote-123"
