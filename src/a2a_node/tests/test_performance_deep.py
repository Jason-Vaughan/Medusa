import pytest
import asyncio
from app.core.performance import run_performance_monitor, PerformanceMonitor
from app.models.ledger import PerformanceSnapshot, TaskEntry, PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select, delete
from datetime import datetime, UTC, timedelta
import uuid
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_performance_monitor_loop():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(PerformanceSnapshot))
        await db.commit()
        
    with patch("app.core.performance.settings") as mock_settings:
        mock_settings.PERFORMANCE_MONITOR_INTERVAL = 0.1
        
        # Run loop
        perf_task = asyncio.create_task(run_performance_monitor())
        await asyncio.sleep(0.5)
        perf_task.cancel()
        try: await perf_task
        except asyncio.CancelledError: pass
        
    async with AsyncSessionLocal() as db_check:
        res = await db_check.execute(select(PerformanceSnapshot))
        snaps = res.scalars().all()
        assert len(snaps) >= 1

@pytest.mark.asyncio
async def test_performance_pruning_v3():
    async with AsyncSessionLocal() as db:
        old_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
        # ID IS INTEGER (AUTO-INCREMENT)
        snap = PerformanceSnapshot(
            timestamp=old_time,
            node_id="test-node",
            metrics={"test": 1}
        )
        db.add(snap)
        await db.commit()
        
    # Prune snapshots older than 1 day
    with patch("app.core.performance.settings") as mock_settings:
        mock_settings.RETENTION_DAYS_PERF = 1 # Use actual INT
        await PerformanceMonitor.prune_snapshots()
        
    async with AsyncSessionLocal() as db_check:
        res = await db_check.execute(select(PerformanceSnapshot).filter(PerformanceSnapshot.timestamp == old_time))
        assert res.scalars().first() is None
