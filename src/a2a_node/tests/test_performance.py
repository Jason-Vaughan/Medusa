import pytest
import asyncio
from app.core.performance import PerformanceMonitor
from app.core.config import settings
from app.models.ledger import PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select

@pytest.mark.asyncio
async def test_performance_recording():
    # Setup - Clean up existing local node entry if any
    node_id = PerformanceMonitor.get_local_node_id()
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
        peer = result.scalars().first()
        if peer:
            peer.performance = None
            await db.commit()

    # 1. Record a successful execution
    await PerformanceMonitor.record_execution("test_task", True, 1.5)
    
    # 2. Verify metrics
    perf = await PerformanceMonitor.get_local_performance()
    assert perf["total_tasks"] == 1
    assert perf["success_count"] == 1
    assert perf["failure_count"] == 0
    assert perf["total_latency"] == 1.5
    assert "test_task" in perf["task_types"]
    assert perf["task_types"]["test_task"]["count"] == 1
    
    # 3. Record a failed execution
    await PerformanceMonitor.record_execution("test_task", False, 0.5)
    
    # 4. Verify updated metrics
    perf = await PerformanceMonitor.get_local_performance()
    assert perf["total_tasks"] == 2
    assert perf["success_count"] == 1
    assert perf["failure_count"] == 1
    assert perf["total_latency"] == 2.0
    assert perf["task_types"]["test_task"]["count"] == 2
    assert perf["task_types"]["test_task"]["success"] == 1
    assert perf["task_types"]["test_task"]["latency"] == 2.0
