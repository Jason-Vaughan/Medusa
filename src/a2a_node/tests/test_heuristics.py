import pytest
from app.core.heuristics import BiddingHeuristics
from app.core.config import settings
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_heuristics_skill_matching():
    """
    Verifies that the heuristics module correctly matches skills to task keywords.
    """
    # Mock get_local_skills to return a predictable matrix
    with patch("app.core.heuristics.BiddingHeuristics.get_local_skills", new_callable=AsyncMock) as mock_skills, \
         patch("app.core.performance.PerformanceMonitor.get_swarm_health", new_callable=AsyncMock) as mock_health:
        mock_skills.return_value = {"python_expert": 1.0, "security_auditor": 1.0}
        mock_health.return_value = 1.0 # High health = low threshold (0.6)
        
        # Match python skill
        result = await BiddingHeuristics.evaluate_task("coding", "Implement a new python script.")
        # Base 0.5 + 0.1 = 0.6. Default min_confidence 0.6. Should be True.
        assert result["should_bid"] is True
        assert "python_expert" in result["matched_skills"]
        assert result["confidence"] >= 0.6
        assert result["bid_value"] <= 1.0
        
        # Match security skill
        result = await BiddingHeuristics.evaluate_task("audit", "Perform a security audit on the login flow.")
        assert result["should_bid"] is True
        assert "security_auditor" in result["matched_skills"]
        
        # No match (generic task should still bid if long enough)
        result = await BiddingHeuristics.evaluate_task("generic", "Do something unimportant but make sure you describe it with at least ten words so the heuristic picks it up.")
        assert result["should_bid"] is True # Because length > 10 in evaluate_task logic
        assert not result["matched_skills"]
        assert result["confidence"] == 0.5
        
        # Short task with no skills should NOT bid
        result = await BiddingHeuristics.evaluate_task("none", "short.")
        assert result["should_bid"] is False

@pytest.mark.asyncio
async def test_heuristics_sharing():
    """
    Verifies that the share_heuristic function returns the correct structure.
    """
    result = await BiddingHeuristics.share_heuristic()
    assert "strategy" in result
    assert "skills" in result
    assert "current_load" in result
    assert isinstance(result["skills"], dict)

@pytest.mark.asyncio
async def test_load_balancing_heuristics():
    """
    Verifies that load affects bidding decisions.
    """
    # Mock get_local_skills and health
    with patch("app.core.heuristics.BiddingHeuristics.get_local_skills", new_callable=AsyncMock) as mock_skills, \
         patch("app.core.performance.PerformanceMonitor.get_swarm_health", new_callable=AsyncMock) as mock_swarm_health, \
         patch("app.core.performance.PerformanceMonitor.get_resource_health", new_callable=AsyncMock) as mock_health:
        mock_skills.return_value = {"python_expert": 1.0}
        mock_swarm_health.return_value = 1.0
        mock_health.return_value = {"cpu_percent": 10, "memory_percent": 10}
        
        # Low load
        low_load_result = await BiddingHeuristics.evaluate_task("generic", "This is a long enough description to bid on, it has more than ten words now.", current_load=0)
        assert low_load_result["should_bid"] is True
        
        # High load
        high_load_result = await BiddingHeuristics.evaluate_task("generic", "This is a long enough description to bid on, it has more than ten words now.", current_load=6)
        assert high_load_result["should_bid"] is False
        assert high_load_result["confidence"] < low_load_result["confidence"]
        assert high_load_result["bid_value"] > low_load_result["bid_value"]

@pytest.mark.asyncio
async def test_health_based_bidding():
    """
    Verifies that resource health affects bidding decisions (Chunk 24).
    """
    task_type = "coding"
    description = "Implement a new python script." # Has python match
    
    with patch("app.core.heuristics.BiddingHeuristics.get_local_skills", new_callable=AsyncMock) as mock_skills, \
         patch("app.core.performance.PerformanceMonitor.get_swarm_health", new_callable=AsyncMock) as mock_swarm_health:
        mock_skills.return_value = {"python_expert": 1.0}
        mock_swarm_health.return_value = 1.0
        
        # 1. Healthy Node
        with patch("app.core.performance.PerformanceMonitor.get_resource_health", new_callable=AsyncMock) as mock_health:
            mock_health.return_value = {"cpu_percent": 10, "memory_percent": 10}
            healthy_result = await BiddingHeuristics.evaluate_task(task_type, description)
            assert healthy_result["should_bid"] is True
            assert healthy_result["confidence"] >= 0.6
            
        # 2. Unhealthy Node (High CPU)
        with patch("app.core.performance.PerformanceMonitor.get_resource_health", new_callable=AsyncMock) as mock_health:
            mock_health.return_value = {"cpu_percent": 85, "memory_percent": 10}
            unhealthy_result = await BiddingHeuristics.evaluate_task(task_type, description)
            # 0.5 (base) + 0.1 (match) - 0.3 (cpu penalty) = 0.3
            assert unhealthy_result["should_bid"] is False
            assert unhealthy_result["confidence"] < 0.6
            
        # 3. Critical Node (Melting)
        with patch("app.core.performance.PerformanceMonitor.get_resource_health", new_callable=AsyncMock) as mock_health:
            mock_health.return_value = {"cpu_percent": 98, "memory_percent": 10}
            critical_result = await BiddingHeuristics.evaluate_task(task_type, description)
            assert critical_result["should_bid"] is False
            assert "melting" in critical_result["sass"]
