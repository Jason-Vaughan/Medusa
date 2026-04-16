from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy import select, and_, or_
from app.core.database import AsyncSessionLocal
from app.models.ledger import PeerEntry, TaskEntry
from app.core.config import settings

class PerformanceMonitor:
    """
    Tracks and persists performance metrics for the local node.
    """
    
    @staticmethod
    def get_local_node_id() -> str:
        return f"{settings.PROJECT_NAME}-{settings.PORT}"

    @classmethod
    async def get_current_load(cls) -> Dict[str, Any]:
        """
        Calculates the current load of the local node based on active tasks.
        """
        node_id = cls.get_local_node_id()
        async with AsyncSessionLocal() as db:
            # Count running tasks
            running_result = await db.execute(
                select(TaskEntry).filter(TaskEntry.status == "running")
            )
            running_count = len(running_result.scalars().all())
            
            # Count pending tasks assigned to this node
            pending_result = await db.execute(
                select(TaskEntry).filter(
                    and_(
                        TaskEntry.status == "pending",
                        or_(TaskEntry.assigned_to == "local", TaskEntry.assigned_to == node_id)
                    )
                )
            )
            pending_count = len(pending_result.scalars().all())
            
            return {
                "running_tasks": running_count,
                "pending_tasks": pending_count,
                "total_load": running_count + pending_count
            }

    @classmethod
    async def get_local_performance(cls) -> Dict[str, Any]:
        """
        Retrieves local performance metrics from the database.
        """
        node_id = cls.get_local_node_id()
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            peer = result.scalars().first()
            
            if peer and peer.performance:
                return peer.performance
            
            # Default empty metrics
            return {
                "total_tasks": 0,
                "success_count": 0,
                "failure_count": 0,
                "total_latency": 0.0,
                "task_types": {},
                "last_updated": datetime.utcnow().isoformat()
            }

    @classmethod
    async def record_execution(cls, task_type: str, success: bool, latency: float):
        """
        Records a task execution and updates local metrics.
        """
        node_id = cls.get_local_node_id()
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            peer = result.scalars().first()
            
            if not peer:
                # Create local peer entry if it doesn't exist
                peer = PeerEntry(
                    id=node_id,
                    address=f"http://localhost:{settings.PORT}",
                    status="active",
                    performance={}
                )
                db.add(peer)
            
            perf = peer.performance or {
                "total_tasks": 0,
                "success_count": 0,
                "failure_count": 0,
                "total_latency": 0.0,
                "task_types": {},
            }
            
            # Global updates
            perf["total_tasks"] = perf.get("total_tasks", 0) + 1
            if success:
                perf["success_count"] = perf.get("success_count", 0) + 1
            else:
                perf["failure_count"] = perf.get("failure_count", 0) + 1
            
            perf["total_latency"] = perf.get("total_latency", 0.0) + latency
            perf["last_updated"] = datetime.utcnow().isoformat()
            
            # Task-type specific updates
            tt = perf.get("task_types", {})
            if task_type not in tt:
                tt[task_type] = {"count": 0, "success": 0, "latency": 0.0}
            
            tt[task_type]["count"] += 1
            if success:
                tt[task_type]["success"] += 1
            tt[task_type]["latency"] += latency
            
            perf["task_types"] = tt
            peer.performance = perf
            
            # SQLAlchemy needs to know the JSON field changed
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(peer, "performance")
            
            await db.commit()
            # print(f"📊 Performance recorded for {task_type}: {'Success' if success else 'Failure'} in {latency:.2f}s", flush=True)
