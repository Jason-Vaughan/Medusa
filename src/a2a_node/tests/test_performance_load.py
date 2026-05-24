import pytest
import asyncio
from app.core.performance import PerformanceMonitor
from app.models.ledger import TaskEntry, PeerEntry, PerformanceSnapshot
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC
import uuid
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_get_local_load_fixed_v2():
    node_id = PerformanceMonitor.get_local_node_id()
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        t1 = TaskEntry(id=f"t1-{uid}", task_type="t", description="d", status="pending", assigned_to="local")
        t2 = TaskEntry(id=f"t2-{uid}", task_type="t", description="d", status="running", claimed_by=node_id)
        db.add_all([t1, t2])
        await db.commit()
        
    load = await PerformanceMonitor.get_local_load()
    assert load["pending_tasks"] >= 1
    assert load["running_tasks"] >= 1

@pytest.mark.asyncio
async def test_get_swarm_load_full():
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        t = TaskEntry(id=f"swarm-t-{uid}", task_type="t", description="d", status="pending")
        db.add(t)
        await db.commit()
        
    load = await PerformanceMonitor.get_swarm_load()
    assert load["pending_tasks"] >= 1

@pytest.mark.asyncio
async def test_record_execution_new_peer():
    # Test path where peer doesn't exist
    node_id = "new-node-" + str(uuid.uuid4())[:8]
    with patch("app.core.performance.PerformanceMonitor.get_local_node_id", return_value=node_id):
        await PerformanceMonitor.record_execution("test", True, 0.5)
        
    async with AsyncSessionLocal() as db_check:
        res = await db_check.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
        assert res.scalars().first() is not None
