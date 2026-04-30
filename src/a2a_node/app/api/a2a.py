from fastapi import APIRouter, HTTPException, Body, Depends
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.models.ledger import (
    TaskEntry, MessageEntry, PeerEntry, LedgerTask, LedgerMessage,
    CapabilityProfile, WorkspaceGrant, CapabilityProfileSchema, WorkspaceGrantSchema
)
from app.core.decomposition import DecompositionEngine
from app.core.governance import GovernanceEngine
from datetime import datetime, timezone
from app.core.security import verify_medusa_handshake, verify_medusa_secret
from app.core.auth_utils import get_auth_headers
from app.core.config import settings
import httpx

router = APIRouter(dependencies=[Depends(verify_medusa_handshake)])

class TaskRequest(BaseModel):
    task_type: str
    description: str
    context: Optional[dict] = None
    priority: int = 1
    assigned_by: Optional[str] = None # Added for remote requests
    assigned_to: Optional[str] = "local" # Added for global tasks
    requires_approval: Optional[bool] = None # Explicit override
    requires_consensus: Optional[bool] = False
    min_votes: Optional[int] = 1

class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str

class DelegateRequest(BaseModel):
    peer_id: str
    task_id: str

class MessageRequest(BaseModel):
    sender_id: str
    content: str
    message_type: str = "chat"
    recipient_id: Optional[str] = None # Added for routing

class BroadcastRequest(BaseModel):
    content: str
    message_type: str = "broadcast"

class BidRequest(BaseModel):
    task_id: str
    bidder_id: str
    bid_value: float # Lower is better (e.g. cost, time)
    confidence: float # 0.0 to 1.0
    metadata: Optional[dict] = None
    bidder_skills: Optional[List[str]] = None

class ProfileCreate(BaseModel):
    id: str
    description: Optional[str] = None
    allowed_patterns: Optional[List[Dict[str, Any]]] = None
    denied_patterns: Optional[List[Dict[str, Any]]] = None
    path_scope: Optional[Dict[str, Any]] = None
    approval_routing: Optional[Dict[str, Any]] = None

class GrantCreate(BaseModel):
    profile_id: str
    granted_by: str
    scope: Optional[str] = None
    expires_at: datetime

ProfileCreate.model_rebuild()
GrantCreate.model_rebuild()

@router.post("/tasks", response_model=TaskResponse)
async def create_task(
    task: TaskRequest, 
    db: AsyncSession = Depends(get_db),
    caller_id: str = Depends(verify_medusa_handshake)
):
    """
    Creates a new A2A task. If assigned_by is provided, it's treated as a remote request.
    """
    task_id = str(uuid.uuid4())
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    
    # Trusted client ID from handshake
    client_id = caller_id if caller_id != "unknown-client" else (task.assigned_by or node_id)
    
    # HITL Governance Evaluation
    # Use trusted client_id for grant checks
    gov_eval = await GovernanceEngine.evaluate_task(
        task.task_type, 
        task.description, 
        workspace_id=client_id, 
        db=db
    )
    requires_approval = task.requires_approval if task.requires_approval is not None else gov_eval["requires_approval"]
    
    status = "pending_approval" if requires_approval else "pending"
    approval_status = "pending" if requires_approval else "none"
    if not requires_approval and gov_eval.get("grant_id"):
        approval_status = "pre_approved"
    
    new_task = TaskEntry(
        id=task_id,
        task_type=task.task_type,
        description=task.description,
        context=task.context,
        status=status,
        priority=task.priority,
        assigned_to=task.assigned_to or "local",
        assigned_by=task.assigned_by or node_id,
        requires_approval=1 if requires_approval else 0, # SQLite compatibility
        approval_status=approval_status,
        requires_consensus=1 if task.requires_consensus else 0,
        min_votes=task.min_votes or 1,
        results_votes={},
        consensus_status="pending" if task.requires_consensus else "none",
        execution_metadata={
            "governance": gov_eval,
            "grant_id": gov_eval.get("grant_id")
        },
        created_at=datetime.now(timezone.utc).replace(tzinfo=None)
    )
    db.add(new_task)
    await db.commit()
    
    if requires_approval:
        msg = f"Task created but requires human approval: {gov_eval['reason']}"
    else:
        msg = "Task accepted and queued for local execution." if not task.assigned_by else "Task accepted from peer and queued locally."
        
    return TaskResponse(
        task_id=task_id,
        status=status,
        message=f"{msg} ID: {task_id}"
    )

@router.post("/tasks/delegate", response_model=TaskResponse)
async def delegate_task(req: DelegateRequest, db: AsyncSession = Depends(get_db)):
    """
    Delegates a local task to a peer.
    """
    # 1. Fetch the task
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == req.task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    
    # 2. Fetch the peer
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == req.peer_id))
    peer = result.scalars().first()
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found in ledger.")
    
    # 3. Call peer's /tasks endpoint
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    try:
        payload = {
            "task_type": task.task_type,
            "description": task.description,
            "context": task.context,
            "priority": task.priority,
            "assigned_by": node_id
        }
        headers = get_auth_headers("/a2a/tasks")
        
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{peer.address}/a2a/tasks", json=payload, headers=headers, timeout=5)
            if r.status_code == 200:
                remote_task = r.json()
                # 4. Update local task status
                task.status = "delegated"
                task.assigned_to = req.peer_id
                task.execution_metadata = {"remote_task_id": remote_task['task_id']}
                await db.commit()
                
                return TaskResponse(
                    task_id=task.id,
                    status="delegated",
                    message=f"Successfully delegated task to {req.peer_id}. Remote ID: {remote_task['task_id']}"
                )
            else:
                raise HTTPException(status_code=500, detail=f"Peer rejected task: {r.text}")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delegate: {str(e)}")

@router.post("/tasks/{task_id}/decompose")
async def decompose_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Triggers the decomposition of a complex task into multiple sub-tasks.
    """
    result = await DecompositionEngine.decompose_task(task_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    if "message" in result:
        return {"status": "skipped", "message": result["message"]}
        
    return {
        "status": "decomposed",
        "parent_id": task_id,
        "subtask_count": result["subtask_count"],
        "message": f"Successfully spawned {result['subtask_count']} child tasks. The hive is buzzing."
    }

@router.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Approves a task that was pending human intervention.
    """
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    
    if task.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Task is in {task.status} status and doesn't require approval.")
    
    task.status = "pending"
    task.approval_status = "approved"
    await db.commit()
    
    return {"status": "approved", "task_id": task_id, "message": "Task approved. The autonomous swarm is now authorized to proceed."}

@router.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Rejects a task, preventing its execution.
    """
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    
    task.status = "rejected"
    task.approval_status = "rejected"
    await db.commit()
    
    return {"status": "rejected", "task_id": task_id, "message": "Task rejected. The hive will not touch this with a ten-foot pole."}

@router.get("/tasks/{task_id}", response_model=LedgerTask)
async def get_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Retrieves the status and details of a specific A2A task from the ledger.
    """
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in the ledger.")
    return task

@router.get("/tasks", response_model=List[LedgerTask])
async def list_tasks(limit: int = 10, db: AsyncSession = Depends(get_db)):
    """
    Lists the most recent tasks from the ledger.
    """
    result = await db.execute(select(TaskEntry).order_by(TaskEntry.created_at.desc()).limit(limit))
    return result.scalars().all()

@router.post("/tasks/bid")
async def place_bid(bid: BidRequest, db: AsyncSession = Depends(get_db)):
    """
    Peers call this to place a bid on a specific task.
    """
    # 1. Fetch the task
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == bid.task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in ledger.")

    # 2. Update task status and bid metadata
    task.status = "negotiating"

    current_bid_data = task.bid_metadata or {"bids": []}
    # Ensure bids is a list
    if not isinstance(current_bid_data.get("bids"), list):
        current_bid_data["bids"] = []

    current_bid_data["bids"].append({
        "bidder_id": bid.bidder_id,
        "bid_value": bid.bid_value,
        "confidence": bid.confidence,
        "metadata": bid.metadata,
        "bidder_skills": bid.bidder_skills,
        "timestamp": datetime.utcnow().isoformat()
    })

    # Update status based on some logic? No, just keep negotiating.

    # IMPORTANT: SQLAlchemy JSON columns need explicit re-assignment to trigger update
    from sqlalchemy.orm.attributes import flag_modified
    task.bid_metadata = current_bid_data
    flag_modified(task, "bid_metadata")

    await db.commit()

    return {"status": "bid_accepted", "message": "Your bid has been recorded. Don't hold your breath.", "task_id": task.id}

# Capability Profiles API
@router.post("/capabilities/profiles", response_model=CapabilityProfileSchema)
async def create_profile(profile: ProfileCreate, db: AsyncSession = Depends(get_db)):
    # Check if profile with same ID exists to increment version
    result = await db.execute(
        select(CapabilityProfile)
        .filter(CapabilityProfile.id == profile.id)
        .order_by(CapabilityProfile.version.desc())
    )
    latest = result.scalars().first()
    version = (latest.version + 1) if latest else 1

    new_profile = CapabilityProfile(
        id=profile.id,
        version=version,
        description=profile.description,
        allowed_patterns=profile.allowed_patterns,
        denied_patterns=profile.denied_patterns,
        path_scope=profile.path_scope,
        approval_routing=profile.approval_routing
    )
    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)
    return new_profile

@router.get("/capabilities/profiles", response_model=List[CapabilityProfileSchema])
async def list_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CapabilityProfile))
    return result.scalars().all()

@router.get("/capabilities/profiles/{profile_id}", response_model=List[CapabilityProfileSchema])
async def get_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CapabilityProfile).filter(CapabilityProfile.id == profile_id))
    profiles = result.scalars().all()
    if not profiles:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profiles

# Workspace Grants API
@router.post("/workspaces/{workspace_id}/grants", response_model=WorkspaceGrantSchema)
async def issue_grant(workspace_id: str, grant: GrantCreate, db: AsyncSession = Depends(get_db)):
    # Verify profile exists
    result = await db.execute(
        select(CapabilityProfile)
        .filter(CapabilityProfile.id == grant.profile_id)
        .order_by(CapabilityProfile.version.desc())
    )
    profile = result.scalars().first()
    if not profile:
        raise HTTPException(status_code=404, detail="Capability profile not found")

    grant_id = f"grant-{str(uuid.uuid4())[:8]}"
    new_grant = WorkspaceGrant(
        id=grant_id,
        workspace_id=workspace_id,
        profile_id=profile.id,
        profile_version=profile.version,
        granted_by=grant.granted_by,
        scope=grant.scope,
        expires_at=grant.expires_at,
        revoked=0
    )
    db.add(new_grant)
    await db.commit()
    await db.refresh(new_grant)
    return new_grant

@router.get("/workspaces/{workspace_id}/grants", response_model=List[WorkspaceGrantSchema])
async def list_grants(workspace_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WorkspaceGrant)
        .filter(WorkspaceGrant.workspace_id == workspace_id)
        .filter(WorkspaceGrant.revoked == 0)
        .filter(WorkspaceGrant.expires_at > datetime.now(timezone.utc).replace(tzinfo=None))
    )
    return result.scalars().all()

@router.delete("/grants/{grant_id}")
async def revoke_grant(grant_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WorkspaceGrant).filter(WorkspaceGrant.id == grant_id))
    grant = result.scalars().first()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")

    grant.revoked = 1
    await db.commit()
    return {"status": "revoked", "grant_id": grant_id}

# Audit API
@router.get("/audit/grants/{grant_id}", response_model=List[LedgerTask])
async def get_grant_audit(grant_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns full action history under a specific grant.
    """
    # Note: Using string lookup in JSON for SQLite compatibility
    result = await db.execute(
        select(TaskEntry)
        .filter(TaskEntry.execution_metadata.like(f'%"{grant_id}"%')) 
        .order_by(TaskEntry.created_at.desc())
    )
    return result.scalars().all()

@router.get("/audit/workspaces/{workspace_id}/actions", response_model=List[LedgerTask])
async def get_workspace_actions(workspace_id: str, since: Optional[datetime] = None, db: AsyncSession = Depends(get_db)):
    """
    Returns chronological action log for a workspace.
    """
    query = select(TaskEntry).filter(TaskEntry.assigned_by == workspace_id)
    if since:
        query = query.filter(TaskEntry.created_at >= since)
    
    result = await db.execute(query.order_by(TaskEntry.created_at.desc()))
    return result.scalars().all()
@router.post("/tasks/{task_id}/announce")
async def announce_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Broadcasts a task announcement to all known active peers to solicit bids.
    """
    # 1. Fetch the task
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    
    # 2. Fetch all peers
    result = await db.execute(select(PeerEntry).filter(PeerEntry.status == "active"))
    peers = result.scalars().all()
    
    if not peers:
        return {"status": "skipped", "message": "No active peers to announce to."}
        
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    node_address = f"http://localhost:{settings.PORT}"
    success_count = 0
    
    async with httpx.AsyncClient() as client:
        for peer in peers:
            try:
                payload = {
                    "sender_id": node_id,
                    "content": json.dumps({
                        "type": "task_announcement",
                        "task_id": task.id,
                        "task_type": task.task_type,
                        "description": task.description,
                        "bid_endpoint": f"{node_address}/a2a/tasks/bid"
                    }),
                    "message_type": "task_announcement"
                }
                headers = {"X-Medusa-Secret": settings.A2A_SECRET}
                r = await client.post(f"{peer.address}/a2a/messages", json=payload, headers=headers, timeout=2)
                if r.status_code == 200:
                    success_count += 1
            except Exception:
                pass
                
    return {"status": "announced", "recipients": success_count, "total_peers": len(peers)}

@router.post("/tasks/{task_id}/resolve_auction")
async def resolve_auction(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Selects the best bidder and delegates the task to them.
    """
    # 1. Fetch the task
    result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    
    if not task.bid_metadata or not task.bid_metadata.get("bids"):
        raise HTTPException(status_code=400, detail="No bids found for this task.")
        
    # 2. Select winner (lowest bid_value)
    bids = task.bid_metadata["bids"]
    winner = min(bids, key=lambda x: x['bid_value'])
    
    # 3. Delegate to winner
    # Re-use our delegate_task logic (though it's usually called from a request)
    # Actually, we can just call it manually or simulate the logic
    
    # Fetch winner peer
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == winner['bidder_id']))
    peer = result.scalars().first()
    if not peer:
        raise HTTPException(status_code=404, detail=f"Winner peer {winner['bidder_id']} not found.")
        
    # Delegate
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    try:
        payload = {
            "task_type": task.task_type,
            "description": task.description,
            "context": task.context,
            "priority": task.priority,
            "assigned_by": node_id
        }
        headers = get_auth_headers("/a2a/tasks")
        
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{peer.address}/a2a/tasks", json=payload, headers=headers, timeout=5)
            if r.status_code == 200:
                remote_task = r.json()
                task.status = "delegated"
                task.assigned_to = winner['bidder_id']
                task.execution_metadata = {
                    "remote_task_id": remote_task['task_id'],
                    "auction_winner": winner['bidder_id'],
                    "bid_value": winner['bid_value']
                }
                await db.commit()
                return {"status": "auction_resolved", "winner": winner['bidder_id'], "remote_task_id": remote_task['task_id']}
            else:
                raise HTTPException(status_code=500, detail=f"Winner rejected task: {r.text}")
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delegate during resolution: {str(e)}")

@router.post("/messages")
async def receive_message(message: MessageRequest, db: AsyncSession = Depends(get_db)):
    """
    Receives an incoming A2A direct message and persists it to the ledger.
    """
    msg_id = str(uuid.uuid4())
    new_msg = MessageEntry(
        id=msg_id,
        sender_id=message.sender_id,
        content=message.content,
        message_type=message.message_type
    )
    db.add(new_msg)
    await db.commit()
    
    return {"status": "received", "message": "Message acknowledged and logged with moderate disdain.", "id": msg_id}

@router.post("/messages/send")
async def send_message(message: MessageRequest, db: AsyncSession = Depends(get_db)):
    """
    Sends a direct message to a peer.
    """
    if not message.recipient_id:
        raise HTTPException(status_code=400, detail="Recipient ID is required for sending.")
        
    # 1. Fetch the peer
    result = await db.execute(select(PeerEntry).filter(PeerEntry.id == message.recipient_id))
    peer = result.scalars().first()
    if not peer:
        raise HTTPException(status_code=404, detail=f"Peer {message.recipient_id} not found.")
        
    # 2. Call peer's /messages endpoint
    try:
        payload = {
            "sender_id": message.sender_id,
            "content": message.content,
            "message_type": message.message_type
        }
        headers = get_auth_headers("/a2a/messages")
        
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{peer.address}/a2a/messages", json=payload, headers=headers, timeout=5)
            if r.status_code == 200:
                # Log locally too? Yes, for history.
                msg_id = str(uuid.uuid4())
                new_msg = MessageEntry(
                    id=msg_id,
                    sender_id=message.sender_id,
                    content=f"[OUTBOUND TO {message.recipient_id}] {message.content}",
                    message_type=message.message_type
                )
                db.add(new_msg)
                await db.commit()
                return r.json()
            else:
                raise HTTPException(status_code=r.status_code, detail=f"Peer rejected message: {r.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send message: {str(e)}")

@router.post("/messages/broadcast")
async def broadcast_message(req: BroadcastRequest, db: AsyncSession = Depends(get_db)):
    """
    Broadcasts a message to all known active peers.
    """
    # 1. Fetch all peers
    result = await db.execute(select(PeerEntry).filter(PeerEntry.status == "active"))
    peers = result.scalars().all()
    
    if not peers:
        return {"status": "skipped", "message": "No active peers to broadcast to."}
        
    node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
    success_count = 0
    
    async with httpx.AsyncClient() as client:
        for peer in peers:
            try:
                payload = {
                    "sender_id": node_id,
                    "content": req.content,
                    "message_type": req.message_type
                }
                headers = {"X-Medusa-Secret": settings.A2A_SECRET}
                r = await client.post(f"{peer.address}/a2a/messages", json=payload, headers=headers, timeout=2)
                if r.status_code == 200:
                    success_count += 1
            except Exception:
                pass # Ignore individual peer failures during broadcast
                
    # Log locally
    msg_id = str(uuid.uuid4())
    new_msg = MessageEntry(
        id=msg_id,
        sender_id=node_id,
        content=f"[BROADCAST] {req.content}",
        message_type=req.message_type
    )
    db.add(new_msg)
    await db.commit()
    
    return {"status": "broadcasted", "recipients": success_count, "total_peers": len(peers)}

@router.get("/messages", response_model=List[LedgerMessage])
async def list_messages(limit: int = 20, db: AsyncSession = Depends(get_db)):
    """
    Lists the most recent messages from the ledger.
    """
    result = await db.execute(select(MessageEntry).order_by(MessageEntry.received_at.desc()).limit(limit))
    return result.scalars().all()

@router.get("/performance/history")
async def get_performance_history(node_id: str = "global", limit: int = 50):
    """
    Retrieves historical performance snapshots for the specified node or 'global' for the mesh.
    """
    from app.core.performance import PerformanceMonitor
    return await PerformanceMonitor.get_history(node_id=node_id, limit=limit)
