from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
from sqlalchemy.ext.mutable import MutableList
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text
from app.core.database import Base

# SQLAlchemy Models for DB persistence
class TaskEntry(Base):
    __tablename__ = "tasks"
    
    id = Column(String, primary_key=True, index=True)
    task_type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    context = Column(JSON, nullable=True)
    status = Column(String, default="pending") # pending, running, completed, failed, delegated, negotiating, claimed
    priority = Column(Integer, default=1)
    assigned_to = Column(String, default="local") # "local" or a peer_id
    assigned_by = Column(String, nullable=True) # node_id of the requester
    claimed_by = Column(String, nullable=True) # node_id of the node that claimed it
    claim_timestamp = Column(DateTime, nullable=True)
    parent_id = Column(String, nullable=True, index=True) # For sub-tasks
    depends_on = Column(MutableList.as_mutable(JSON), nullable=True) # List of task IDs this task depends on
    subtask_count = Column(Integer, default=0) # Number of children
    result = Column(JSON, nullable=True)
    execution_metadata = Column(JSON, nullable=True)
    bid_metadata = Column(JSON, nullable=True)
    
    # Governance & Human-in-the-Loop
    requires_approval = Column(Integer, default=0) # 0 for False, 1 for True (SQLite compatibility)
    approval_status = Column(String, default="none") # none, pending, approved, rejected
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    
    # Distributed Gossip Consensus (Phase 12)
    requires_consensus = Column(Integer, default=0) # 0 for False, 1 for True
    min_votes = Column(Integer, default=1)
    results_votes = Column(JSON, nullable=True) # Dict of {node_id: result}
    consensus_status = Column(String, default="none") # none, pending, achieved, conflict
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class MessageEntry(Base):
    __tablename__ = "messages"
    
    id = Column(String, primary_key=True, index=True)
    sender_id = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String, default="chat")
    received_at = Column(DateTime, default=datetime.utcnow)

class PeerEntry(Base):
    __tablename__ = "peers"
    
    id = Column(String, primary_key=True, index=True)
    address = Column(String, nullable=False) # e.g. "http://localhost:3201"
    status = Column(String, default="active")
    last_seen = Column(DateTime, default=datetime.utcnow)
    capabilities = Column(JSON, nullable=True)

# Pydantic Models for API validation and serialization
class LedgerTask(BaseModel):
    id: str
    task_type: str
    description: str
    context: Optional[Dict[str, Any]] = None
    status: str
    priority: int
    assigned_to: str
    assigned_by: Optional[str] = None
    claimed_by: Optional[str] = None
    claim_timestamp: Optional[datetime] = None
    parent_id: Optional[str] = None
    depends_on: Optional[List[str]] = None
    subtask_count: int = 0
    result: Optional[Dict[str, Any]] = None
    execution_metadata: Optional[Dict[str, Any]] = None
    bid_metadata: Optional[Dict[str, Any]] = None
    
    # Governance & HITL
    requires_approval: bool = False
    approval_status: str = "none"
    retry_count: int = 0
    max_retries: int = 3
    
    # Distributed Gossip Consensus
    requires_consensus: bool = False
    min_votes: int = 1
    results_votes: Optional[Dict[str, Any]] = None
    consensus_status: str = "none"
    
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class LedgerMessage(BaseModel):
    id: str
    sender_id: str
    content: str
    message_type: str
    received_at: datetime

    class Config:
        from_attributes = True

class LedgerPeer(BaseModel):
    id: str
    address: str
    status: str
    last_seen: datetime
    capabilities: Optional[Dict[str, Any]] = None
    strategies: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

