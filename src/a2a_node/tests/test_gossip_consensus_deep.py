import pytest
import asyncio
from app.api.gossip import reach_consensus, recover_stalled_consensus, merge_sync_data, cleanup_zombie_tasks
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, update, delete
from datetime import datetime, UTC, timedelta
import uuid
import json
from unittest.mock import patch, AsyncMock, MagicMock

@pytest.mark.asyncio
async def test_reach_consensus_reputation_tiebreak_random():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        n1, n2, n3 = f"n1-{uid}", f"n2-{uid}", f"n3-{uid}"
        t = TaskEntry(
            id=task_id, task_type="test", description="d", 
            requires_consensus=1, min_votes=3,
            results_votes={n1: {"v": 1}, n2: {"v": 2}, n3: {"v": 1}},
        )
        db.add(t)
        await db.commit()
        
        def mock_rep(node_id):
            if node_id == n1: return 0.95 
            return 0.1
            
        with patch("app.core.reputation.ReputationEngine.get_reputation_score", side_effect=mock_rep):
            await reach_consensus(t, db)
            assert t.consensus_status == "achieved"
            assert t.result == {"v": 1}

@pytest.mark.asyncio
async def test_reach_consensus_conflict_escalation_random():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        n1, n2 = f"n1-{uid}", f"n2-{uid}"
        t = TaskEntry(
            id=task_id, task_type="test", description="d", 
            requires_consensus=1, min_votes=2, consensus_status="conflict",
            results_votes={n1: {"v": 1}, n2: {"v": 2}},
            execution_metadata={
                "last_conflict_ts": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
                "revote_count": 3
            }
        )
        db.add(t)
        await db.commit()
        
        with patch("app.core.reputation.ReputationEngine.get_reputation_score", return_value=0.5):
            await reach_consensus(t, db)
            assert t.requires_approval == 1
            assert t.approval_status == "pending"

@pytest.mark.asyncio
async def test_recover_stalled_consensus_expansion_only():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        # Clean up existing tasks to avoid interference
        await db.execute(delete(TaskEntry))
        
        now = datetime.now(UTC).replace(tzinfo=None)
        t = TaskEntry(
            id=task_id, task_type="test", description="d",
            requires_consensus=1, consensus_status="pending", min_votes=100, # Large min_votes
            updated_at=now - timedelta(seconds=90)
        )
        db.add(t)
        await db.commit()
        await db.execute(update(TaskEntry).where(TaskEntry.id == task_id).values(updated_at=now - timedelta(seconds=90)))
        await db.commit()
        
        # Patch BOTH possible locations
        with patch("app.api.gossip.PerformanceMonitor.request_mesh_expansion", new_callable=AsyncMock) as mock_exp:
            with patch("app.core.performance.PerformanceMonitor.request_mesh_expansion", new_callable=AsyncMock) as mock_exp2:
                await recover_stalled_consensus(db)
                assert mock_exp.called or mock_exp2.called

@pytest.mark.asyncio
async def test_cleanup_zombie_tasks_full():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        now = datetime.now(UTC).replace(tzinfo=None)
        # Peer last seen 10 mins ago
        old_time = now - timedelta(minutes=10)
        p = PeerEntry(id="dead-node-" + str(uuid.uuid4())[:8], address="http://loc:1", status="active", last_seen=old_time)
        t = TaskEntry(id=task_id, task_type="test", description="d", status="claimed", claimed_by=p.id, updated_at=old_time)
        db.add_all([p, t])
        await db.commit()
        
        await cleanup_zombie_tasks(db)
        
        await db.refresh(t)
        assert t.status == "pending"
        assert t.claimed_by is None
