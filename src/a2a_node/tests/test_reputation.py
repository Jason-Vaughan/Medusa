import pytest
from app.core.reputation import ReputationEngine
from app.models.ledger import PeerEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from app.core.config import settings

@pytest.mark.asyncio
async def test_reputation_updates():
    node_id = "test-node-reputation-unique"
    
    # Cleanup before
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(PeerEntry).where(PeerEntry.id == node_id))
        await db.commit()
    
    # 1. Setup peer
    async with AsyncSessionLocal() as db:
        peer = PeerEntry(
            id=node_id,
            address="http://localhost:9999",
            status="active",
            performance={}
        )
        db.add(peer)
        await db.commit()

    # 2. Initial reputation
    score = await ReputationEngine.get_reputation_score(node_id)
    assert score == 1.0

    # 3. Test completion boost
    # Reset to 0.5 first to see the boost
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PeerEntry).filter(PeerEntry.id == node_id))
        peer = result.scalars().first()
        peer.performance = {"reputation_score": 0.5}
        await db.commit()

    await ReputationEngine.update_reputation(node_id, "completed")
    score = await ReputationEngine.get_reputation_score(node_id)
    assert score == pytest.approx(0.5 + settings.REPUTATION_WEIGHT_COMPLETED)

    # 4. Test failure penalty
    await ReputationEngine.update_reputation(node_id, "failed")
    new_score = await ReputationEngine.get_reputation_score(node_id)
    assert new_score == pytest.approx(score - settings.REPUTATION_PENALTY_FAILED)

    # 5. Test stall penalty
    await ReputationEngine.update_reputation(node_id, "stalled")
    final_score = await ReputationEngine.get_reputation_score(node_id)
    # Floor is 0.0
    assert final_score == pytest.approx(max(0.0, new_score - settings.REPUTATION_PENALTY_STALLED))

@pytest.mark.asyncio
async def test_consensus_disagreement_penalty():
    node_id = "test-node-consensus-unique"
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(PeerEntry).where(PeerEntry.id == node_id))
        await db.commit()

    async with AsyncSessionLocal() as db:
        peer = PeerEntry(
            id=node_id,
            address="http://localhost:9998",
            status="active",
            performance={"reputation_score": 1.0}
        )
        db.add(peer)
        await db.commit()

    await ReputationEngine.update_reputation(node_id, "consensus_disagreement")
    score = await ReputationEngine.get_reputation_score(node_id)
    assert score == pytest.approx(0.9)
