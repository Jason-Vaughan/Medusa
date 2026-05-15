from datetime import datetime, UTC, timedelta
from sqlalchemy import delete
from app.core.database import AsyncSessionLocal
from app.models.ledger import MessageEntry
from app.core.config import settings

class MessageManager:
    """
    Handles domain logic for A2A messages, including hygiene and pruning.
    """
    
    @classmethod
    async def prune_messages(cls, retention_days: int = None, dry_run: bool = False, limit: int = 1000) -> int:
        """
        Prunes old messages from the ledger to prevent database bloat.
        
        Args:
            retention_days: Number of days to keep messages. Defaults to settings.RETENTION_DAYS_ROUTINE.
            dry_run: If True, returns the count of rows that WOULD be deleted without deleting them.
            limit: Maximum number of rows to prune in a single pass.
            
        Returns:
            Number of rows pruned (or to be pruned if dry_run).
        """
        if retention_days is None:
            retention_days = settings.RETENTION_DAYS_ROUTINE
            
        threshold = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=retention_days)
        
        async with AsyncSessionLocal() as db:
            try:
                # 1. Identify rows to prune (respecting limit)
                from sqlalchemy import select
                stmt = select(MessageEntry.id).filter(MessageEntry.received_at < threshold).limit(limit)
                result = await db.execute(stmt)
                ids_to_prune = [r[0] for r in result.all()]
                
                if not ids_to_prune:
                    return 0
                
                if not dry_run:
                    # 2. Hard delete
                    delete_stmt = delete(MessageEntry).where(MessageEntry.id.in_(ids_to_prune))
                    await db.execute(delete_stmt)
                    await db.commit()
                    print(f"🧹 MessageManager: Pruned {len(ids_to_prune)} messages (Threshold: {threshold}).", flush=True)
                else:
                    print(f"🔍 MessageManager [DRY-RUN]: Would prune {len(ids_to_prune)} messages.", flush=True)
                
                return len(ids_to_prune)
            except Exception as e:
                print(f"❌ Error pruning messages: {e}", flush=True)
                await db.rollback()
                return 0
