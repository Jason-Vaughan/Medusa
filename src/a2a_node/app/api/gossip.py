from fastapi import APIRouter, Depends, BackgroundTasks, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, or_
from app.core.database import get_db, AsyncSessionLocal
from app.models.ledger import PeerEntry, LedgerPeer, TaskEntry, MessageEntry, LedgerTask, LedgerMessage
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import httpx
import json
from app.core.config import settings
from app.core.security import verify_medusa_handshake, verify_medusa_secret
from app.core.auth_utils import get_auth_headers
import asyncio

router = APIRouter(dependencies=[Depends(verify_medusa_handshake)])

class SyncResponse(BaseModel):
    tasks: List[LedgerTask]
    messages: List[LedgerMessage]
    peers: List[LedgerPeer]
    timestamp: datetime

@router.get("/ping")
async def ping(node_id: str, address: str, capabilities: dict = None, strategies: str = None, health: str = None, db: AsyncSession = Depends(get_db)):
    """
    Endpoint for other nodes to announce themselves.
    Updates or creates a peer entry in the ledger.
    """
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
    peer = result.scalars().first()
    
    health_data = json.loads(health) if health else None
    
    if peer:
        peer.last_seen = datetime.utcnow()
        peer.address = address
        if capabilities:
            peer.capabilities = capabilities
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
            capabilities=capabilities,
            strategies=json.loads(strategies) if strategies else None,
            health_metadata=health_data,
            status="active"
        )
        db.add(new_peer)
    
    await db.commit()
    return {"status": "pong", "message": "I see you.", "node_id": settings.PROJECT_NAME}

@router.get("/peers", response_model=list[LedgerPeer])
async def list_peers(db: AsyncSession = Depends(get_db)):
    """
    Returns a list of all known peers in the ledger.
    """
    result = await db.execute(select(PeerEntry))
    return result.scalars().all()

@router.get("/sync", response_model=SyncResponse)
async def sync_ledger(since: Optional[datetime] = None, db: AsyncSession = Depends(get_db)):
    """
    Returns ledger entries updated since the provided timestamp.
    Used for state synchronization between nodes.
    """
    # SQLite doesn't always handle datetime.min well with SQLAlchemy
    if not since:
        since = datetime(1970, 1, 1)
        
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
        timestamp=datetime.utcnow()
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
                # 1. Discover potential peers from TangleClaw
                try:
                    tc_response = await client.get("https://localhost:3102/api/ports", timeout=2.0)
                except Exception:
                    if not _discovery_failed_last_time:
                        print("⚠️ TangleClaw HTTPS unreachable (Discovery muted).", flush=True)
                        _discovery_failed_last_time = True
                    await asyncio.sleep(60)
                    continue

                if _discovery_failed_last_time:
                    print("✅ TangleClaw HTTPS connectivity restored.", flush=True)
                    _discovery_failed_last_time = False

                if tc_response.status_code == 200:
                    ports = tc_response.json().get('leases', [])
                    for p in ports:
                        if p.get('service') == 'a2a-node' and p.get('port') != settings.PORT:
                            peer_address = f"http://localhost:{p['port']}"
                            
                            # 2. Ping and Sync
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
                                    
                            except Exception as e:
                                # print(f"Failed to sync with {peer_address}: {e}", flush=True)
                                pass
                
                last_sync_check = datetime.utcnow()
            
        except Exception as e:
            print(f"❌ Gossip fatal error: {str(e)}", flush=True)
            await asyncio.sleep(10)
        
        await asyncio.sleep(settings.GOSSIP_INTERVAL)

@router.post("/claim/{task_id}")
async def claim_task(task_id: str, node_id: str = Header(...), db: AsyncSession = Depends(get_db)):
    """
    Attempts to claim a task for execution.
    Implements optimistic locking/consensus via gossip.
    """
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status == "claimed" or task.claimed_by:
        return {"status": "already_claimed", "claimed_by": task.claimed_by, "timestamp": task.claim_timestamp}
    
    task.status = "claimed"
    task.claimed_by = node_id
    task.claim_timestamp = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    
    await db.commit()
    return {"status": "claimed", "task_id": task_id, "claimed_by": node_id, "timestamp": task.claim_timestamp}

async def reach_consensus(task: TaskEntry):
    """
    Analyzes results_votes to reach consensus on a task result.
    Implements a majority voting algorithm with sass.
    """
    votes = task.results_votes or {}
    if not votes:
        task.consensus_status = "none"
        return

    # Count occurrences of each result
    # We serialize to JSON to make it hashable for counting
    from collections import Counter
    import json
    
    result_counts = Counter()
    result_map = {} # map hash to original result
    
    for node_id, res in votes.items():
        res_json = json.dumps(res, sort_keys=True)
        result_counts[res_json] += 1
        result_map[res_json] = res
        
    if not result_counts:
        return

    # Find the majority
    most_common_json, count = result_counts.most_common(1)[0]
    
    print(f"🗳️ Consensus check for {task.id[:8]}: Quorum {count}/{task.min_votes}", flush=True)
    
    if count >= task.min_votes:
        # We have a winner!
        task.result = result_map[most_common_json]
        task.status = "completed"
        task.consensus_status = "achieved"
        print(f"✅ Consensus ACHIEVED for task {task.id[:8]}. Majority result selected.", flush=True)
    elif len(votes) >= task.min_votes:
        # Quorum met but no majority (or split vote)
        # If we have enough votes but no majority, it's a conflict
        if len(result_counts) > 1:
            task.consensus_status = "conflict"
            print(f"❌ Consensus CONFLICT for task {task.id[:8]}. Split votes detected: {result_counts.values()}", flush=True)
        else:
            task.consensus_status = "pending"
    else:
        task.consensus_status = "pending"

async def merge_sync_data(data: dict):
    """
    Merges synchronized data from a peer into the local ledger.
    Includes work stealing conflict resolution and distributed consensus.
    """
    async with AsyncSessionLocal() as db:
        try:
            # Merge Tasks
            for t_data in data.get('tasks', []):
                # Check if task already exists
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
                        claim_timestamp=datetime.fromisoformat(t_data['claim_timestamp'].replace('Z', '+00:00')) if t_data.get('claim_timestamp') else None,
                        result=t_data.get('result'),
                        execution_metadata=t_data.get('execution_metadata'),
                        requires_approval=t_data.get('requires_approval', 0),
                        approval_status=t_data.get('approval_status', 'none'),
                        retry_count=t_data.get('retry_count', 0),
                        max_retries=t_data.get('max_retries', 3),
                        requires_consensus=t_data.get('requires_consensus', 0),
                        min_votes=t_data.get('min_votes', 1),
                        results_votes=t_data.get('results_votes'),
                        consensus_status=t_data.get('consensus_status', 'none'),
                        created_at=datetime.fromisoformat(t_data['created_at'].replace('Z', '+00:00')),
                        updated_at=datetime.fromisoformat(t_data['updated_at'].replace('Z', '+00:00'))
                    )
                    db.add(new_task)
                else:
                    # Conflict resolution and Consensus logic
                    remote_updated = datetime.fromisoformat(t_data['updated_at'].replace('Z', '+00:00'))
                    remote_claimed_by = t_data.get('claimed_by')
                    remote_claim_ts = datetime.fromisoformat(t_data['claim_timestamp'].replace('Z', '+00:00')) if t_data.get('claim_timestamp') else None
                    
                    should_update = False
                    
                    # 1. Distributed Consensus Logic (Phase 12)
                    if existing.requires_consensus:
                        remote_votes = t_data.get('results_votes') or {}
                        local_votes = existing.results_votes or {}
                        
                        # Merge votes
                        votes_changed = False
                        for node_id, res in remote_votes.items():
                            if node_id not in local_votes:
                                local_votes[node_id] = res
                                votes_changed = True
                                
                        if votes_changed:
                            existing.results_votes = local_votes
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(existing, "results_votes")
                            
                            # Reach Consensus
                            await reach_consensus(existing)
                            should_update = True # To ensure it's saved

                    # 2. Regular LWW for other fields
                    if remote_updated > existing.updated_at:
                        should_update = True
                        
                    # 3. Conflict resolution for claims
                    if remote_claimed_by and existing.claimed_by and remote_claimed_by != existing.claimed_by:
                        # Both claimed it! Apply deterministic selection.
                        if remote_claim_ts < existing.claim_timestamp:
                            should_update = True
                        elif remote_claim_ts == existing.claim_timestamp:
                            if remote_claimed_by < existing.claimed_by:
                                should_update = True
                        else:
                            should_update = False # Keep our claim
                    
                    if should_update:
                        # Update core fields if remote is actually "better" or newer
                        if remote_updated > existing.updated_at or not existing.requires_consensus:
                            existing.status = t_data['status']
                            existing.result = t_data.get('result')
                            existing.execution_metadata = t_data.get('execution_metadata')
                            existing.claimed_by = remote_claimed_by
                            existing.claim_timestamp = remote_claim_ts
                            existing.updated_at = remote_updated
                        
                        # Always sync governance and consensus settings
                        existing.requires_approval = t_data.get('requires_approval', existing.requires_approval)
                        existing.approval_status = t_data.get('approval_status', existing.approval_status)
                        existing.requires_consensus = t_data.get('requires_consensus', existing.requires_consensus)
                        existing.min_votes = t_data.get('min_votes', existing.min_votes)

            # Merge Messages
            for m_data in data.get('messages', []):
                result = await db.execute(select(MessageEntry).filter(MessageEntry.id == m_data['id']))
                if not result.scalars().first():
                    new_msg = MessageEntry(
                        id=m_data['id'],
                        sender_id=m_data['sender_id'],
                        content=m_data['content'],
                        message_type=m_data['message_type'],
                        received_at=datetime.fromisoformat(m_data['received_at'].replace('Z', '+00:00'))
                    )
                    db.add(new_msg)

            # Merge Peers
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
                        last_seen=datetime.fromisoformat(p_data['last_seen'].replace('Z', '+00:00'))
                    )
                    db.add(new_peer)
                else:
                    existing.address = p_data['address']
                    existing.status = p_data.get('status', 'active')
                    existing.last_seen = datetime.fromisoformat(p_data['last_seen'].replace('Z', '+00:00'))
                    if p_data.get('capabilities'):
                        existing.capabilities = p_data['capabilities']
                    if p_data.get('strategies'):
                        existing.strategies = p_data['strategies']
                    if p_data.get('performance'):
                        existing.performance = p_data['performance']
                    if p_data.get('health_metadata'):
                        existing.health_metadata = p_data['health_metadata']

            await db.commit()
        except Exception as e:
            print(f"❌ Error merging sync data: {e}", flush=True)
            await db.rollback()
            await db.commit()
        except Exception as e:
            print(f"❌ Error merging sync data: {e}", flush=True)
            await db.rollback()
