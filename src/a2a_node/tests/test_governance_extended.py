import pytest
from app.core.governance import GovernanceEngine
from app.models.ledger import CapabilityProfile, WorkspaceGrant
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, delete
from datetime import datetime, UTC, timedelta
import uuid
from unittest.mock import MagicMock

@pytest.mark.asyncio
async def test_governance_evaluate_task_no_grant():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(WorkspaceGrant))
        await db.execute(delete(CapabilityProfile))
        await db.commit()
        
    result = await GovernanceEngine.evaluate_task("shell", "rm -rf /", workspace_id="unknown")
    assert result["requires_approval"] is True
    assert "Destructive" in result["reason"]

@pytest.mark.asyncio
async def test_governance_evaluate_task_with_grant_allowed():
    profile_id = "p-" + str(uuid.uuid4())[:8]
    workspace_id = "w-" + str(uuid.uuid4())[:8]
    
    async with AsyncSessionLocal() as db:
        profile = CapabilityProfile(
            id=profile_id,
            version=1,
            allowed_patterns=[{"tool": "shell", "commandPattern": "echo .*"}]
        )
        grant = WorkspaceGrant(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            profile_id=profile_id,
            profile_version=1,
            granted_by="op",
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
        )
        db.add_all([profile, grant])
        await db.commit()
        
        result = await GovernanceEngine.evaluate_task("shell", "echo hello", workspace_id=workspace_id, db=db)
        assert result["requires_approval"] is False
        assert "pre-approved" in result["reason"]

@pytest.mark.asyncio
async def test_governance_evaluate_task_with_grant_denied():
    profile_id = "p-" + str(uuid.uuid4())[:8]
    workspace_id = "w-" + str(uuid.uuid4())[:8]
    
    async with AsyncSessionLocal() as db:
        profile = CapabilityProfile(
            id=profile_id,
            version=1,
            denied_patterns=[{"tool": "shell", "commandPattern": "rm .*"}]
        )
        grant = WorkspaceGrant(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            profile_id=profile_id,
            profile_version=1,
            granted_by="op",
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
        )
        db.add_all([profile, grant])
        await db.commit()
        
        result = await GovernanceEngine.evaluate_task("shell", "rm -rf /", workspace_id=workspace_id, db=db)
        assert result["requires_approval"] is True
        assert "explicitly denied" in result["reason"]

@pytest.mark.asyncio
async def test_governance_evaluate_task_expired_grant():
    profile_id = "p-" + str(uuid.uuid4())[:8]
    workspace_id = "w-" + str(uuid.uuid4())[:8]
    
    async with AsyncSessionLocal() as db:
        profile = CapabilityProfile(
            id=profile_id,
            version=1,
            allowed_patterns=[{"tool": "shell", "commandPattern": ".*"}]
        )
        grant = WorkspaceGrant(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            profile_id=profile_id,
            profile_version=1,
            granted_by="op",
            expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1) # Expired
        )
        db.add_all([profile, grant])
        await db.commit()
        
        result = await GovernanceEngine.evaluate_task("shell", "ls", workspace_id=workspace_id, db=db)
        assert result["requires_approval"] is True # Falls back to True because shell is inherently risky
