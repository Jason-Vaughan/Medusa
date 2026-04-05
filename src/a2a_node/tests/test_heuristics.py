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

def test_heuristics_sharing():
    """
    Verifies that the share_heuristic function returns the correct structure.
    """
    result = BiddingHeuristics.share_heuristic()
    assert "strategy" in result
    assert "skills" in result
    assert isinstance(result["skills"], list)
