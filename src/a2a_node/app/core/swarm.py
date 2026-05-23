import asyncio
import logging
import httpx
import sys
import os
from datetime import datetime, UTC, timedelta
from sqlalchemy import select, or_, and_
from app.core.database import AsyncSessionLocal
from app.models.ledger import TaskEntry, PeerEntry
from app.core.config import settings
from app.core.heuristics import BiddingHeuristics

logger = logging.getLogger("a2a_swarm")

_start_time = datetime.now(UTC)
_last_active_time = datetime.now(UTC)
_is_shutting_down = False

def mark_active():
    """
    Bumps _last_active_time to now. Called from any code path that
    represents the node doing productive work (task claim AND task
    completion). Major #1 fix.
    """
    global _last_active_time
    _last_active_time = datetime.now(UTC)

async def run_swarm_intelligence():
    """
    Background task that scans for tasks to claim based on skills and swarm logic.
    """
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    print(f"🐝 Swarm Intelligence started for node {node_id}", flush=True)

    while True:
        if _is_shutting_down:
            await asyncio.sleep(5)
            continue

        try:
            async with AsyncSessionLocal() as db:
                # 0. Fetch active peers and their strategies
                peer_result = await db.execute(select(PeerEntry).filter(PeerEntry.status == "active"))
                peers = peer_result.scalars().all()

                # 1. Fetch current load (Chunk 20)
                from app.core.performance import PerformanceMonitor
                load_info = await PerformanceMonitor.get_current_load()
                current_load = load_info.get("total_load", 0)

                # 2. Fetch 'pending' tasks that haven't been claimed yet
                now = datetime.now(UTC).replace(tzinfo=None)
                result = await db.execute(
                    select(TaskEntry).filter(
                        and_(
                            or_(
                                and_(TaskEntry.status == "pending", TaskEntry.claimed_by == None),
                                and_(TaskEntry.requires_consensus == 1, TaskEntry.consensus_status != "achieved")
                            ),
                            or_(
                                TaskEntry.next_retry_at == None,
                                TaskEntry.next_retry_at <= now
                            )
                        )
                    )
                )
                tasks = result.scalars().all()

                for task in tasks:
                    if task.requires_consensus:
                        votes = task.results_votes or {}
                        if node_id in votes:
                            continue

                    eval_result = await BiddingHeuristics.evaluate_with_swarm_intelligence(
                        task.task_type, 
                        task.description,
                        peers,
                        current_load=current_load
                    )
                    
                    if eval_result["should_bid"]:
                        print(f"🐝 Node {node_id} wants to claim task {task.id[:8]} ({task.task_type}) - Confidence: {eval_result['confidence']:.2f}", flush=True)
                        
                        async with httpx.AsyncClient() as client:
                            claim_path = f"/a2a/gossip/claim/{task.id}"
                            claim_url = f"http://localhost:{settings.PORT}{claim_path}"
                            from app.core.auth_utils import get_auth_headers
                            headers = get_auth_headers(claim_path)
                            headers["node-id"] = node_id
                            try:
                                r = await client.post(claim_url, headers=headers)
                                if r.status_code == 200:
                                    res = r.json()
                                    if res.get("status") == "claimed":
                                        print(f"✅ Node {node_id} successfully claimed task {task.id[:8]}", flush=True)
                                        mark_active()
                                    else:
                                        print(f"⚠️ Node {node_id} failed to claim task {task.id[:8]}: {res.get('status')}", flush=True)
                            except Exception as e:
                                logger.error(f"❌ Swarm claim request failed: {e}")

        except Exception as e:
            logger.error(f"⚠️ Swarm intelligence error: {str(e)}")
            
        await asyncio.sleep(10)

async def perform_graceful_shutdown():
    """
    Executes the 5-step graceful shutdown protocol for spawned nodes.
    """
    global _is_shutting_down
    _is_shutting_down = True
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    
    print(f"🛑 Initiating graceful shutdown for spawned node {node_id}...", flush=True)
    
    # 1. Flip bidding flag off (Already handled by _is_shutting_down check in run_swarm_intelligence)
    
    # 2. Drain currently-claimed tasks
    MAX_DRAIN = 60 # seconds
    drain_start = datetime.now(UTC)
    while True:
        from app.core.performance import PerformanceMonitor
        load = await PerformanceMonitor.get_local_load()
        if load.get("total_load", 0) == 0:
            print("🚿 All tasks drained successfully.", flush=True)
            break
        
        if (datetime.now(UTC) - drain_start).total_seconds() > MAX_DRAIN:
            print(f"⚠️ Drain timeout hit ({MAX_DRAIN}s). Abandoning remaining tasks.", flush=True)
            break
        
        await asyncio.sleep(5)

    # 2.5. Re-queue any tasks still claimed by this node (defensive _ covers
    # the drain-timeout case where in-flight tasks didn't complete in time).
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(TaskEntry).filter(
                and_(
                    TaskEntry.status.in_(["claimed", "processing", "running"]),
                    or_(TaskEntry.claimed_by == node_id, TaskEntry.assigned_to == node_id)
                )
            )
        )
        orphans = result.scalars().all()
        for task in orphans:
            task.status = "pending"
            task.claimed_by = None
            task.updated_at = datetime.now(UTC).replace(tzinfo=None)
            print(f"🔄 Re-queueing orphan task {task.id[:8]} on shutdown", flush=True)
        if orphans:
            await db.commit()

    # 3. Fire POST /mesh/contract to Medusa Server
    endpoint = "/mesh/contract"
    url = f"{settings.MEDUSA_SERVER_URL}{endpoint}"
    from app.core.auth_utils import get_auth_headers
    headers = get_auth_headers(endpoint)
    payload = {"node_id": node_id, "kind": "self_terminate_idle"}
    
    try:
        async with httpx.AsyncClient() as client:
            await client.post(url, headers=headers, json=payload, timeout=5.0)
            print("📉 Medusa Server notified of contraction.", flush=True)
    except Exception as e:
        print(f"⚠️ Failed to notify Medusa Server of contraction: {e}", flush=True)

    # 4. Release TangleClaw port
    from app.core.tangleclaw import release_port
    release_port()
    
    # 5. Exit process
    print("👋 Shutdown complete. Goodbye, world.", flush=True)
    os._exit(0) # Use os._exit to force exit from thread/task

async def check_auto_termination():
    """
    Checks if the node should autonomously scale down.
    """
    if settings.A2A_NODE_TYPE != "seed" and not _is_shutting_down:
        now = datetime.now(UTC)
        uptime = (now - _start_time).total_seconds()
        idle_time = (now - _last_active_time).total_seconds()
        
        # Min 15m uptime + 10m idle
        if uptime > 900 and idle_time > 600:
            print(f"❄️ Node idle for {idle_time/60:.1f}m. Triggering auto-termination.", flush=True)
            asyncio.create_task(perform_graceful_shutdown())

async def run_task_janitor():
    """
    Background task that monitors for stalled tasks and performs daily ledger pruning.
    """
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    STALL_TIMEOUT = settings.STALL_TIMEOUT if hasattr(settings, "STALL_TIMEOUT") else 300
    
    print(f"🧹 Task Janitor started for node {node_id} (Timeout: {STALL_TIMEOUT}s)", flush=True)
    last_prune = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=23) # Trigger soon after start

    while True:
        try:
            # 0. Check for auto-termination
            await check_auto_termination()

            # 1. Stalled Task Recovery
            async with AsyncSessionLocal() as db:
                now_naive = datetime.now(UTC).replace(tzinfo=None)
                stall_threshold = now_naive - timedelta(seconds=STALL_TIMEOUT)
                
                result = await db.execute(
                    select(TaskEntry).filter(
                        and_(
                            TaskEntry.status.in_(["claimed", "processing", "running"]),
                            TaskEntry.updated_at < stall_threshold
                        )
                    )
                )
                stalled_tasks = result.scalars().all()
                
                for task in stalled_tasks:
                    print(f"🧹 Janitor: Task {task.id[:8]} stalled (Last Update: {task.updated_at}). Resetting to pending.", flush=True)
                    
                    old_owner = task.claimed_by
                    task.status = "pending"
                    task.claimed_by = None
                    task.claim_timestamp = None
                    task.updated_at = now_naive
                    task.retry_count += 1
                    
                    print(f"🏴‍☠️ Work Stealing: Node {old_owner} was too slow. Releasing task {task.id[:8]} back to the wild.", flush=True)
                    if old_owner:
                        owner_result = await db.execute(select(PeerEntry).filter(PeerEntry.id == old_owner))
                        owner = owner_result.scalars().first()
                        if owner and owner.status == "terminated":
                            print(f"🕊️ Janitor: Node {old_owner} terminated cleanly. Skipping reputation penalty.", flush=True)
                        else:
                            from app.core.reputation import ReputationEngine
                            await ReputationEngine.update_reputation(old_owner, "stalled")
                    
                if stalled_tasks:
                    await db.commit()
            
            # 2. Daily Ledger Pruning (Hygiene)
            now_naive = datetime.now(UTC).replace(tzinfo=None)
            if now_naive - last_prune > timedelta(hours=24):
                print("🧹 Janitor: Starting daily ledger hygiene pass...", flush=True)
                
                # Order matters: Messages -> Tasks -> PerformanceSnapshots
                from app.core.messages import MessageManager
                from app.core.execution import TaskExecutor
                from app.core.performance import PerformanceMonitor
                
                await MessageManager.prune_messages()
                await TaskExecutor.prune_tasks()
                await PerformanceMonitor.prune_snapshots()
                
                last_prune = now_naive
                print("✨ Janitor: Ledger hygiene pass complete.", flush=True)

        except Exception as e:
            logger.error(f"⚠️ Task Janitor error: {str(e)}")
            
        await asyncio.sleep(60)
