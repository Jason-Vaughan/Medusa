import pytest
import asyncio
from datetime import datetime, UTC, timedelta
from app.api.gossip import reach_consensus, cleanup_zombie_tasks, track_node_conflict, recover_stalled_consensus
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import delete, select
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_node_quarantine_isolation():
    """Verify that a node is quarantined after multiple conflicts and its votes are ignored."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # Setup rogue node and 2 honest nodes
        rogue = PeerEntry(id="rogue-node", address="http://loc:666", status="active", performance={"reputation_score": 0.5})
        h1 = PeerEntry(id="h1", address="http://loc:1", status="active", performance={"reputation_score": 0.8})
        h2 = PeerEntry(id="h2", address="http://loc:2", status="active", performance={"reputation_score": 0.8})
        db.add_all([rogue, h1, h2])
        await db.commit()
        
        # 1. Trigger conflicts to quarantine the rogue node
        for i in range(5):
            await track_node_conflict("rogue-node", db)
        await db.commit()
        
        # Refresh and check status
        result = await db.execute(select(PeerEntry).filter(PeerEntry.id == "rogue-node"))
        rogue_updated = result.scalars().first()
        assert rogue_updated.status == "quarantined"
        assert rogue_updated.health_metadata["conflict_count"] == 5
        
        # 2. Verify quarantined node's vote is ignored in consensus
        task = TaskEntry(
            id="task-quarantine-test",
            task_type="test",
            description="test quarantine",
            status="pending",
            requires_consensus=1,
            min_votes=2,
            results_votes={
                "rogue-node": {"result": "BAD"},
                "h1": {"result": "GOOD"},
                "h2": {"result": "GOOD"}
            }
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        
        await reach_consensus(task)
        
        # Distribution in metadata should show skip/isolation if we added logging, 
        # but the result should be GOOD because rogue was ignored.
        # Wait, my logic skips the vote entirely.
        # So it sees only h1 and h2.
        assert task.consensus_status == "achieved"
        assert task.result == {"result": "GOOD"}
        print("✅ Node quarantine isolation verified.")

@pytest.mark.asyncio
async def test_zombie_task_recovery():
    """Verify that tasks claimed by inactive nodes are automatically reset."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # Node that has been offline for 10 minutes
        dead_node = PeerEntry(
            id="dead-node", 
            address="http://loc:999", 
            last_seen=datetime.now(UTC) - timedelta(minutes=10)
        )
        db.add(dead_node)
        
        # Task claimed by the dead node
        task = TaskEntry(
            id="zombie-task",
            task_type="test",
            description="zombie test",
            status="claimed",
            claimed_by="dead-node",
            claim_timestamp=datetime.now(UTC) - timedelta(minutes=10)
        )
        db.add(task)
        await db.commit()
        
        # Run recovery
        await cleanup_zombie_tasks(db)
        
        # Check task state
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == "zombie-task"))
        recovered_task = result.scalars().first()
        
        assert recovered_task.status == "pending"
        assert recovered_task.claimed_by is None
        assert recovered_task.retry_count == 1
        print("✅ Zombie task recovery verified.")

@pytest.mark.asyncio
async def test_quorum_recovery_downgrade():
    """Verify that a stalled task eventually downgrades its quorum requirement."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # 1. Setup: Task requiring 3 votes, but only 1 node active
        now = datetime.now(UTC).replace(tzinfo=None)
        
        # Active node (self)
        self_node = PeerEntry(
            id="self-node", 
            address="http://loc:1", 
            status="active", 
            last_seen=now
        )
        db.add(self_node)
        
        # Task stalled for 150 seconds (past 120s downgrade threshold)
        task = TaskEntry(
            id="stalled-task",
            task_type="test",
            description="stalled test",
            status="pending",
            requires_consensus=1,
            min_votes=3,
            consensus_status="pending",
            updated_at=now - timedelta(seconds=150),
            results_votes={
                "self-node": {"result": "OK"}
            }
        )
        db.add(task)
        await db.commit()
        
        # 2. Run recovery
        await recover_stalled_consensus(db)
        
        # 3. Verify
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == "stalled-task"))
        recovered_task = result.scalars().first()
        
        # Should have downgraded min_votes to 1 (active nodes)
        assert recovered_task.min_votes == 1
        # Should have achieved consensus because 1/1 votes are OK
        assert recovered_task.consensus_status == "achieved"
        assert recovered_task.status == "completed"
        assert recovered_task.results_metadata["quorum_downgraded"] is True
        assert recovered_task.results_metadata["original_min_votes"] == 3
        
        print("✅ Quorum recovery downgrade verified.")

@pytest.mark.asyncio
async def test_quorum_recovery_expansion_request():
    """Verify that a stalled task requests expansion before downgrading."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        now = datetime.now(UTC).replace(tzinfo=None)
        
        # 1 Active node, task needs 3
        self_node = PeerEntry(id="self-node", address="http://loc:1", status="active", last_seen=now)
        db.add(self_node)
        
        # Stalled for 70 seconds (within 60-120 range for expansion)
        task = TaskEntry(
            id="stalled-expand",
            task_type="test",
            description="stalled expand",
            status="pending",
            requires_consensus=1,
            min_votes=3,
            consensus_status="pending",
            updated_at=now - timedelta(seconds=70)
        )
        db.add(task)
        await db.commit()
        
        with patch("app.api.gossip.PerformanceMonitor.request_mesh_expansion", new_callable=AsyncMock) as mock_expand:
            await recover_stalled_consensus(db)
            mock_expand.assert_called_once()
            
        # Verify metadata flag to avoid spam
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == "stalled-expand"))
        updated_task = result.scalars().first()
        assert "last_expansion_request" in updated_task.execution_metadata
        
        print("✅ Quorum recovery expansion request verified.")
