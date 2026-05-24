import pytest
from app.api.a2a import place_bid, BidRequest
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
import uuid
from datetime import datetime, UTC

@pytest.mark.asyncio
async def test_a2a_post_bid_success_fixed_v3():
    task_id = "t-" + str(uuid.uuid4())[:8]
    async with AsyncSessionLocal() as db:
        t = TaskEntry(id=task_id, task_type="test", description="d", status="pending")
        db.add(t)
        await db.commit()
        
        bid_data = BidRequest(
            task_id=task_id,
            bidder_id="node-1",
            bid_value=10.0,
            confidence=0.9,
            bidder_skills=["research"],
            metadata={"test": 1}
        )
        
        result = await place_bid(bid=bid_data, db=db)
        assert result["status"] == "bid_accepted"
        
        await db.refresh(t)
        assert "node-1" in t.bid_metadata["bids"]
        assert t.bid_metadata["bids"]["node-1"]["bid_value"] == 10.0
