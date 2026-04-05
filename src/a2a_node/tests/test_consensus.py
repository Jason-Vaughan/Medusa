import pytest
from app.api.gossip import reach_consensus
from app.models.ledger import TaskEntry

@pytest.mark.asyncio
async def test_consensus_majority_wins():
    # Setup a task that requires consensus
    task = TaskEntry(
        id="test-task",
        task_type="test",
        description="test",
        status="pending",
        requires_consensus=1,
        min_votes=2,
        results_votes={
            "node-1": {"outcome": "success", "data": 1},
            "node-2": {"outcome": "success", "data": 1},
            "node-3": {"outcome": "success", "data": 2}
        },
        consensus_status="pending"
    )
    
    await reach_consensus(task)
    
    assert task.consensus_status == "achieved"
    assert task.result == {"outcome": "success", "data": 1}
    assert task.status == "completed"

@pytest.mark.asyncio
async def test_consensus_quorum_not_reached():
    task = TaskEntry(
        id="test-task",
        task_type="test",
        description="test",
        status="pending",
        requires_consensus=1,
        min_votes=3,
        results_votes={
            "node-1": {"outcome": "success", "data": 1},
            "node-2": {"outcome": "success", "data": 1}
        },
        consensus_status="pending"
    )
    
    await reach_consensus(task)
    
    assert task.consensus_status == "pending"
    assert task.status == "pending"

@pytest.mark.asyncio
async def test_consensus_conflict():
    task = TaskEntry(
        id="test-task",
        task_type="test",
        description="test",
        status="pending",
        requires_consensus=1,
        min_votes=2,
        results_votes={
            "node-1": {"outcome": "success", "data": 1},
            "node-2": {"outcome": "success", "data": 2}
        },
        consensus_status="pending"
    )
    
    await reach_consensus(task)
    
    assert task.consensus_status == "conflict"
    assert task.status == "pending"
