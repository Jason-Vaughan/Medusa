import logging
from datetime import datetime
from sqlalchemy import select
from app.models.ledger import PeerEntry
from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.core.learning import LearningEngine

logger = logging.getLogger("a2a_reputation")

class ReputationEngine:
    """
    Core engine for tracking and calculating node reputation within the swarm.
    Reputation scores influence bidding decisions and strategic yielding.
    """

    @staticmethod
    async def update_reputation(node_id: str, event_type: str, metadata: dict = None):
        """
        Updates the reputation of a node based on an event.
        Also triggers local skill evolution (Chunk 27) if the node is local.
        Event types: 'completed', 'failed', 'stalled', 'consensus_disagreement'
        """
        # Local Node Skill Evolution (Chunk 27)
        local_node_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
        if node_id == local_node_id and metadata and "task_type" in metadata:
            await LearningEngine.update_skill(metadata["task_type"], event_type)
            await LearningEngine.sync_to_peer_entry(node_id)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            peer = result.scalars().first()
            if not peer:
                # If peer is unknown, we can't update reputation yet.
                # In the future, we might create a placeholder.
                return

            perf = peer.performance or {}
            
            # Ensure basic metrics exist
            perf.setdefault("tasks_completed", 0)
            perf.setdefault("tasks_failed", 0)
            perf.setdefault("tasks_stalled", 0)
            perf.setdefault("total_latency", 0.0)
            perf.setdefault("reputation_score", 1.0) # Start with perfect reputation

            if event_type == "completed":
                perf["tasks_completed"] += 1
                latency = metadata.get("latency", 0.0) if metadata else 0.0
                perf["total_latency"] += latency
                # Boost score
                perf["reputation_score"] = min(1.0, perf["reputation_score"] + settings.REPUTATION_WEIGHT_COMPLETED)
            
            elif event_type == "failed":
                perf["tasks_failed"] += 1
                # Penalize score
                perf["reputation_score"] = max(0.0, perf["reputation_score"] - settings.REPUTATION_PENALTY_FAILED)

            elif event_type == "retried":
                # Minor penalty for retries (Chunk 28)
                perf.setdefault("tasks_retried", 0)
                perf["tasks_retried"] += 1
                perf["reputation_score"] = max(0.0, perf["reputation_score"] - 0.02)

            elif event_type == "stalled":

                perf["tasks_stalled"] += 1
                # Heavy penalty for stalling
                perf["reputation_score"] = max(0.0, perf["reputation_score"] - settings.REPUTATION_PENALTY_STALLED)
            
            elif event_type == "consensus_disagreement":
                perf.setdefault("consensus_disagreements", 0)
                perf["consensus_disagreements"] += 1
                perf["reputation_score"] = max(0.0, perf["reputation_score"] - 0.1)

            peer.performance = perf
            # SQLAlchemy needs to know the JSON field changed
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(peer, "performance")
            
            await db.commit()
            logger.info(f"⭐️ Reputation updated for {node_id}: {perf['reputation_score']:.2f} (Event: {event_type})")

    @staticmethod
    async def get_reputation_score(node_id: str) -> float:
        """
        Retrieves the current reputation score for a node.
        Defaults to 1.0 if the node is unknown or has no metrics.
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            peer = result.scalars().first()
            if not peer or not peer.performance:
                return 1.0
            return peer.performance.get("reputation_score", 1.0)
