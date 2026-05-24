import pytest
import asyncio
from fastapi import HTTPException
from app.api.gossip import (
    ping, list_peers, quarantine_peer, unquarantine_peer, 
    terminate_peer, sync_ledger, claim_task, reach_consensus,
    cleanup_zombie_tasks, recover_stalled_consensus, merge_sync_data,
    PeerStatusAction, track_node_conflict
)
from app.models.ledger import PeerEntry, TaskEntry, MessageEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, update
from datetime import datetime, UTC, timedelta
import uuid
import json
from unittest.mock import MagicMock, patch, AsyncMock

@pytest.mark.asyncio
async def test_peer_endpoints():
    node_id = "p-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        await ping(node_id=node_id, address="http://loc:1", db=db)
        
        # list_peers
        peers = await list_peers(db=db)
        assert any(p.id == node_id for p in peers)
        
        # quarantine
        await quarantine_peer(node_id=node_id, action=PeerStatusAction(reason="r"), operator="op", db=db)
        # unquarantine
        await unquarantine_peer(node_id=node_id, action=PeerStatusAction(reason="r"), operator="op", db=db)
        # terminate
        await terminate_peer(node_id=node_id, db=db)
        res = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
        assert res.scalars().first().status == "terminated"

@pytest.mark.asyncio
async def test_sync_ledger_filtering():
    async with AsyncSessionLocal() as db:
        now = datetime.now(UTC).replace(tzinfo=None)
        await sync_ledger(since=now, db=db) # Should cover lines 177-192

@pytest.mark.asyncio
async def test_claim_task_success():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        t = TaskEntry(id=task_id, task_type="test", description="d", status="pending")
        db.add(t)
        await db.commit()
        
        result = await claim_task(task_id=task_id, node_id="node-1", db=db)
        assert result["status"] == "claimed"
        assert result["claimed_by"] == "node-1"

@pytest.mark.asyncio
async def test_reach_consensus_weighted():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        t = TaskEntry(
            id=task_id, task_type="test", description="d", 
            requires_consensus=1, min_votes=2, consensus_strategy="weighted_threshold",
            results_votes={f"n1-{uid}": {"r": 1}, f"n2-{uid}": {"r": 1}},
            quorum_threshold=0.5
        )
        db.add(t)
        await db.commit()
        
        with patch("app.core.reputation.ReputationEngine.get_reputation_score", return_value=0.7):
            await reach_consensus(t, db)
            assert t.consensus_status == "achieved"

@pytest.mark.asyncio
async def test_merge_sync_data_task_update_branches():
    task_id = "t-" + str(uuid.uuid4())[:8]
    old_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
    new_time = datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=10)
    
    async with AsyncSessionLocal() as db:
        t = TaskEntry(id=task_id, task_type="test", description="d", status="claimed", claimed_by="me", updated_at=old_time)
        db.add(t)
        await db.commit()
        
    data = {
        "tasks": [{
            "id": task_id, "task_type": "test", "description": "d", "status": "completed", 
            "priority": 1, "assigned_to": "all", "claimed_by": "remote", "updated_at": new_time.isoformat(),
            "claim_timestamp": new_time.isoformat()
        }],
        "messages": [],
        "peers": []
    }
    with patch("app.core.reputation.ReputationEngine.update_reputation", new_callable=AsyncMock) as mock_rep:
        await merge_sync_data(data)
        mock_rep.assert_called() # Should cover reputation update on completed

@pytest.mark.asyncio
async def test_merge_sync_data_new_peer():
    uid = str(uuid.uuid4())[:8]
    data = {
        "tasks": [], "messages": [],
        "peers": [{
            "id": f"p-{uid}", "address": "http://loc:1", "status": "active", "last_seen": datetime.now(UTC).isoformat(),
            "capabilities": {"c": 1}, "strategies": {"s": 1}, "performance": {"p": 1}, "health_metadata": {"h": 1}
        }]
    }
    await merge_sync_data(data)
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(PeerEntry).filter(PeerEntry.id == f"p-{uid}"))
        p = res.scalars().first()
        assert p.capabilities == {"c": 1}
        assert p.health_metadata == {"h": 1}

@pytest.mark.asyncio
async def test_merge_sync_data_existing_peer_update():
    peer_id = "p-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        p = PeerEntry(id=peer_id, address="old", status="active", last_seen=datetime(2000, 1, 1))
        db.add(p)
        await db.commit()
        
    data = {
        "tasks": [], "messages": [],
        "peers": [{
            "id": peer_id, "address": "new", "status": "active", "last_seen": datetime.now(UTC).isoformat()
        }]
    }
    await merge_sync_data(data)
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(PeerEntry).filter(PeerEntry.id == peer_id))
        assert res.scalars().first().address == "new"

@pytest.mark.asyncio
async def test_cleanup_zombie_tasks_peer_missing():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        t = TaskEntry(id=task_id, task_type="test", description="d", status="claimed", claimed_by="non-existent-peer")
        db.add(t)
        await db.commit()
        
        await cleanup_zombie_tasks(db)
        
        await db.refresh(t)
        assert t.status == "pending"
