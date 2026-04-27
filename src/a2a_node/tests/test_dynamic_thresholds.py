import pytest
from app.core.heuristics import BiddingHeuristics
from app.core.performance import PerformanceMonitor
from app.models.ledger import PerformanceSnapshot
from app.core.database import AsyncSessionLocal
from unittest.mock import patch

@pytest.mark.asyncio
async def test_dynamic_bidding_thresholds():
    # Cleanup
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(PerformanceSnapshot).where(PerformanceSnapshot.node_id == "global"))
        await db.commit()

    # 1. Healthy Swarm (100% success)
    async with AsyncSessionLocal() as db:
        for _ in range(5):
            snapshot = PerformanceSnapshot(
                node_id="global",
                metrics={"success_rate": 100.0}
            )
            db.add(snapshot)
        await db.commit()
    
    # Threshold should be 0.6
    eval_healthy = await BiddingHeuristics.evaluate_task("test", "test description")
    assert eval_healthy["min_confidence"] == pytest.approx(0.6)

    # 2. Struggling Swarm (70% success)
    # Clear previous snapshots first to isolate
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(PerformanceSnapshot).where(PerformanceSnapshot.node_id == "global"))
        await db.commit()

    async with AsyncSessionLocal() as db:
        for _ in range(5):
            snapshot = PerformanceSnapshot(
                node_id="global",
                metrics={"success_rate": 70.0}
            )
            db.add(snapshot)
        await db.commit()
    
    # Threshold should be 0.7 (0.6 + 0.1)
    eval_struggling = await BiddingHeuristics.evaluate_task("test", "test description")
    assert eval_struggling["min_confidence"] == pytest.approx(0.7)

    # 3. Critical Swarm (40% success)
    # Clear previous snapshots first to isolate
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(PerformanceSnapshot).where(PerformanceSnapshot.node_id == "global"))
        await db.commit()

    async with AsyncSessionLocal() as db:
        for _ in range(5):
            snapshot = PerformanceSnapshot(
                node_id="global",
                metrics={"success_rate": 40.0}
            )
            db.add(snapshot)
        await db.commit()
    
    # Threshold should be 0.9 (0.6 + 0.1 + 0.2)
    eval_critical = await BiddingHeuristics.evaluate_task("test", "test description")
    assert eval_critical["min_confidence"] == pytest.approx(0.9)

@pytest.mark.asyncio
async def test_reputation_aware_yield():
    from app.models.ledger import PeerEntry
    
    # Setup peers
    node_good = "peer-good-unique"
    node_bad = "peer-bad-unique"
    
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(PeerEntry).where(PeerEntry.id.in_([node_good, node_bad])))
        await db.commit()

    async with AsyncSessionLocal() as db:
        # Good Peer
        p1 = PeerEntry(
            id=node_good,
            address="http://localhost:1",
            performance={"reputation_score": 1.0},
            strategies={"skills": ["test"], "min_confidence": 0.5, "current_load": 0}
        )
        # Bad Peer (low reputation)
        p2 = PeerEntry(
            id=node_bad,
            address="http://localhost:2",
            performance={"reputation_score": 0.2},
            strategies={"skills": ["test"], "min_confidence": 0.5, "current_load": 0}
        )
        db.add(p1)
        db.add(p2)
        await db.commit()

    # Re-fetch from DB to ensure they are attached to a session if needed, 
    # but evaluate_with_swarm_intelligence takes a list of objects.
    peers = [p1, p2]
    
    # Evaluate with swarm intelligence
    # We should yield to p1 (good) but NOT to p2 (bad reputation)
    # even if p2 has matching skills.
    
    eval_result = await BiddingHeuristics.evaluate_with_swarm_intelligence("test", "test task", peers)
    
    # If we yield, it should be to node_good
    if "yielded_to" in eval_result:
        assert eval_result["yielded_to"] == node_good
    
    # Verify we never yield to node_bad
    assert eval_result.get("yielded_to") != node_bad
