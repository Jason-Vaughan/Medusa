"""
Pin-tests for Chunk 34 (autonomous capacity expansion) blockers identified
in the c5fca62 code review. These tests assert the EXPECTED correct
behavior; they currently fail on the as-shipped implementation, pinning
the bugs in place until the implementation is corrected.
"""
import pytest
import asyncio
from datetime import datetime, UTC, timedelta
from unittest.mock import patch, AsyncMock, MagicMock
from sqlalchemy import delete

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.performance import PerformanceMonitor
from app.models.ledger import PeerEntry, TaskEntry
import app.core.performance as perf_mod


@pytest.mark.asyncio
async def test_sustained_load_detection_uses_swarm_wide_pending():
    """
    BLOCKER #1: check_for_expansion_need should react to swarm-wide
    pending pressure, not just per-node pending count.

    Setup: 4 active nodes; 16 pending tasks distributed 4-each by
    assigned_to. Pre-seed _load_breach_start so the 60s expansion window
    has already elapsed (avoids real-time waiting in test).

    Expected: With swarm-wide pending = 16 (>> threshold 5),
    check_for_expansion_need fires request_mesh_expansion exactly once.

    Current (buggy) code: get_current_load() filters pending by
    `assigned_to == this_node`, sees only 4 pending (< threshold 5),
    resets _load_breach_start to None, and never fires expansion.
    The 16-task swarm is silently starved of new capacity.
    """
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))

        now = datetime.now(UTC).replace(tzinfo=None)
        local_node_id = PerformanceMonitor.get_local_node_id()
        node_ids = [local_node_id, "other-node-A", "other-node-B", "other-node-C"]

        for nid in node_ids:
            db.add(PeerEntry(
                id=nid,
                address="http://localhost:0",
                status="active",
                last_seen=now,
            ))

        # 16 pending tasks, 4 per node (per-node count = 4 < 5; swarm = 16 >> 5)
        for i in range(16):
            owner = node_ids[i % 4]
            db.add(TaskEntry(
                id=f"swarm-pending-{i:02d}",
                task_type="research",
                description=f"Pending task #{i}",
                status="pending",
                assigned_to=owner,
                updated_at=now,
            ))

        await db.commit()

    # Pre-seed breach state so we don't wait 60 real seconds
    perf_mod._load_breach_start = datetime.now(UTC) - timedelta(seconds=70)

    try:
        with patch.object(
            PerformanceMonitor, "request_mesh_expansion", new_callable=AsyncMock
        ) as mock_expand:
            await PerformanceMonitor.check_for_expansion_need()

            # Expected: 16 swarm-pending >> 5 threshold, breach sustained
            # 70s >> 60s window _ expansion request fires once.
            # Fails under Blocker #1 because per-node pending = 4 < 5.
            mock_expand.assert_called_once()
    finally:
        perf_mod._load_breach_start = None

    print("__ Sustained-load detection correctly fires on swarm-wide pressure.")


@pytest.mark.asyncio
async def test_graceful_shutdown_drain_respects_per_node_load():
    """
    BLOCKER #2: drain step should exit immediately when THIS node has zero
    in-flight tasks, even when other nodes have running tasks.

    Setup: clear ledger; add 5 'running' tasks owned by OTHER nodes
    (claimed_by + assigned_to point at other nodes). This node has zero
    tasks of its own. 

    Expected: drain step's while-loop hits total_load == 0 on first
    iteration (this node has no tasks) _ success branch breaks _ asyncio.sleep
    inside drain loop is NEVER called.

    Current (buggy) code: PerformanceMonitor.get_current_load() returns
    total_load = global_running_count(5) + per_node_pending(0) = 5. Drain
    enters the sleep loop and waits 60s real time before MAX_DRAIN times
    out. Production impact: every spawned node retirement adds 60s of
    dead air to swarm scale-down.
    """
    from app.core.swarm import perform_graceful_shutdown
    import app.core.swarm as swarm_mod

    # Reset module state in case a prior test mutated it
    swarm_mod._is_shutting_down = False

    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))

        now = datetime.now(UTC).replace(tzinfo=None)

        # 5 running tasks belonging to OTHER nodes
        for i in range(5):
            other = f"other-running-node-{i}"
            db.add(PeerEntry(
                id=other, address="http://localhost:0",
                status="active", last_seen=now,
            ))
            db.add(TaskEntry(
                id=f"other-running-task-{i:02d}",
                task_type="research",
                description=f"Other node's running task #{i}",
                status="running",
                assigned_to=other,
                claimed_by=other,
                updated_at=now,
            ))

        await db.commit()

    sleep_call_count = 0

    async def tracking_sleep(delay):
        """Count sleep calls; raise after 2 to prevent runaway test if drain loops."""
        nonlocal sleep_call_count
        sleep_call_count += 1
        if sleep_call_count >= 2:
            # Hard-stop the runaway drain loop so the test doesn't hang
            raise asyncio.CancelledError("Test sentinel: drain looped")

    # Mock httpx context-manager + post for the /mesh/contract call
    mock_http_instance = MagicMock()
    mock_http_instance.__aenter__ = AsyncMock(return_value=mock_http_instance)
    mock_http_instance.__aexit__ = AsyncMock(return_value=None)
    mock_http_instance.post = AsyncMock(return_value=MagicMock(status_code=200))

    with patch("app.core.swarm.httpx.AsyncClient", return_value=mock_http_instance), \
         patch("app.core.tangleclaw.release_port") as mock_release, \
         patch("app.core.swarm.os._exit") as mock_exit, \
         patch("asyncio.sleep", side_effect=tracking_sleep):
        try:
            await asyncio.wait_for(perform_graceful_shutdown(), timeout=10.0)
        except asyncio.CancelledError:
            # Sentinel raised _ drain looped. We'll fail the assertion below.
            pass
        except asyncio.TimeoutError:
            pytest.fail("Drain loop appears to be hanging _ Blocker #2.")

        # Expected: PerformanceMonitor.get_current_load(per_node=True) hits total_load == 0
        # branch on first iteration, so asyncio.sleep is never called.
        assert sleep_call_count == 0, (
            f"Drain loop iterated {sleep_call_count} time(s) even though "
            f"this node has zero in-flight tasks. Blocker #2: "
            f"PerformanceMonitor.get_current_load() returns global "
            f"running_count, not per-node load."
        )

        # Sanity: if drain DID exit cleanly, the rest of the shutdown ran
        mock_release.assert_called_once()
        mock_exit.assert_called_once_with(0)

    print("__ Drain step correctly respects per-node load.")


@pytest.mark.asyncio
async def test_janitor_skips_rep_penalty_for_terminated_node():
    """
    TEST #9a _ Reputation carve-out (positive case).

    A node with status='terminated' (set by /mesh/contract when a spawned
    node self-terminates cleanly via the kind='self_terminate_idle' path)
    should NOT be penalized by the Janitor when its claimed task stalls.

    The carve-out prevents a clean shutdown from looking like a stall and
    wrongly tanking the node's reputation score.
    """
    from app.core.swarm import run_task_janitor
    import app.core.swarm as swarm_mod
    swarm_mod._is_shutting_down = False

    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))

        now = datetime.now(UTC).replace(tzinfo=None)
        stall_offset = settings.STALL_TIMEOUT + 60

        db.add(PeerEntry(
            id="terminated-node",
            address="http://localhost:0",
            status="terminated",
            last_seen=now,
        ))
        db.add(TaskEntry(
            id="stalled-by-terminated",
            task_type="research",
            description="stalled task owned by terminated node",
            status="running",
            assigned_to="terminated-node",
            claimed_by="terminated-node",
            updated_at=now - timedelta(seconds=stall_offset),
        ))
        await db.commit()

    async def escape_after_one(*args, **kwargs):
        raise asyncio.CancelledError("Test: escape Janitor loop after one iter")

    with patch("app.core.reputation.ReputationEngine.update_reputation",
               new_callable=AsyncMock) as mock_rep, \
         patch("app.core.swarm.asyncio.sleep", side_effect=escape_after_one):
        try:
            await run_task_janitor()
        except asyncio.CancelledError:
            pass

        terminated_calls = [
            c for c in mock_rep.call_args_list
            if c.args and c.args[0] == "terminated-node"
        ]
        assert len(terminated_calls) == 0, (
            f"ReputationEngine.update_reputation was wrongly called for "
            f"terminated node: {terminated_calls}. Carve-out broken."
        )

    print("__ Janitor correctly skips reputation penalty for terminated nodes.")


@pytest.mark.asyncio
async def test_janitor_penalizes_active_node_with_stalled_task():
    """
    TEST #9b _ Reputation carve-out negative control.

    A node with status='active' that has a stalled task SHOULD be
    penalized as 'stalled'. This ensures the carve-out from #9a isn't
    accidentally swallowing legitimate reputation penalties (i.e., the
    `if owner.status == "terminated"` branch isn't always taken).
    """
    from app.core.swarm import run_task_janitor

    async with AsyncSessionLocal() as db:
        await db.execute(delete(TaskEntry))
        await db.execute(delete(PeerEntry))

        now = datetime.now(UTC).replace(tzinfo=None)
        stall_offset = settings.STALL_TIMEOUT + 60

        db.add(PeerEntry(
            id="active-but-stalled",
            address="http://localhost:0",
            status="active",
            last_seen=now,
        ))
        db.add(TaskEntry(
            id="stalled-by-active",
            task_type="research",
            description="stalled task owned by still-active (likely hung) node",
            status="running",
            assigned_to="active-but-stalled",
            claimed_by="active-but-stalled",
            updated_at=now - timedelta(seconds=stall_offset),
        ))
        await db.commit()

    async def escape_after_one(*args, **kwargs):
        raise asyncio.CancelledError("Test: escape Janitor loop after one iter")

    with patch("app.core.reputation.ReputationEngine.update_reputation",
               new_callable=AsyncMock) as mock_rep, \
         patch("app.core.swarm.asyncio.sleep", side_effect=escape_after_one):
        try:
            await run_task_janitor()
        except asyncio.CancelledError:
            pass

        penalty_calls = [
            c for c in mock_rep.call_args_list
            if c.args and c.args[0] == "active-but-stalled"
        ]
        assert len(penalty_calls) >= 1, (
            "Janitor did NOT penalize an active node with a stalled task. "
            "Reputation system is leaking _ penalties aren't firing."
        )
        # Verify the reason was 'stalled'
        last_call = penalty_calls[-1]
        assert last_call.args[1] == "stalled", (
            f"Expected penalty reason 'stalled', got {last_call.args[1]}"
        )

    print("__ Janitor correctly penalizes active nodes with stalled tasks.")
