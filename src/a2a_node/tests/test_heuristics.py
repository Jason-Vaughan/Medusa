import pytest
from app.core.heuristics import BiddingHeuristics
from app.core.config import settings

def test_heuristics_skill_matching():
    """
    Verifies that the heuristics module correctly matches skills to task keywords.
    """
    original_skills = settings.MEDUSA_SKILLS
    settings.MEDUSA_SKILLS = "python_expert,security_auditor"
    
    try:
        # Match python skill
        result = BiddingHeuristics.evaluate_task("coding", "Implement a new python script.")
        assert result["should_bid"] is True
        assert "python_expert" in result["matched_skills"]
        assert result["confidence"] > 0.5
        assert result["bid_value"] < 1.0
        
        # Match security skill
        result = BiddingHeuristics.evaluate_task("audit", "Perform a security audit on the login flow.")
        assert result["should_bid"] is True
        assert "security_auditor" in result["matched_skills"]
        
        # No match (generic task should still bid if long enough)
        result = BiddingHeuristics.evaluate_task("generic", "Do something unimportant but make sure you describe it with at least ten words so the heuristic picks it up.")
        assert result["should_bid"] is True # Because length > 10 in evaluate_task logic
        assert not result["matched_skills"]
        assert result["confidence"] == 0.5
        
        # Short task with no skills should NOT bid
        result = BiddingHeuristics.evaluate_task("none", "short.")
        assert result["should_bid"] is False
        
    finally:
        settings.MEDUSA_SKILLS = original_skills

@pytest.mark.asyncio
async def test_heuristics_sharing():
    """
    Verifies that the share_heuristic function returns the correct structure.
    """
    result = await BiddingHeuristics.share_heuristic()
    assert "strategy" in result
    assert "skills" in result
    assert "current_load" in result
    assert isinstance(result["skills"], list)

def test_load_balancing_heuristics():
    """
    Verifies that load affects bidding decisions.
    """
    # Low load
    low_load_result = BiddingHeuristics.evaluate_task("generic", "This is a long enough description to bid on, it has more than ten words now.", current_load=0)
    assert low_load_result["should_bid"] is True
    
    # High load
    high_load_result = BiddingHeuristics.evaluate_task("generic", "This is a long enough description to bid on, it has more than ten words now.", current_load=6)
    assert high_load_result["should_bid"] is False
    assert high_load_result["confidence"] < low_load_result["confidence"]
    assert high_load_result["bid_value"] > low_load_result["bid_value"]
