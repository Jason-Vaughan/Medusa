import pytest
from app.api.a2a import issue_grant, list_grants, revoke_grant, create_profile
from app.models.ledger import WorkspaceGrant, CapabilityProfile
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid
from datetime import datetime, UTC, timedelta
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class GrantCreate(BaseModel):
    profile_id: str
    granted_by: str
    expires_at: datetime
    scope: Optional[str] = None

class ProfileCreate(BaseModel):
    id: str
    description: Optional[str] = None
    allowed_patterns: Optional[List[Dict[str, Any]]] = None
    denied_patterns: Optional[List[Dict[str, Any]]] = None
    path_scope: Optional[Dict[str, Any]] = None
    approval_routing: Optional[Dict[str, Any]] = None

@pytest.mark.asyncio
async def test_a2a_grant_management_fixed():
    async with AsyncSessionLocal() as db:
        profile_id = "prof-" + str(uuid.uuid4())[:8]
        workspace_id = "work-" + str(uuid.uuid4())[:8]
        
        # 1. Create profile first
        await create_profile(profile=ProfileCreate(id=profile_id), db=db)
        
        # 2. Issue grant
        grant_data = GrantCreate(
            profile_id=profile_id,
            granted_by="admin",
            expires_at=datetime.now(UTC) + timedelta(days=1)
        )
        grant = await issue_grant(workspace_id=workspace_id, grant=grant_data, db=db)
        assert grant.workspace_id == workspace_id
        
        # 3. List grants
        grants = await list_grants(workspace_id=workspace_id, db=db)
        assert any(g.id == grant.id for g in grants)
        
        # 4. Revoke grant
        await revoke_grant(grant_id=grant.id, db=db)
        res = await db.execute(select(WorkspaceGrant).filter(WorkspaceGrant.id == grant.id))
        assert res.scalars().first().revoked == 1
