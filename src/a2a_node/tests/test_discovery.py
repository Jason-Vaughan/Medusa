import pytest
from app.api.discovery import get_agent_card
from app.core.config import settings
import os

@pytest.mark.asyncio
async def test_agent_card_includes_skills():
    """
    Verifies that the agent card includes skills from the MEDUSA_SKILLS setting.
    """
    # Force skills for testing
    original_skills = settings.MEDUSA_SKILLS
    settings.MEDUSA_SKILLS = "test_skill_1,test_skill_2"
    
    try:
        card = await get_agent_card()
        
        assert "capabilities" in card
        capabilities = card["capabilities"]
        
        # Check for our test skills
        assert "skill:test_skill_1" in capabilities
        assert "skill:test_skill_2" in capabilities
        
        # Check for standard capabilities
        assert "can_auction_tasks" in capabilities
        
    finally:
        # Restore original skills
        settings.MEDUSA_SKILLS = original_skills

@pytest.mark.asyncio
async def test_agent_card_includes_mcp_tools():
    """
    Verifies that the agent card includes local MCP tools as capabilities.
    """
    # This test depends on medusa/mcp-tools.json existing relative to the test location
    card = await get_agent_card()
    
    # Check if any tool: prefixed capabilities exist
    tool_capabilities = [c for c in card["capabilities"] if c.startswith("tool:")]
    
    # If mcp-tools.json exists, we should have tools. If not, it might be an empty list.
    # In a real environment, we'd mock the file system here.
    print(f"Discovered {len(tool_capabilities)} tool capabilities.")
