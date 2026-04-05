from fastapi import APIRouter
import os
import json
from app.core.config import settings

router = APIRouter()

@router.get("/agent-card.json")
async def get_agent_card():
    """
    Dynamically generates the agent card based on current capabilities and MCP tools.
    """
    base_card = {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "description": "Autonomous Agent-to-Agent Coordination Node",
        "endpoints": {
            "discovery": "/.well-known/agent-card.json",
            "tasks": "/a2a/tasks",
            "messages": "/a2a/messages",
            "gossip": "/a2a/gossip/ping"
        },
        "sass_level": "savage"
    }

    capabilities = [
        "can_review_code",
        "can_talk_shit",
        "can_delegate_tasks",
        "can_gossip",
        "can_auction_tasks"
    ]

    # Add dynamic skills from configuration
    for skill in settings.MEDUSA_SKILLS.split(','):
        if skill.strip():
            capabilities.append(f"skill:{skill.strip()}")

    # Try to load MCP tools and add them as capabilities
    try:
        # Path relative to src/a2a_node/main.py is ../medusa/mcp-tools.json
        mcp_tools_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../medusa/mcp-tools.json"))
        if os.path.exists(mcp_tools_path):
            with open(mcp_tools_path, 'r') as f:
                mcp_data = json.load(f)
                for tool in mcp_data.get("tools", []):
                    capabilities.append(f"tool:{tool['name']}")
    except Exception as e:
        # Fallback if file not found or unreadable
        capabilities.append(f"error:could_not_load_mcp_tools:{str(e)}")

    base_card["capabilities"] = capabilities
    return base_card
