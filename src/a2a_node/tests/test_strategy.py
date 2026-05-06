import pytest
from app.core.heuristics import BiddingHeuristics
from app.models.ledger import PeerEntry
from datetime import datetime, UTC
from unittest.mock import AsyncMock

class MockPeer:
    def __init__(self, node_id, skills, confidence=0.6, load=0, health=None):
        self.id = node_id
        self.strategies = {
            "skills": skills,
            "min_confidence": confidence,
            "current_load": load
        }
        self.status = "active"
        self.performance = {}
        self.health_metadata = health or {"cpu_percent": 10, "memory_percent": 10}

@pytest.mark.asyncio
async def test_strategy_sharing():
    """Verify that share_heuristic returns correct structure."""
    strategy = await BiddingHeuristics.share_heuristic()
    assert "strategy" in strategy
    assert "skills" in strategy
    assert "min_confidence" in strategy
    assert "timestamp" in strategy
    assert "current_load" in strategy
    assert isinstance(strategy["skills"], dict)

@pytest.mark.asyncio
async def test_load_based_yield():
    """Verify that node yields to a peer when swamped."""
    task_type = "python_fix_debug_senior"
    description = "Fix a bug in the python script with senior oversight"
    
    # Local node has skills and moderate load
    # Confidence: 0.5 (base) + 0.3 (3 matches) - 0.2 (load 4 * 0.05) = 0.6
    BiddingHeuristics.get_local_skills = AsyncMock(return_value={"python_expert": 1.0, "python_debugger": 1.0, "python_senior": 1.0})
    current_load = 4
    
    # Peer is ALSO a python expert but IDLE
    # Peer confidence: (0.6 (min) + 0.1 (match)) * 1.4 (load bonus 1.0 + 0.1*4) = 0.98
    peer = MockPeer("idle-peer", {"python_expert": 1.0}, confidence=0.6, load=0)
    peers = [peer]
    
    result = await BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers, current_load=current_load)
    
    # Should yield because of load imbalance
    assert result["should_bid"] is False
    assert result["yielded_to"] == "idle-peer"
    assert "lower load" in result["sass"]

@pytest.mark.asyncio
async def test_local_evaluation_no_yield():
    """Verify local evaluation when no superior peers exist."""
    task_type = "python_fix"
    description = "Fix a bug in the python script"
    peers = []
    
    BiddingHeuristics.get_local_skills = AsyncMock(return_value={"python_expert": 1.0})
    
    # Assuming MEDUSA_SKILLS contains 'python'
    result = await BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers)
    assert result["should_bid"] is True
    assert "yielded_to" not in result

@pytest.mark.asyncio
async def test_strategic_yield():
    """Verify that node yields to a superior peer."""
    task_type = "rust_compile"
    description = "Compile the rust binary"
    
    # Local node doesn't have 'rust' skill (assumed)
    # But we mock a peer that DOES
    expert_peer = MockPeer("node-rust-expert", {"rust_expert": 1.0, "compilation": 1.0}, confidence=0.8)
    peers = [expert_peer]
    
    # Mocking BiddingHeuristics.get_local_skills to ensure we know what local has
    BiddingHeuristics.get_local_skills = AsyncMock(return_value={"python_expert": 1.0})
    
    # First, check what local would do without peer
    local_only = await BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, [])
    
    result = await BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers)
    
    # If the local node WOULD have bid, but now it yields
    if local_only["should_bid"]:
        assert result["should_bid"] is False
        assert result["yielded_to"] == "node-rust-expert"
    else:
        # If it wouldn't have bid anyway, it shouldn't yield
        assert result["should_bid"] is False
        assert "yielded_to" not in result

@pytest.mark.asyncio
async def test_no_yield_to_inferior_peer():
    """Verify node does NOT yield to a less qualified peer."""
    task_type = "python_script"
    description = "Write a python script to parse logs"
    
    # Local node IS a python expert
    BiddingHeuristics.get_local_skills = AsyncMock(return_value={"python_expert": 1.0})
    
    # Peer is a junior
    junior_peer = MockPeer("node-junior", {"bash_script": 1.0}, confidence=0.4)
    peers = [junior_peer]
    
    result = await BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers)
    assert result["should_bid"] is True
    assert "yielded_to" not in result
