import asyncio
import logging
import httpx
from datetime import datetime
from sqlalchemy import select, or_, and_
from app.core.database import AsyncSessionLocal
from app.models.ledger import TaskEntry, PeerEntry
from app.core.config import settings
from app.core.heuristics import BiddingHeuristics

logger = logging.getLogger("a2a_swarm")

async def run_swarm_intelligence():
    """
    Background task that scans for tasks to claim based on skills and swarm logic.
    """
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    print(f"🐝 Swarm Intelligence started for node {node_id}", flush=True)

    while True:
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
                # Or tasks that require consensus and we haven't voted on yet
                result = await db.execute(
                    select(TaskEntry).filter(
                        or_(
                            and_(TaskEntry.status == "pending", TaskEntry.claimed_by == None),
                            and_(TaskEntry.requires_consensus == 1, TaskEntry.consensus_status != "achieved")
                        )
                    )
                )
                tasks = result.scalars().all()

                for task in tasks:
                    # Skip if we already voted on this consensus task
                    if task.requires_consensus:
                        votes = task.results_votes or {}
                        if node_id in votes:
                            continue

                    # 3. Evaluate task using heuristics and swarm-wide strategy
                    eval_result = await BiddingHeuristics.evaluate_with_swarm_intelligence(
                        task.task_type, 
                        task.description,
                        peers,
                        current_load=current_load
                    )
                    
                    if eval_result["should_bid"]:
                        print(f"🐝 Node {node_id} wants to claim task {task.id[:8]} ({task.task_type}) - Confidence: {eval_result['confidence']}", flush=True)
                        
                        # 3. Call local claim endpoint (which handles persistence and gossip)
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
                                    else:
                                        print(f"⚠️ Node {node_id} failed to claim task {task.id[:8]}: {res.get('status')}", flush=True)
                            except Exception as e:
                                logger.error(f"❌ Swarm claim request failed: {e}")

        except Exception as e:
            logger.error(f"⚠️ Swarm intelligence error: {str(e)}")
            
        await asyncio.sleep(10) # Poll every 10 seconds

async def run_task_janitor():
    """
    Background task that monitors for stalled tasks and releases them back to the swarm.
    Implementation of 'Work Stealing' via reset-to-pending (Chunk 24).
    """
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    # STALL_TIMEOUT = 300 # 5 minutes in seconds
    STALL_TIMEOUT = settings.STALL_TIMEOUT if hasattr(settings, "STALL_TIMEOUT") else 300
    
    print(f"🧹 Task Janitor started for node {node_id} (Timeout: {STALL_TIMEOUT}s)", flush=True)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                from datetime import datetime, timedelta
                stall_threshold = datetime.utcnow() - timedelta(seconds=STALL_TIMEOUT)
                
                # Find tasks in 'claimed' or 'processing' status that haven't been updated
                result = await db.execute(
                    select(TaskEntry).filter(
                        and_(
                            TaskEntry.status.in_(["claimed", "processing"]),
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
                    task.updated_at = datetime.utcnow()
                    task.retry_count += 1
                    
                    # Log event and update reputation
                    print(f"🏴‍☠️ Work Stealing: Node {old_owner} was too slow. Releasing task {task.id[:8]} back to the wild.", flush=True)
                    if old_owner:
                        from app.core.reputation import ReputationEngine
                        await ReputationEngine.update_reputation(old_owner, "stalled")
                    
                if stalled_tasks:
                    await db.commit()
                    
        except Exception as e:
            logger.error(f"⚠️ Task Janitor error: {str(e)}")
            
        await asyncio.sleep(60) # Run every minute
