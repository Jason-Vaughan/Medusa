import pytest
import asyncio
from app.core.performance import PerformanceMonitor, run_performance_monitor
from app.models.ledger import PerformanceSnapshot, TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC, timedelta
import uuid
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_record_snapshot_full():
    async with AsyncSessionLocal() as db:
        uid = str(uuid.uuid4())[:8]
        # Create some data to measure
        t = TaskEntry(id=f"perf-t-{uid}", task_type="t", description="d", status="completed")
        p = PeerEntry(id=f"perf-p-{uid}", address="h", status="active", last_seen=datetime.now(UTC).replace(tzinfo=None))
        db.add_all([t, p])
        await db.commit()
        
    await PerformanceMonitor.record_snapshot()
    
    async with AsyncSessionLocal() as db_check:
        res = await db_check.execute(select(PerformanceSnapshot))
        snap = res.scalars().first()
        assert snap is not None
        assert snap.metrics["active_nodes"] >= 1

@pytest.mark.asyncio
async def test_check_for_expansion_need_breach_v2():
    # 1. First check - starts window
    # PerformanceMonitor uses datetime.now(UTC) which is offset-aware
    # We must ensure _load_breach_start is also offset-aware if set manually
    
    with patch("app.core.performance.PerformanceMonitor.get_swarm_load", new_callable=AsyncMock) as mock_load:
        mock_load.return_value = {"pending_tasks": 10}
        with patch("app.core.performance.settings") as mock_settings:
            mock_settings.LOAD_THRESHOLD = 5
            mock_settings.EXPANSION_WINDOW = 60
            mock_settings.A2A_NODE_TYPE = "seed"
            
            # Reset global state for test
            with patch("app.core.performance._load_breach_start", None):
                await PerformanceMonitor.check_for_expansion_need()
                # _load_breach_start should now be set (not easily verifiable since it's global)
            
    # 2. Second check - triggers expansion
    with patch("app.core.performance.PerformanceMonitor.get_swarm_load", new_callable=AsyncMock) as mock_load:
        mock_load.return_value = {"pending_tasks": 10}
        # Use offset-aware datetime to match datetime.now(UTC)
        old_breach = datetime.now(UTC) - timedelta(seconds=70)
        with patch("app.core.performance._load_breach_start", old_breach):
            with patch("app.core.performance.settings") as mock_settings:
                mock_settings.LOAD_THRESHOLD = 5
                mock_settings.EXPANSION_WINDOW = 60
                mock_settings.A2A_NODE_TYPE = "seed"
                
                with patch("app.core.performance.PerformanceMonitor.request_mesh_expansion", new_callable=AsyncMock) as mock_exp:
                    await PerformanceMonitor.check_for_expansion_need()
                    mock_exp.assert_called_once()
