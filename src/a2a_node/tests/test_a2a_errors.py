import pytest
from app.api.a2a import get_task
from app.api.gossip import claim_task
from fastapi import HTTPException
from app.core.database import AsyncSessionLocal
import uuid

@pytest.mark.asyncio
async def test_a2a_errors_v2():
    async with AsyncSessionLocal() as db:
        # get non-existent
        with pytest.raises(HTTPException) as exc:
            await get_task(task_id="none", db=db)
        assert exc.value.status_code == 404
        
        # claim non-existent
        with pytest.raises(HTTPException) as exc:
            await claim_task(task_id="none", node_id="node", db=db)
        assert exc.value.status_code == 404
