import pytest
import asyncio
import json
from datetime import datetime, UTC, timedelta
from app.api.gossip import reach_consensus
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import delete, select
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_zero_reputation_swarm():
    """Verify consensus behavior when all nodes have zero reputation."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # 3 nodes with 0 reputation
        nodes = [
            PeerEntry(id=f"node-{i}", address=f"http://loc:{i}", performance={"reputation_score": 0.0})
            for i in range(3)
        ]
        db.add_all(nodes)
        await db.commit()
        
        task = TaskEntry(
            id="task-zero-rep",
            task_type="test",
            description="zero rep test",
            status="pending",
            requires_consensus=1,
            min_votes=3,
            consensus_strategy="majority",
            results_votes={
                "node-0": {"result": "A"},
                "node-1": {"result": "A"},
                "node-2": {"result": "B"}
            }
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        
        # Each node should have 0.1 weight (max(0.1, 0.0))
        # Total weight = 0.3
        # Result A weight = 0.2 (majority)
        await reach_consensus(task)
        
        assert task.consensus_status == "achieved"
        assert task.result == {"result": "A"}
        print("✅ Zero reputation majority works (min weight 0.1 applied).")

@pytest.mark.asyncio
async def test_tie_with_low_reputation():
    """Verify that ties in low-reputation swarms result in conflict (no tie-break)."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # 2 nodes with 0.5 reputation (below 0.9 tie-break threshold)
        nodes = [
            PeerEntry(id=f"node-{i}", address=f"http://loc:{i}", performance={"reputation_score": 0.5})
            for i in range(2)
        ]
        db.add_all(nodes)
        await db.commit()
        
        task = TaskEntry(
            id="task-low-rep-tie",
            task_type="test",
            description="low rep tie test",
            status="pending",
            requires_consensus=1,
            min_votes=2,
            consensus_strategy="majority",
            results_votes={
                "node-0": {"result": "A"},
                "node-1": {"result": "B"}
            }
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        
        # Mock reputations to be exactly 0.5
        with patch("app.core.reputation.ReputationEngine.get_reputation_score", side_effect=lambda x: 0.5):
            await reach_consensus(task)
        
        # Weight A = 0.5, Weight B = 0.5. Total = 1.0. 
        # best_weight (0.5) is NOT > total_weight / 2 (0.5).
        # Tie-break should not trigger because max reputation (0.5) < 0.9.
        assert task.consensus_status == "conflict"
        print("✅ Low reputation tie correctly results in conflict.")

@pytest.mark.asyncio
async def test_partition_merge_logic():
    """Verify that merging votes from two partitioned clusters triggers re-consensus."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # Cluster A: Nodes 0, 1. Cluster B: Nodes 2, 3.
        nodes = [
            PeerEntry(id=f"node-{i}", address=f"http://loc:{i}", performance={"reputation_score": 0.8})
            for i in range(4)
        ]
        db.add_all(nodes)
        
        # Task state in Cluster A (achieved consensus on A)
        task = TaskEntry(
            id="task-partition",
            task_type="test",
            description="partition test",
            status="completed",
            consensus_status="achieved",
            result={"result": "A"},
            requires_consensus=1,
            min_votes=2,
            results_votes={
                "node-0": {"result": "A"},
                "node-1": {"result": "A"}
            },
            updated_at=datetime.now(UTC) - timedelta(minutes=5)
        )
        db.add(task)
        await db.commit()
        
        # Now simulate Cluster B merging its votes (which were for result B)
        from app.api.gossip import merge_sync_data
        
        sync_data = {
            "tasks": [{
                "id": "task-partition",
                "task_type": "test",
                "description": "partition test",
                "status": "completed",
                "consensus_status": "achieved",
                "result": {"result": "B"},
                "requires_consensus": 1,
                "min_votes": 2,
                "results_votes": {
                    "node-2": {"result": "B"},
                    "node-3": {"result": "B"}
                },
                "updated_at": datetime.now(UTC).isoformat(),
                "created_at": (datetime.now(UTC) - timedelta(minutes=10)).isoformat(),
                "claim_timestamp": None,
                "next_retry_at": None
            }],
            "messages": [],
            "peers": []
        }
        
        # Mock reputation to avoid tie-breaking
        with patch("app.core.reputation.ReputationEngine.get_reputation_score", side_effect=lambda x: 0.8):
            await merge_sync_data(sync_data)
        
        # Check task state after merge - use a fresh session or refresh
        async with AsyncSessionLocal() as db_check:
            result = await db_check.execute(select(TaskEntry).filter(TaskEntry.id == "task-partition"))
            task_after = result.scalars().first()
        
            # Combined votes: 2 for A, 2 for B.
            # Since they are equal weight (all 0.8) and no node is >= 0.9, it should move to conflict.
            assert len(task_after.results_votes) == 4
            assert task_after.consensus_status == "conflict"
            print("✅ Partition merge correctly detected conflict after vote reconciliation.")
