import pytest
from app.core.heuristics import BiddingHeuristics
from app.models.ledger import PeerEntry
from datetime import datetime

class MockPeer:
    def __init__(self, node_id, skills, confidence=0.6):
        self.id = node_id
        self.strategies = {
            "skills": skills,
            "min_confidence": confidence
        }
        self.status = "active"

def test_strategy_sharing():
    """Verify that share_heuristic returns correct structure."""
    strategy = BiddingHeuristics.share_heuristic()
    assert "strategy" in strategy
    assert "skills" in strategy
    assert "min_confidence" in strategy
    assert "timestamp" in strategy
    assert isinstance(strategy["skills"], list)

def test_local_evaluation_no_yield():
    """Verify local evaluation when no superior peers exist."""
    task_type = "python_fix"
    description = "Fix a bug in the python script"
    peers = []
    
    # Assuming MEDUSA_SKILLS contains 'python'
    result = BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers)
    assert result["should_bid"] is True
    assert "yielded_to" not in result

def test_strategic_yield():
    """Verify that node yields to a superior peer."""
    task_type = "rust_compile"
    description = "Compile the rust binary"
    
    # Local node doesn't have 'rust' skill (assumed)
    # But we mock a peer that DOES
    expert_peer = MockPeer("node-rust-expert", ["rust_expert", "compilation"], confidence=0.8)
    peers = [expert_peer]
    
    # First, check what local would do without peer
    local_only = BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, [])
    # Even without skill, if desc is long it might bid (base 0.5 + long desc > 0.6)
    # Let's force a scenario where it would bid
    
    # Mocking BiddingHeuristics.get_local_skills to ensure we know what local has
    BiddingHeuristics.get_local_skills = lambda: ["python_expert"]
    
    result = BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers)
    
    # If the local node WOULD have bid, but now it yields
    if local_only["should_bid"]:
        assert result["should_bid"] is False
        assert result["yielded_to"] == "node-rust-expert"
        assert "qualified" in result["sass"]
    else:
        # If it wouldn't have bid anyway, it shouldn't yield
        assert result["should_bid"] is False
        assert "yielded_to" not in result

def test_no_yield_to_inferior_peer():
    """Verify node does NOT yield to a less qualified peer."""
    task_type = "python_script"
    description = "Write a python script to parse logs"
    
    # Local node IS a python expert
    BiddingHeuristics.get_local_skills = lambda: ["python_expert"]
    
    # Peer is a junior
    junior_peer = MockPeer("node-junior", ["bash_script"], confidence=0.4)
    peers = [junior_peer]
    
    result = BiddingHeuristics.evaluate_with_swarm_intelligence(task_type, description, peers)
    assert result["should_bid"] is True
    assert "yielded_to" not in result
