import pytest
from app.api.a2a import create_profile, list_profiles, get_profile
from app.models.ledger import CapabilityProfile
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class ProfileCreate(BaseModel):
    id: str
    description: Optional[str] = None
    allowed_patterns: Optional[List[Dict[str, Any]]] = None
    denied_patterns: Optional[List[Dict[str, Any]]] = None
    path_scope: Optional[Dict[str, Any]] = None
    approval_routing: Optional[Dict[str, Any]] = None

@pytest.mark.asyncio
async def test_a2a_profile_management():
    async with AsyncSessionLocal() as db:
        profile_id = "prof-" + str(uuid.uuid4())[:8]
        
        # Create
        prof_data = ProfileCreate(id=profile_id, description="test prof")
        await create_profile(profile=prof_data, db=db)
        
        # List
        profs = await list_profiles(db=db)
        assert any(p.id == profile_id for p in profs)
        
        # Get
        p_list = await get_profile(profile_id=profile_id, db=db)
        assert len(p_list) >= 1
        assert p_list[0].id == profile_id
        
        # Create version 2
        await create_profile(profile=prof_data, db=db)
        p_list_v2 = await get_profile(profile_id=profile_id, db=db)
        assert len(p_list_v2) == 2
        assert p_list_v2[0].version == 2 # Order by desc
