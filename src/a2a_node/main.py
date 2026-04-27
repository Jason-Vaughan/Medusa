from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.api import a2a, gossip, discovery, learnings
from app.core.config import settings
from app.core.tangleclaw import register_port
from app.core.database import init_db
from app.core.execution import run_execution_engine
from app.core.swarm import run_swarm_intelligence, run_task_janitor
from app.core.performance import run_performance_monitor
from app.core.supervisor import supervisor
import uvicorn
import os
import asyncio

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION)

# Include A2A API routes
app.include_router(a2a.router, prefix="/a2a", tags=["A2A"])
app.include_router(gossip.router, prefix="/a2a/gossip", tags=["Gossip"])
app.include_router(learnings.router, prefix="/a2a/learnings", tags=["Learnings"])
app.include_router(discovery.router, prefix="/.well-known", tags=["Discovery"])

@app.on_event("startup")
async def startup_event():
    await init_db()
    register_port()
    print(f"✅ Node {settings.PROJECT_NAME} on port {settings.PORT} is operational.", flush=True)
    
    # Register background tasks with supervisor
    supervisor.register_task("Gossip-Sync", gossip.run_gossip)
    supervisor.register_task("Execution-Engine", run_execution_engine)
    supervisor.register_task("Swarm-Intelligence", run_swarm_intelligence)
    supervisor.register_task("Performance-Monitor", run_performance_monitor)
    supervisor.register_task("Task-Janitor", run_task_janitor)
    
    # Start all supervised tasks
    await supervisor.start_all()

@app.on_event("shutdown")
async def shutdown_event():
    supervisor.stop_all()

@app.get("/")
async def root():
    """
    Root endpoint to verify the node's operational status and sass level.
    """
    return {"status": "operational", "message": "Medusa A2A Node is watching.", "sass_level": "savage"}

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=False)
