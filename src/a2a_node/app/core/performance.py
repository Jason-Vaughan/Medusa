from typing import Dict, Any, Optional, List
from datetime import datetime, UTC, timedelta
from sqlalchemy import select, and_, or_, func, delete
from app.core.database import AsyncSessionLocal
from app.models.ledger import PeerEntry, TaskEntry, PerformanceSnapshot
from app.core.config import settings
import asyncio
import httpx
from app.core.auth_utils import get_auth_headers

_load_breach_start: Optional[datetime] = None

class PerformanceMonitor:
    """
    Tracks and persists performance metrics for the local node.
    """
    
    @staticmethod
    def get_local_node_id() -> str:
        return f"{settings.PROJECT_NAME}-{settings.PORT}"

    @classmethod
    async def get_resource_health(cls) -> Dict[str, Any]:
        """
        Gathers real-time resource health metrics (CPU, Memory).
        """
        now_naive = datetime.now(UTC).replace(tzinfo=None)
        health = {
            "cpu_percent": 0.0,
            "memory_percent": 0.0,
            "load_avg": [0.0, 0.0, 0.0],
            "timestamp": now_naive.isoformat()
        }
        try:
            import psutil
            import os
            health["cpu_percent"] = psutil.cpu_percent(interval=None)
            health["memory_percent"] = psutil.virtual_memory().percent
            if hasattr(os, "getloadavg"):
                health["load_avg"] = list(os.getloadavg())
        except ImportError:
            import os
            if hasattr(os, "getloadavg"):
                health["load_avg"] = list(os.getloadavg())
        except Exception:
            pass
        return health

    @classmethod
    async def get_current_load(cls) -> Dict[str, Any]:
        """
        Calculates the current load of the local node based on active tasks.
        """
        node_id = cls.get_local_node_id()
        async with AsyncSessionLocal() as db:
            running_result = await db.execute(
                select(TaskEntry).filter(TaskEntry.status == "running")
            )
            running_count = len(running_result.scalars().all())
            
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
            
            return {
                "total_tasks": 0,
                "success_count": 0,
                "failure_count": 0,
                "total_latency": 0.0,
                "task_types": {},
                "last_updated": datetime.now(UTC).replace(tzinfo=None).isoformat()
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
            
            perf["total_tasks"] = perf.get("total_tasks", 0) + 1
            if success:
                perf["success_count"] = perf.get("success_count", 0) + 1
            else:
                perf["failure_count"] = perf.get("failure_count", 0) + 1
            
            perf["total_latency"] = perf.get("total_latency", 0.0) + latency
            perf["last_updated"] = datetime.now(UTC).replace(tzinfo=None).isoformat()
            
            tt = perf.get("task_types", {})
            if task_type not in tt:
                tt[task_type] = {"count": 0, "success": 0, "latency": 0.0}
            
            tt[task_type]["count"] += 1
            if success:
                tt[task_type]["success"] += 1
            tt[task_type]["latency"] += latency
            
            perf["task_types"] = tt
            peer.performance = perf
            
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(peer, "performance")
            
            await db.commit()

    @classmethod
    async def record_snapshot(cls):
        """
        Creates a point-in-time snapshot of performance for the node and mesh.
        """
        node_id = cls.get_local_node_id()
        async with AsyncSessionLocal() as db:
            health = await cls.get_resource_health()
            peer_result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            local_peer = peer_result.scalars().first()
            if local_peer:
                local_peer.health_metadata = health
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(local_peer, "health_metadata")

            result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            peer = result.scalars().first()
            
            if peer and peer.performance:
                perf = peer.performance
                total = perf.get("total_tasks", 0)
                success_rate = (perf.get("success_count", 0) / max(total, 1)) * 100 if total > 0 else 100.0
                avg_latency = perf.get("total_latency", 0) / max(total, 1)
                
                snapshot = PerformanceSnapshot(
                    node_id=node_id,
                    metrics={
                        "total_tasks": total,
                        "success_rate": success_rate,
                        "avg_latency": avg_latency,
                        "load": (await cls.get_current_load()).get("total_load", 0)
                    }
                )
                db.add(snapshot)
            
            peers_result = await db.execute(select(PeerEntry))
            all_peers = peers_result.scalars().all()
            
            total_tasks = 0
            total_success = 0
            total_latency = 0
            active_nodes = 0
            
            for p in all_peers:
                if p.status == "active":
                    active_nodes += 1
                if p.performance:
                    total_tasks += p.performance.get("total_tasks", 0)
                    total_success += p.performance.get("success_count", 0)
                    total_latency += p.performance.get("total_latency", 0)
            
            global_success_rate = (total_success / max(total_tasks, 1)) * 100 if total_tasks > 0 else 100.0
            global_avg_latency = total_latency / max(total_tasks, 1)
            
            global_snapshot = PerformanceSnapshot(
                node_id="global",
                metrics={
                    "active_nodes": active_nodes,
                    "total_tasks": total_tasks,
                    "success_rate": global_success_rate,
                    "avg_latency": global_avg_latency
                }
            )
            db.add(global_snapshot)
            
            await db.commit()

    @classmethod
    async def get_swarm_health(cls) -> float:
        """
        Returns a swarm health index (0.0 to 1.0) based on recent global success rates.
        """
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(PerformanceSnapshot)
                    .filter(PerformanceSnapshot.node_id == "global")
                    .order_by(PerformanceSnapshot.timestamp.desc())
                    .limit(5)
                )
                snapshots = result.scalars().all()
                if not snapshots:
                    return 1.0
                
                avg_success = sum(s.metrics.get("success_rate", 100.0) for s in snapshots) / len(snapshots)
                return avg_success / 100.0
            except Exception:
                return 1.0

    @classmethod
    async def prune_snapshots(cls):
        """
        Prunes performance snapshots older than RETENTION_DAYS.
        """
        threshold = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=settings.RETENTION_DAYS)
        async with AsyncSessionLocal() as db:
            try:
                stmt = delete(PerformanceSnapshot).where(PerformanceSnapshot.timestamp < threshold)
                result = await db.execute(stmt)
                await db.commit()
            except Exception as e:
                print(f"❌ Error pruning snapshots: {e}", flush=True)

    @classmethod
    async def get_history(cls, node_id: str = "global", limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves historical performance snapshots.
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(PerformanceSnapshot)
                .filter(PerformanceSnapshot.node_id == node_id)
                .order_by(PerformanceSnapshot.timestamp.desc())
                .limit(limit)
            )
            snapshots = result.scalars().all()
            return [
                {
                    "timestamp": s.timestamp.isoformat(),
                    "metrics": s.metrics
                }
                for s in reversed(snapshots)
            ]

    @classmethod
    async def check_for_expansion_need(cls):
        """
        Checks if sustained high load requires mesh expansion.
        """
        global _load_breach_start
        
        load_info = await cls.get_current_load()
        pending = load_info.get("pending_tasks", 0)
        
        if pending > settings.LOAD_THRESHOLD:
            now = datetime.now(UTC)
            if _load_breach_start is None:
                _load_breach_start = now
                print(f"📈 Load threshold breached ({pending} pending). Starting expansion window...", flush=True)
            else:
                duration = (now - _load_breach_start).total_seconds()
                if duration >= settings.EXPANSION_WINDOW:
                    print(f"🔥 Sustained load detected ({duration:.1f}s). Requesting mesh expansion!", flush=True)
                    _load_breach_start = None # Reset after trigger
                    await cls.request_mesh_expansion()
        else:
            if _load_breach_start is not None:
                print("📉 Load normalized. Resetting expansion window.", flush=True)
                _load_breach_start = None

    @classmethod
    async def request_mesh_expansion(cls):
        """
        Sends an authenticated request to Medusa Server to spawn a new node.
        """
        endpoint = "/mesh/expand"
        url = f"{settings.MEDUSA_SERVER_URL}{endpoint}"
        headers = get_auth_headers(endpoint)
        
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(url, headers=headers, timeout=10.0)
                if r.status_code in [200, 202]:
                    print(f"✅ Mesh expansion requested successfully: {r.json()}", flush=True)
                else:
                    print(f"⚠️ Mesh expansion request rejected: {r.status_code} - {r.text}", flush=True)
        except Exception as e:
            print(f"❌ Failed to connect to Medusa Server for expansion: {e}", flush=True)

async def run_performance_monitor():
    """
    Background loop to periodically record performance snapshots.
    """
    print("📊 Performance Monitoring loop started.", flush=True)
    last_prune = datetime.now(UTC).replace(tzinfo=None)
    
    while True:
        try:
            await PerformanceMonitor.record_snapshot()
            await PerformanceMonitor.check_for_expansion_need()
            
            now_naive = datetime.now(UTC).replace(tzinfo=None)
            if now_naive - last_prune > timedelta(hours=1):
                await PerformanceMonitor.prune_snapshots()
                last_prune = now_naive
                
        except Exception as e:
            print(f"❌ Error recording performance snapshot: {e}", flush=True)
        
        await asyncio.sleep(60)
