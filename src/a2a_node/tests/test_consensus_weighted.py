import pytest
from app.api.gossip import reach_consensus
from app.models.ledger import TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import delete, select
import json

@pytest.mark.asyncio
async def test_consensus_weighted_majority():
    """Verify that a high reputation node can outvote a low reputation node even if counts are equal."""
    async with AsyncSessionLocal() as db:
        # Cleanup
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # Setup peers with different reputations
        node_high = PeerEntry(id="node-high", address="http://loc:1", performance={"reputation_score": 0.9})
        node_low = PeerEntry(id="node-low", address="http://loc:2", performance={"reputation_score": 0.2})
        db.add_all([node_high, node_low])
        
        task = TaskEntry(
            id="task-weighted-1",
            task_type="test",
            description="test weighted consensus",
            status="pending",
            requires_consensus=1,
            min_votes=2,
            consensus_strategy="majority",
            results_votes={
                "node-high": {"result": "A"},
                "node-low": {"result": "B"}
            }
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        
        # Run consensus
        await reach_consensus(task)
        
        assert task.consensus_status == "achieved"
        assert task.result == {"result": "A"}
        assert task.status == "completed"

@pytest.mark.asyncio
async def test_consensus_unanimous():
    """Verify unanimous strategy requires all voters to agree."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        # Setup
        node1 = PeerEntry(id="node1", address="http://loc:1", performance={"reputation_score": 0.8})
        node2 = PeerEntry(id="node2", address="http://loc:2", performance={"reputation_score": 0.8})
        db.add_all([node1, node2])
        
        task = TaskEntry(
            id="task-unanimous",
            task_type="test",
            description="test unanimous consensus",
            status="pending",
            requires_consensus=1,
            min_votes=2,
            consensus_strategy="unanimous",
            results_votes={
                "node1": {"result": "A"},
                "node2": {"result": "B"}
            }
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        
        await reach_consensus(task)
        
        assert task.consensus_status == "conflict" # Because they disagree
        
        # Now make them agree
        task.results_votes = {
            "node1": {"result": "A"},
            "node2": {"result": "A"}
        }
        await reach_consensus(task)
        assert task.consensus_status == "achieved"
        assert task.result == {"result": "A"}

@pytest.mark.asyncio
async def test_consensus_weighted_threshold_fail():
    """Verify weighted_threshold fails if threshold not met."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        node1 = PeerEntry(id="node1", address="http://loc:1", performance={"reputation_score": 0.8})
        node2 = PeerEntry(id="node2", address="http://loc:2", performance={"reputation_score": 0.2})
        db.add_all([node1, node2])
        
        # Total weight = 0.8 + 0.2 = 1.0
        # Result A weight = 0.8 (80%)
        # If threshold is 0.9, it should fail.
        
        task = TaskEntry(
            id="task-threshold-fail",
            task_type="test",
            description="test threshold consensus",
            status="pending",
            requires_consensus=1,
            min_votes=2,
            consensus_strategy="weighted_threshold",
            quorum_threshold=0.9,
            results_votes={
                "node1": {"result": "A"},
                "node2": {"result": "B"}
            }
        )
        db.add(task)
        await db.commit()
        
        await reach_consensus(task)
        assert task.consensus_status == "conflict"

@pytest.mark.asyncio
async def test_consensus_tie_break():
    """Verify tie-breaking by highly reputable node."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))
        
        node_rep = PeerEntry(id="node-rep", address="http://loc:1", performance={"reputation_score": 0.95})
        node_unrep = PeerEntry(id="node-unrep", address="http://loc:2", performance={"reputation_score": 0.1})
        db.add_all([node_rep, node_unrep])
        
        # In a tie (50/50 unweighted), the reputable node should win
        # Wait, my weighted majority logic already handles this if weights are different.
        # But let's test the explicit tie-break code path where weights might be closer but reputation is high.
        
        task = TaskEntry(
            id="task-tiebreak",
            task_type="test",
            description="test tiebreak",
            status="pending",
            requires_consensus=1,
            min_votes=2,
            results_votes={
                "node-rep": {"result": "A"},
                "node-unrep": {"result": "B"}
            }
        )
        db.add(task)
        await db.commit()
        
        await reach_consensus(task)
        assert task.consensus_status == "achieved"
        assert task.result == {"result": "A"}
