import pytest
from app.core.heuristics import BiddingHeuristics
from app.models.ledger import PeerEntry
from unittest.mock import patch, AsyncMock

class MockPeer:
    def __init__(self, id, skills, performance=None, load=0, health=None):
        self.id = id
        self.strategies = {"skills": skills, "min_confidence": 0.6, "current_load": load}
        self.performance = performance
        self.health_metadata = health or {"cpu_percent": 10, "memory_percent": 10}

@pytest.mark.asyncio
async def test_yield_to_better_performance():
    # Local node has 'python' skill.
    # Peer also has 'python' skill but has SUPERIOR performance.
    
    # Mock peer with 100% success rate and low latency
    peer = MockPeer(
        id="top-node", 
        skills={"python": 1.0}, 
        performance={
            "total_tasks": 10,
            "success_count": 10,
            "failure_count": 0,
            "total_latency": 5.0, # 0.5s average
            "task_types": {
                "python_task": {"count": 10, "success": 10, "latency": 5.0}
            }
        }
    )
    
    # local_eval for "python_task" will have confidence ~0.7 (0.6 base + 0.1 match)
    # peer_confidence will be (0.6 + 0.1) * 1.2 (success bonus) * 1.1 (latency bonus) = 0.924
    
    with patch("app.core.heuristics.BiddingHeuristics.get_local_skills", new_callable=AsyncMock) as mock_skills, \
         patch("app.core.performance.PerformanceMonitor.get_swarm_health", new_callable=AsyncMock) as mock_swarm_health, \
         patch("app.core.performance.PerformanceMonitor.get_resource_health", new_callable=AsyncMock) as mock_resource_health:
        
        mock_skills.return_value = {"python": 1.0}
        mock_swarm_health.return_value = 1.0
        mock_resource_health.return_value = {"cpu_percent": 10, "memory_percent": 10}

        result = await BiddingHeuristics.evaluate_with_swarm_intelligence(
            "python_task", 
            "Execute a complex python script", 
            [peer]
        )
    
    assert result["should_bid"] is False
    assert result["yielded_to"] == "top-node"
    assert "superior performance" in result["sass"]

@pytest.mark.asyncio
async def test_no_yield_to_poor_performance():
    # Peer has the skill but POOR performance
    peer = MockPeer(
        id="failing-node", 
        skills={"python": 1.0}, 
        performance={
            "total_tasks": 10,
            "success_count": 5,
            "failure_count": 5,
            "total_latency": 100.0,
            "task_types": {
                "python_task": {"count": 10, "success": 5, "latency": 100.0}
            }
        }
    )
    
    # peer_confidence will be (0.6 + 0.1) * 0.7 (failure penalty) * 0.9 (latency penalty) = 0.441
    # local confidence is ~0.7
    
    with patch("app.core.heuristics.BiddingHeuristics.get_local_skills", new_callable=AsyncMock) as mock_skills, \
         patch("app.core.performance.PerformanceMonitor.get_swarm_health", new_callable=AsyncMock) as mock_swarm_health, \
         patch("app.core.performance.PerformanceMonitor.get_resource_health", new_callable=AsyncMock) as mock_resource_health:
        
        mock_skills.return_value = {"python": 1.0}
        mock_swarm_health.return_value = 1.0
        mock_resource_health.return_value = {"cpu_percent": 10, "memory_percent": 10}

        result = await BiddingHeuristics.evaluate_with_swarm_intelligence(
            "python_task", 
            "Execute a complex python script", 
            [peer]
        )
    
    # We should NOT yield because the peer is unreliable
    assert result["should_bid"] is True
    assert "yielded_to" not in result
