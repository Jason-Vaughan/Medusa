import pytest
from app.api.gossip import merge_sync_data
from app.models.ledger import TaskEntry, MessageEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime

@pytest.mark.asyncio
async def test_merge_sync_data_tasks():
    """
    Verifies that merge_sync_data correctly merges task data.
    """
    task_id = "test-task-1"
    sync_data = {
        "tasks": [
            {
                "id": task_id,
                "task_type": "test",
                "description": "Test Task",
                "status": "completed",
                "priority": 1,
                "assigned_to": "remote-node",
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
        ],
        "messages": []
    }
    
    await merge_sync_data(sync_data)
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
        task = result.scalars().first()
        
        assert task is not None
        assert task.id == task_id
        assert task.status == "completed"

@pytest.mark.asyncio
async def test_merge_sync_data_messages():
    """
    Verifies that merge_sync_data correctly merges message data.
    """
    msg_id = "test-msg-1"
    sync_data = {
        "tasks": [],
        "messages": [
            {
                "id": msg_id,
                "sender_id": "remote-node",
                "content": "Hello Swarm",
                "message_type": "chat",
                "received_at": datetime.utcnow().isoformat()
            }
        ]
    }
    
    await merge_sync_data(sync_data)
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(MessageEntry).filter(MessageEntry.id == msg_id))
        msg = result.scalars().first()
        
        assert msg is not None
        assert msg.id == msg_id
        assert msg.content == "Hello Swarm"
