from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings
from alembic.config import Config
from alembic import command
import os

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

def run_migrations():
    """
    Runs Alembic migrations to the latest version.
    """
    try:
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        alembic_cfg = Config(os.path.join(base_dir, "alembic.ini"))
        # Force the DB URL from settings (strip +aiosqlite for synchronous alembic)
        sync_db_url = settings.DATABASE_URL.replace("+aiosqlite", "")
        alembic_cfg.set_main_option("sqlalchemy.url", sync_db_url)
        command.upgrade(alembic_cfg, "head")
        print("✅ Database migrations completed successfully.")
    except Exception as e:
        print(f"❌ Migration error: {e}", flush=True)

async def init_db():
    # We now prefer migrations, but we can fallback or run them here
    run_migrations()
