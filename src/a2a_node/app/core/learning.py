import logging
from datetime import datetime
from sqlalchemy import select
from app.models.ledger import PeerEntry, LocalState
from app.core.database import AsyncSessionLocal
from app.core.config import settings

logger = logging.getLogger("a2a_learning")

class LearningEngine:
    """
    Dynamic reinforcement learning engine for agent skills evolution.
    Adjusts skill weights based on task performance and handles new skill discovery.
    """

    # Evolution constants
    WEIGHT_INCREMENT = 0.05
    WEIGHT_DECREMENT_FAILURE = 0.1
    WEIGHT_DECREMENT_STALL = 0.15
    MAX_WEIGHT = 2.0
    MIN_WEIGHT = 0.1
    BASE_WEIGHT = 1.0

    @classmethod
    async def get_local_skills(cls) -> dict:
        """
        Retrieves the local node's skill matrix from the LocalState table.
        Initializes from settings if not present.
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(LocalState).filter(LocalState.key == "skills_matrix"))
            state = result.scalars().first()
            
            if state:
                return state.value
            
            # Initial setup from static settings
            initial_skills = [s.strip() for s in settings.MEDUSA_SKILLS.split(',') if s.strip()]
            skills_matrix = {skill: cls.BASE_WEIGHT for skill in initial_skills}
            
            new_state = LocalState(key="skills_matrix", value=skills_matrix)
            db.add(new_state)
            await db.commit()
            
            return skills_matrix

    @classmethod
    async def update_skill(cls, task_type: str, event_type: str):
        """
        Updates the local skill matrix based on an event.
        Event types: 'completed', 'failed', 'stalled'
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(LocalState).filter(LocalState.key == "skills_matrix"))
            state = result.scalars().first()
            
            if not state:
                # Should have been initialized by get_local_skills, but safety first
                skills_matrix = await cls.get_local_skills()
                result = await db.execute(select(LocalState).filter(LocalState.key == "skills_matrix"))
                state = result.scalars().first()
            else:
                skills_matrix = state.value

            # 1. Acquisition/Discovery
            if task_type not in skills_matrix:
                if event_type == "completed":
                    print(f"🎓 Skill Discovery: Node learned new skill '{task_type}'", flush=True)
                    skills_matrix[task_type] = cls.BASE_WEIGHT + cls.WEIGHT_INCREMENT
                else:
                    # Don't learn skills from failures yet
                    return

            # 2. Evolution
            old_weight = skills_matrix[task_type]
            if event_type == "completed":
                skills_matrix[task_type] = min(cls.MAX_WEIGHT, old_weight + cls.WEIGHT_INCREMENT)
            elif event_type == "failed":
                skills_matrix[task_type] = max(cls.MIN_WEIGHT, old_weight - cls.WEIGHT_DECREMENT_FAILURE)
            elif event_type == "stalled":
                skills_matrix[task_type] = max(cls.MIN_WEIGHT, old_weight - cls.WEIGHT_DECREMENT_STALL)

            new_weight = skills_matrix[task_type]
            if old_weight != new_weight:
                state.value = skills_matrix
                # Mark as modified for SQLAlchemy
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(state, "value")
                await db.commit()
                print(f"📈 Skill Evolution: '{task_type}' weight adjusted {old_weight:.2f} -> {new_weight:.2f}", flush=True)

    @classmethod
    async def sync_to_peer_entry(cls, node_id: str):
        """
        Syncs the local skills matrix to the PeerEntry table for gossip sharing.
        """
        skills = await cls.get_local_skills()
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
            peer = result.scalars().first()
            if peer:
                peer.skills_matrix = skills
                await db.commit()
