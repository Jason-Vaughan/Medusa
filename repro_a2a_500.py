
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
import os
import sys

# Add src/a2a_node to path
sys.path.append(os.path.join(os.getcwd(), 'src', 'a2a_node'))

from app.models.ledger import TaskEntry, MessageEntry, PeerEntry, LedgerTask, LedgerMessage, LedgerPeer
from app.core.config import settings
from datetime import datetime
import json

async def test_sync():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with AsyncSessionLocal() as db:
        since = datetime(1970, 1, 1)
        
        print(f"Testing TaskEntry select since {since}...")
        try:
            tasks_result = await db.execute(select(TaskEntry).filter(TaskEntry.updated_at > since))
            tasks = tasks_result.scalars().all()
            print(f"✅ Tasks count: {len(tasks)}")
            for i, t in enumerate(tasks):
                # print(f"  Validating Task {i+1}/{len(tasks)} (ID: {t.id})")
                try:
                    LedgerTask.model_validate(t)
                except Exception as ve:
                    print(f"    ❌ Validation failed for Task {t.id}: {ve}")
                    # Print raw data to see what's wrong
                    data = {c.name: getattr(t, c.name) for c in t.__table__.columns}
                    print(f"    Raw data: {json.dumps(data, default=str)}")
            print("✅ LedgerTask validation phase complete")
        except Exception as e:
            print(f"❌ Tasks global error: {e}")

        print(f"\nTesting MessageEntry select since {since}...")
        try:
            messages_result = await db.execute(select(MessageEntry).filter(MessageEntry.received_at > since))
            messages = messages_result.scalars().all()
            print(f"✅ Messages count: {len(messages)}")
            for m in messages:
                try:
                    LedgerMessage.model_validate(m)
                except Exception as ve:
                    print(f"    ❌ Validation failed for Message {m.id}: {ve}")
            print("✅ LedgerMessage validation phase complete")
        except Exception as e:
            print(f"❌ Messages global error: {e}")

        print(f"\nTesting PeerEntry select since {since}...")
        try:
            peers_result = await db.execute(select(PeerEntry).filter(PeerEntry.last_seen > since))
            peers = peers_result.scalars().all()
            print(f"✅ Peers count: {len(peers)}")
            for p in peers:
                try:
                    LedgerPeer.model_validate(p)
                except Exception as ve:
                    print(f"    ❌ Validation failed for Peer {p.id}: {ve}")
                    # Print raw data
                    data = {c.name: getattr(p, c.name) for c in p.__table__.columns}
                    print(f"    Raw data: {json.dumps(data, default=str)}")
            print("✅ LedgerPeer validation phase complete")
        except Exception as e:
            print(f"❌ Peers global error: {e}")

if __name__ == "__main__":
    asyncio.run(test_sync())
