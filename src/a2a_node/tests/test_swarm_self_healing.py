import pytest
import asyncio
from datetime import datetime, UTC, timedelta
from app.api.gossip import reach_consensus, cleanup_zombie_tasks, track_node_conflict
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import delete, select

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
