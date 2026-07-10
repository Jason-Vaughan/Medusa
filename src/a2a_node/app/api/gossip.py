from fastapi import APIRouter, Depends, BackgroundTasks, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, or_
from app.core.database import get_db, AsyncSessionLocal
from app.models.ledger import PeerEntry, LedgerPeer, TaskEntry, MessageEntry, LedgerTask, LedgerMessage
from datetime import datetime, UTC, timedelta, timezone
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import httpx
import json
from app.core.config import settings
from app.core.security import verify_medusa_handshake, verify_medusa_secret
from app.core.auth_utils import get_auth_headers
from app.core.performance import PerformanceMonitor
import asyncio

router = APIRouter(dependencies=[Depends(verify_medusa_handshake)])

class SyncResponse(BaseModel):
    tasks: List[LedgerTask]
    messages: List[LedgerMessage]
    peers: List[LedgerPeer]
    timestamp: datetime

@router.get("/ping")
async def ping(
    node_id: str, 
    address: str, 
    workspace_id: str = None, 
    capabilities: str = None, 
    strategies: str = None, 
    health: str = None, 
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint for other nodes to announce themselves.
    Updates or creates a peer entry in the ledger.
    """
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
    peer = result.scalars().first()

    health_data = json.loads(health) if health else None
    cap_data = json.loads(capabilities) if capabilities else {}
    if workspace_id:
        cap_data["workspace_id"] = workspace_id

    now_naive = datetime.now(UTC).replace(tzinfo=None)

    if peer:
        peer.last_seen = now_naive
        peer.address = address
        if cap_data:
            peer.capabilities = cap_data
        if health_data:
            peer.health_metadata = health_data
        if strategies:
            try:
                peer.strategies = json.loads(strategies)
            except:
                pass
    else:
        new_peer = PeerEntry(
            id=node_id,
            address=address,
            capabilities=cap_data,
            strategies=json.loads(strategies) if strategies else None,
            health_metadata=health_data,
            status="active",
            last_seen=now_naive
        )
        db.add(new_peer)

    await db.commit()
    return {"status": "pong", "message": "I see you.", "node_id": f"{settings.PROJECT_NAME}-{settings.PORT}"}

@router.get("/peers", response_model=list[LedgerPeer])
async def list_peers(db: AsyncSession = Depends(get_db)):
    """
    Returns a list of all known peers in the ledger.
    """
    result = await db.execute(select(PeerEntry))
    return result.scalars().all()
class PeerStatusAction(BaseModel):
    reason: str

@router.post("/peers/{node_id}/quarantine")
async def quarantine_peer(node_id: str, action: PeerStatusAction, operator: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    """
    Manually quarantines a peer with a required reason and audit trail.
    """
    reason = action.reason

    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
    peer = result.scalars().first()
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found in ledger.")
    
    old_status = peer.status
    peer.status = "quarantined"
    
    # Audit trail
    health = peer.health_metadata or {}
    audit_log = health.get("audit_log", [])
    
    import getpass
    import time
    entry = {
        "action": "quarantine",
        "timestamp": datetime.now(UTC).isoformat(),
        "reason": reason,
        "operator": operator or getpass.getuser(),
        "previous_status": old_status
    }
    audit_log.append(entry)
    health["audit_log"] = audit_log
    peer.health_metadata = health
    
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(peer, "health_metadata")
    
    await db.commit()
    return {"status": "quarantined", "node_id": node_id, "audit": entry}
@router.post("/peers/{node_id}/unquarantine")
async def unquarantine_peer(node_id: str, action: PeerStatusAction, operator: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    """
    Removes a peer from quarantine with a required reason and audit trail.
    """
    reason = action.reason

    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
    peer = result.scalars().first()
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found in ledger.")
    
    old_status = peer.status
    peer.status = "active"
    
    # Audit trail
    health = peer.health_metadata or {}
    audit_log = health.get("audit_log", [])
    
    import getpass
    entry = {
        "action": "unquarantine",
        "timestamp": datetime.now(UTC).isoformat(),
        "reason": reason,
        "operator": operator or getpass.getuser(),
        "previous_status": old_status
    }
    audit_log.append(entry)
    health["audit_log"] = audit_log
    
    # Also reset conflict count if unquarantining manually
    health["conflict_count"] = 0
    
    peer.health_metadata = health
    
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(peer, "health_metadata")
    
    await db.commit()
    return {"status": "active", "node_id": node_id, "audit": entry}

@router.post("/peers/{node_id}/terminate")
async def terminate_peer(node_id: str, db: AsyncSession = Depends(get_db)):
    """
    Marks a peer as terminated (clean exit) to avoid reputation penalties.
    """
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
    peer = result.scalars().first()
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found in ledger.")
    
    peer.status = "terminated"
    peer.last_seen = datetime.now(UTC).replace(tzinfo=None)
    
    await db.commit()
    return {"status": "terminated", "node_id": node_id}

@router.get("/sync", response_model=SyncResponse)
async def sync_ledger(since: Optional[datetime] = None, db: AsyncSession = Depends(get_db)):
    """
    Returns ledger entries updated since the provided timestamp.
    Used for state synchronization between nodes.
    """
    # SQLite doesn't always handle datetime.min well with SQLAlchemy
    if not since:
        since = datetime(1970, 1, 1)
    elif since.tzinfo is not None:
        since = since.replace(tzinfo=None)
        
    tasks_result = await db.execute(
        select(TaskEntry).filter(TaskEntry.updated_at > since)
    )
    messages_result = await db.execute(
        select(MessageEntry).filter(MessageEntry.received_at > since)
    )
    peers_result = await db.execute(
        select(PeerEntry).filter(PeerEntry.last_seen > since)
    )
    
    return SyncResponse(
        tasks=tasks_result.scalars().all(),
        messages=messages_result.scalars().all(),
        peers=peers_result.scalars().all(),
        timestamp=datetime.now(UTC).replace(tzinfo=None)
    )

_discovery_failed_last_time = False

async def run_gossip():
    """
    Background task to discover, ping, and sync with peers.
    """
    global _discovery_failed_last_time
    print(f"📡 Gossip service started for node {settings.PROJECT_NAME}-{settings.PORT}", flush=True)
    
    last_sync_check = datetime(1970, 1, 1)
    
    while True:
        try:
            async with httpx.AsyncClient(verify=False) as client:
                # 1. Discover potential NEW peers from TangleClaw
                new_peer_addresses = []
                try:
                    tc_response = await client.get("http://localhost:3102/api/ports", timeout=2.0)
                    if tc_response.status_code == 200:
                        ports = tc_response.json().get('leases', [])
                        for p in ports:
                            if p.get('service') == 'a2a-node' and p.get('port') != settings.PORT:
                                new_peer_addresses.append(f"http://localhost:{p['port']}")
                        
                        if _discovery_failed_last_time:
                            print("✅ TangleClaw HTTPS connectivity restored.", flush=True)
                            _discovery_failed_last_time = False
                except Exception:
                    if not _discovery_failed_last_time:
                        print("⚠️ TangleClaw HTTPS unreachable (Discovery using ledger).", flush=True)
                        _discovery_failed_last_time = True
                
                # 2. Get existing ACTIVE peers from ledger
                active_peer_addresses = []
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(PeerEntry).filter(PeerEntry.status == "active"))
                    peers = result.scalars().all()
                    for peer in peers:
                        if peer.address and peer.id != f"{settings.PROJECT_NAME}-{settings.PORT}":
                            active_peer_addresses.append(peer.address)
                
                # 3. Combine and deduplicate
                all_peers = list(set(new_peer_addresses + active_peer_addresses))

                for peer_address in all_peers:
                    # 4. Ping and Sync
                    try:
                        # Ping
                        from app.core.heuristics import BiddingHeuristics
                        from app.core.performance import PerformanceMonitor
                        ping_url = f"{peer_address}/a2a/gossip/ping"
                        
                        params = {
                            "node_id": f"{settings.PROJECT_NAME}-{settings.PORT}",
                            "address": f"http://localhost:{settings.PORT}",
                            "strategies": json.dumps(await BiddingHeuristics.share_heuristic()),
                            "health": json.dumps(await PerformanceMonitor.get_resource_health())
                        }
                        if settings.WORKSPACE_ID:
                            params["workspace_id"] = settings.WORKSPACE_ID
                        headers = get_auth_headers("/a2a/gossip/ping")

                        await client.get(ping_url, params=params, headers=headers, timeout=1.0)

                        # Sync
                        sync_url = f"{peer_address}/a2a/gossip/sync"
                        sync_params = {"since": last_sync_check.isoformat()}
                        headers = get_auth_headers("/a2a/gossip/sync")
                        
                        r = await client.get(sync_url, params=sync_params, headers=headers, timeout=5.0)
                        if r.status_code == 200:
                            sync_data = r.json()
                            await merge_sync_data(sync_data)
                        else:
                            # print(f"⚠️ Gossip: Node {settings.PORT} sync failed with {peer_address}: {r.status_code}", flush=True)
                            pass
                            
                    except Exception:
                        pass

                # 5. Swarm Self-Healing (Chunk 31)
                async with AsyncSessionLocal() as db:
                    await cleanup_zombie_tasks(db)
                    await recover_stalled_consensus(db)
                
                last_sync_check = datetime.now(UTC).replace(tzinfo=None)
            
        except Exception as e:
            print(f"❌ Gossip fatal error: {str(e)}", flush=True)
            await asyncio.sleep(10)
        
        await asyncio.sleep(settings.GOSSIP_INTERVAL)

@router.post("/claim/{task_id}")
async def claim_task(task_id: str, node_id: str = Header(...), db: AsyncSession = Depends(get_db)):
    """
    Attempts to claim a task for execution.
    """
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status == "claimed" or task.claimed_by:
        return {"status": "already_claimed", "claimed_by": task.claimed_by, "timestamp": task.claim_timestamp}
    
    now_naive = datetime.now(UTC).replace(tzinfo=None)
    task.status = "claimed"
    task.claimed_by = node_id
    task.claim_timestamp = now_naive
    task.updated_at = now_naive
    
    await db.commit()
    return {"status": "claimed", "task_id": task_id, "claimed_by": node_id, "timestamp": task.claim_timestamp}

async def reach_consensus(task: TaskEntry, db: Optional[AsyncSession] = None):
    """
    Analyzes results_votes to reach consensus on a task result.
    """
    if not db:
        async with AsyncSessionLocal() as new_db:
            return await reach_consensus(task, new_db)

    votes = task.results_votes or {}
    if not votes:
        task.consensus_status = "none"
        return

    from collections import Counter
    import json
    from app.core.reputation import ReputationEngine
    
    total_weight = 0.0
    result_weights = {} # res_json -> weight
    result_counts = Counter()
    result_map = {} 
    node_reputations = {} # node_id -> reputation
    
    for node_id, res in votes.items():
        res_peer = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
        peer_obj = res_peer.scalars().first()
        if peer_obj and peer_obj.status == "quarantined":
            continue

        res_json = json.dumps(res, sort_keys=True)
        reputation = await ReputationEngine.get_reputation_score(node_id)
        node_reputations[node_id] = reputation
        
        weight = max(0.1, reputation)
        total_weight += weight
        
        result_weights[res_json] = result_weights.get(res_json, 0.0) + weight
        result_counts[res_json] += 1
        result_map[res_json] = res
        
    if not result_counts:
        return

    sorted_results = sorted(result_weights.items(), key=lambda x: x[1], reverse=True)
    best_res_json, best_weight = sorted_results[0]
    
    metadata = task.results_metadata or {}
    metadata.update({
        "total_weight": round(total_weight, 2),
        "distribution": {res_json: {"weight": round(w, 2), "count": result_counts[res_json]} for res_json, w in result_weights.items()}
    })
    task.results_metadata = metadata
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(task, "results_metadata")

    achieved = False
    if len(votes) >= task.min_votes:
        if task.consensus_strategy == "unanimous":
            if len(result_counts) == 1:
                achieved = True
        elif task.consensus_strategy == "weighted_threshold":
            if (best_weight / total_weight) >= (task.quorum_threshold or 0.5):
                achieved = True
        else: # Default: majority
            if best_weight > (total_weight / 2):
                achieved = True
            elif len(result_counts) > 1:
                most_reputable_node_id, most_reputable_score = max(node_reputations.items(), key=lambda x: x[1])
                if most_reputable_score >= 0.9:
                    rep_node_vote = json.dumps(votes[most_reputable_node_id], sort_keys=True)
                    if rep_node_vote == best_res_json:
                        achieved = True

    if achieved:
        task.result = result_map[best_res_json]
        task.status = "completed"
        task.consensus_status = "achieved"
        print(f"✅ Consensus ACHIEVED for task {task.id[:8]}.", flush=True)

        for node_id, res in votes.items():
            res_json = json.dumps(res, sort_keys=True)
            if res_json != best_res_json:
                await ReputationEngine.update_reputation(node_id, "consensus_disagreement")
                await track_node_conflict(node_id, db)
    elif len(votes) >= task.min_votes:
        metadata = task.execution_metadata or {}
        revote_count = metadata.get("revote_count", 0)
        last_conflict = metadata.get("last_conflict_ts")
        
        now = datetime.now(UTC).replace(tzinfo=None)
        
        if not last_conflict:
            metadata["last_conflict_ts"] = now.isoformat()
            task.execution_metadata = metadata
            task.consensus_status = "conflict"
        else:
            last_conflict_dt = datetime.fromisoformat(last_conflict).replace(tzinfo=None)
            if (now - last_conflict_dt).total_seconds() > 120:
                if revote_count < 3:
                    task.results_votes = {}
                    task.consensus_status = "pending"
                    metadata["revote_count"] = revote_count + 1
                    metadata["last_conflict_ts"] = None
                    task.execution_metadata = metadata
                else:
                    task.requires_approval = 1
                    task.approval_status = "pending"
                    task.consensus_status = "conflict"
            else:
                task.consensus_status = "conflict"
    else:
        task.consensus_status = "pending"

async def track_node_conflict(node_id: str, db: AsyncSession):
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
    peer = result.scalars().first()
    if not peer: return

    health = peer.health_metadata or {}
    conflicts = health.get("conflict_count", 0) + 1
    health["conflict_count"] = conflicts
    peer.health_metadata = health
    
    if conflicts >= 5 and peer.status != "quarantined":
        peer.status = "quarantined"
        print(f"⚠️ NODE QUARANTINED: {node_id[:8]} isolated.", flush=True)
    
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(peer, "health_metadata")

async def cleanup_zombie_tasks(db: AsyncSession):
    now = datetime.now(UTC).replace(tzinfo=None)
    result = await db.execute(
        select(TaskEntry).filter(
            TaskEntry.status.in_(["claimed", "processing", "running"]),
            TaskEntry.claimed_by.isnot(None)
        )
    )
    tasks = result.scalars().all()
    
    for task in tasks:
        peer_res = await db.execute(select(PeerEntry).filter(PeerEntry.id == task.claimed_by))
        peer = peer_res.scalars().first()
        
        is_zombie = False
        if not peer:
            is_zombie = True
        else:
            last_seen = peer.last_seen.replace(tzinfo=None) if peer.last_seen.tzinfo else peer.last_seen
            if last_seen < (now - timedelta(minutes=5)):
                is_zombie = True
            
        if is_zombie:
            print(f"🧟 Zombie Task Recovery: Resetting {task.id[:8]}", flush=True)
            task.status = "pending"
            task.claimed_by = None
            task.claim_timestamp = None
            task.retry_count += 1
            task.last_health_check = now
            
    await db.commit()

async def recover_stalled_consensus(db: AsyncSession):
    """
    Identifies tasks stalled due to insufficient active nodes and triggers recovery.
    """
    now = datetime.now(UTC).replace(tzinfo=None)
    result = await db.execute(
        select(TaskEntry).filter(
            TaskEntry.requires_consensus == 1,
            TaskEntry.consensus_status == "pending"
        )
    )
    tasks = result.scalars().all()
    
    if not tasks:
        return

    # Count active peers (including self)
    peer_result = await db.execute(
        select(PeerEntry).filter(
            PeerEntry.status == "active",
            PeerEntry.last_seen >= (now - timedelta(minutes=5))
        )
    )
    active_peers = peer_result.scalars().all()
    active_count = len(active_peers)
    
    # Ensure current node is counted if not in the list (e.g. if it hasn't pinged itself)
    # Most implementations include self in the peers table, but let's be safe.
    # If active_count is 0, we assume at least 1 (self) is active if this is running.
    if active_count == 0:
        active_count = 1

    for task in tasks:
        if active_count < task.min_votes:
            # Stalled!
            updated_at = task.updated_at.replace(tzinfo=None) if task.updated_at.tzinfo else task.updated_at
            pending_duration = (now - updated_at).total_seconds()
            
            metadata = task.execution_metadata or {}
            
            # Phase 1: Expand (60s - 120s)
            if 60 <= pending_duration < 120:
                if not metadata.get("last_expansion_request"):
                    print(f"📈 Quorum Recovery: Task {task.id[:8]} stalled. Requesting expansion.", flush=True)
                    await PerformanceMonitor.request_mesh_expansion()
                    metadata["last_expansion_request"] = now.isoformat()
                    task.execution_metadata = metadata
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(task, "execution_metadata")
            
            # Phase 2: Downgrade (> 120s)
            elif pending_duration >= 120:
                print(f"⚠️ Quorum Recovery: Task {task.id[:8]} downgraded from {task.min_votes} to {active_count}.", flush=True)
                
                res_metadata = task.results_metadata or {}
                res_metadata["quorum_downgraded"] = True
                res_metadata["original_min_votes"] = task.min_votes
                task.results_metadata = res_metadata
                
                task.min_votes = active_count
                
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(task, "results_metadata")
                
                # Immediately re-evaluate consensus
                await reach_consensus(task, db)
                    
    await db.commit()

async def merge_sync_data(data: dict):
    async with AsyncSessionLocal() as db:
        try:
            for t_data in data.get('tasks', []):
                result = await db.execute(select(TaskEntry).filter(TaskEntry.id == t_data['id']))
                existing = result.scalars().first()
                if not existing:
                    new_task = TaskEntry(
                        id=t_data['id'],
                        task_type=t_data['task_type'],
                        description=t_data['description'],
                        context=t_data.get('context'),
                        status=t_data['status'],
                        priority=t_data['priority'],
                        assigned_to=t_data['assigned_to'],
                        assigned_by=t_data.get('assigned_by'),
                        claimed_by=t_data.get('claimed_by'),
                        claim_timestamp=datetime.fromisoformat(t_data['claim_timestamp'].replace('Z', '+00:00')).replace(tzinfo=None) if t_data.get('claim_timestamp') else None,
                        result=t_data.get('result'),
                        execution_metadata=t_data.get('execution_metadata'),
                        requires_approval=t_data.get('requires_approval', 0),
                        approval_status=t_data.get('approval_status', 'none'),
                        retry_count=t_data.get('retry_count', 0),
                        max_retries=t_data.get('max_retries', 3),
                        next_retry_at=datetime.fromisoformat(t_data['next_retry_at'].replace('Z', '+00:00')).replace(tzinfo=None) if t_data.get('next_retry_at') else None,
                        requires_consensus=t_data.get('requires_consensus', 0),
                        min_votes=t_data.get('min_votes', 1),
                        results_votes=t_data.get('results_votes'),
                        consensus_status=t_data.get('consensus_status', 'none'),
                        consensus_strategy=t_data.get('consensus_strategy', 'majority'),
                        quorum_threshold=t_data.get('quorum_threshold', 0.5),
                        results_metadata=t_data.get('results_metadata'),
                        created_at=datetime.fromisoformat(t_data['created_at'].replace('Z', '+00:00')).replace(tzinfo=None),
                        updated_at=datetime.fromisoformat(t_data['updated_at'].replace('Z', '+00:00')).replace(tzinfo=None)
                    )
                    db.add(new_task)
                else:
                    remote_updated = datetime.fromisoformat(t_data['updated_at'].replace('Z', '+00:00')).replace(tzinfo=None)
                    remote_claimed_by = t_data.get('claimed_by')
                    remote_claim_ts = datetime.fromisoformat(t_data['claim_timestamp'].replace('Z', '+00:00')).replace(tzinfo=None) if t_data.get('claim_timestamp') else None
                    
                    should_update = False
                    if existing.requires_consensus:
                        remote_votes = t_data.get('results_votes') or {}
                        local_votes = existing.results_votes or {}
                        votes_changed = False
                        for node_id, res in remote_votes.items():
                            if node_id not in local_votes:
                                local_votes[node_id] = res
                                votes_changed = True
                        if votes_changed:
                            existing.results_votes = local_votes
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(existing, "results_votes")
                            await reach_consensus(existing, db)
                            should_update = True

                    existing_updated = existing.updated_at.replace(tzinfo=None) if existing.updated_at.tzinfo else existing.updated_at
                    if remote_updated > existing_updated:
                        should_update = True
                        
                    if remote_claimed_by and existing.claimed_by and remote_claimed_by != existing.claimed_by:
                        existing_claim_ts = existing.claim_timestamp.replace(tzinfo=None) if existing.claim_timestamp and existing.claim_timestamp.tzinfo else existing.claim_timestamp
                        if not existing_claim_ts or (remote_claim_ts and remote_claim_ts < existing_claim_ts):
                            should_update = True
                        elif remote_claim_ts == existing_claim_ts:
                            if remote_claimed_by < existing.claimed_by:
                                should_update = True
                        else:
                            should_update = False
                    
                    if should_update:
                        if remote_updated > existing_updated or not existing.requires_consensus:
                            if existing.status in ["claimed", "processing", "running"] and t_data['status'] == "completed" and remote_claimed_by:
                                from app.core.reputation import ReputationEngine
                                latency = 0.0
                                existing_claim_ts = existing.claim_timestamp.replace(tzinfo=None) if existing.claim_timestamp and existing.claim_timestamp.tzinfo else existing.claim_timestamp
                                if existing_claim_ts:
                                    latency = (remote_updated - existing_claim_ts).total_seconds()
                                await ReputationEngine.update_reputation(remote_claimed_by, "completed", {"latency": latency})
                            elif existing.status in ["claimed", "processing", "running"] and t_data['status'] == "failed" and remote_claimed_by:
                                from app.core.reputation import ReputationEngine
                                await ReputationEngine.update_reputation(remote_claimed_by, "failed")

                            existing.status = t_data['status']
                            existing.result = t_data.get('result')
                            existing.execution_metadata = t_data.get('execution_metadata')
                            existing.claimed_by = remote_claimed_by
                            existing.claim_timestamp = remote_claim_ts
                            existing.updated_at = remote_updated
                        
                        existing.requires_approval = t_data.get('requires_approval', existing.requires_approval)
                        existing.approval_status = t_data.get('approval_status', existing.approval_status)
                        existing.retry_count = t_data.get('retry_count', existing.retry_count)
                        existing.max_retries = t_data.get('max_retries', existing.max_retries)
                        existing.next_retry_at = datetime.fromisoformat(t_data['next_retry_at'].replace('Z', '+00:00')).replace(tzinfo=None) if t_data.get('next_retry_at') else None
                        existing.requires_consensus = t_data.get('requires_consensus', existing.requires_consensus)
                        existing.min_votes = t_data.get('min_votes', existing.min_votes)
                        existing.consensus_strategy = t_data.get('consensus_strategy', existing.consensus_strategy)
                        existing.quorum_threshold = t_data.get('quorum_threshold', existing.quorum_threshold)
                        existing.results_metadata = t_data.get('results_metadata', existing.results_metadata)

            for m_data in data.get('messages', []):
                result = await db.execute(select(MessageEntry).filter(MessageEntry.id == m_data['id']))
                if not result.scalars().first():
                    new_msg = MessageEntry(
                        id=m_data['id'],
                        sender_id=m_data['sender_id'],
                        content=m_data['content'],
                        message_type=m_data['message_type'],
                        received_at=datetime.fromisoformat(m_data['received_at'].replace('Z', '+00:00')).replace(tzinfo=None)
                    )
                    db.add(new_msg)

            for p_data in data.get('peers', []):
                result = await db.execute(select(PeerEntry).filter(PeerEntry.id == p_data['id']))
                existing = result.scalars().first()
                if not existing:
                    new_peer = PeerEntry(
                        id=p_data['id'],
                        address=p_data['address'],
                        capabilities=p_data.get('capabilities'),
                        strategies=p_data.get('strategies'),
                        performance=p_data.get('performance'),
                        health_metadata=p_data.get('health_metadata'),
                        status=p_data.get('status', 'active'),
                        last_seen=datetime.fromisoformat(p_data['last_seen'].replace('Z', '+00:00')).replace(tzinfo=None)
                    )
                    db.add(new_peer)
                else:
                    existing.address = p_data['address']
                    existing.status = p_data.get('status', 'active')
                    existing.last_seen = datetime.fromisoformat(p_data['last_seen'].replace('Z', '+00:00')).replace(tzinfo=None)
                    if p_data.get('capabilities'): existing.capabilities = p_data['capabilities']
                    if p_data.get('strategies'): existing.strategies = p_data['strategies']
                    if p_data.get('performance'): existing.performance = p_data['performance']
                    if p_data.get('health_metadata'): existing.health_metadata = p_data['health_metadata']

            await db.commit()
        except Exception as e:
            print(f"❌ Error merging sync data: {e}", flush=True)
            await db.rollback()
