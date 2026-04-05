import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from app.core.governance import GovernanceEngine
from app.core.execution import TaskExecutor
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal, init_db
from app.core.config import settings
from sqlalchemy import select
import uuid

@pytest.mark.asyncio
async def test_api_create_task_approval():
    """
    Verifies that creating a risky task via API sets it to pending_approval.
    """
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = {"X-Medusa-Secret": settings.A2A_SECRET}
        payload = {
            "task_type": "shell",
            "description": "rm -rf /",
            "priority": 10
        }
        response = await ac.post("/a2a/tasks", json=payload, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "pending_approval"
        assert "requires human approval" in data["message"]
        
        # Verify in DB
        task_id = data["task_id"]
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
            task = res.scalars().first()
            assert task.status == "pending_approval"
            assert task.requires_approval == 1

@pytest.mark.asyncio
async def test_api_approval_flow():
    """
    Verifies the full HITL flow: create -> pending_approval -> approve -> pending.
    """
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = {"X-Medusa-Secret": settings.A2A_SECRET}
        
        # 1. Create
        payload = {"task_type": "shell", "description": "ls"}
        response = await ac.post("/a2a/tasks", json=payload, headers=headers)
        task_id = response.json()["task_id"]
        
        # 2. Approve
        response = await ac.post(f"/a2a/tasks/{task_id}/approve", headers=headers)
        assert response.status_code == 200
        assert response.json()["status"] == "approved"
        
        # 3. Verify status in DB
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
            task = res.scalars().first()
            assert task.status == "pending"
            assert task.approval_status == "approved"

@pytest.mark.asyncio
async def test_api_rejection_flow():
    """
    Verifies task rejection via API.
    """
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = {"X-Medusa-Secret": settings.A2A_SECRET}
        
        # 1. Create
        payload = {"task_type": "shell", "description": "format c:"}
        response = await ac.post("/a2a/tasks", json=payload, headers=headers)
        task_id = response.json()["task_id"]
        
        # 2. Reject
        response = await ac.post(f"/a2a/tasks/{task_id}/reject", headers=headers)
        assert response.status_code == 200
        assert response.json()["status"] == "rejected"
        
        # 3. Verify status in DB
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
            task = res.scalars().first()
            assert task.status == "rejected"
            assert task.approval_status == "rejected"

@pytest.mark.asyncio
async def test_governance_evaluation():
    """
    Verifies that the GovernanceEngine correctly flags risky tasks.
    """
    # Safe task
    safe_eval = GovernanceEngine.evaluate_task("other", "tell me a joke")
    assert safe_eval["requires_approval"] is False
    
    # Risky shell task
    shell_eval = GovernanceEngine.evaluate_task("shell", "ls -la")
    assert shell_eval["requires_approval"] is True
    assert "shell" in shell_eval["reason"].lower()
    
    # Risky keyword task
    rm_eval = GovernanceEngine.evaluate_task("other", "please rm -rf /")
    assert rm_eval["requires_approval"] is True
    assert "rm " in rm_eval["reason"]

@pytest.mark.asyncio
async def test_task_retry_logic():
    """
    Verifies that the retry count increments and tasks are put back to pending.
    """
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        new_task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="nonexistent_command_12345",
            status="running",
            retry_count=0,
            max_retries=3
        )
        db.add(new_task)
        await db.commit()
        
        # We need to simulate the execution engine's logic here since run_execution_engine is a loop
        # 1. Execute
        result = await TaskExecutor.execute(new_task)
        assert result["outcome"] == "failed"
        
        # 2. Check retry logic (normally inside run_execution_engine)
        if result.get("outcome") == "failed" and new_task.retry_count < new_task.max_retries:
            new_task.retry_count += 1
            new_task.status = "pending"
            
            if not new_task.execution_metadata:
                new_task.execution_metadata = {}
            retries = new_task.execution_metadata.get("retries", [])
            retries.append({"retry": new_task.retry_count, "error": result.get("error")})
            new_task.execution_metadata["retries"] = retries
            
        await db.commit()
        
        # Verify status
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
        updated_task = result.scalars().first()
        assert updated_task.status == "pending"
        assert updated_task.retry_count == 1
        assert len(updated_task.execution_metadata["retries"]) == 1

@pytest.mark.asyncio
async def test_max_retries_exceeded():
    """
    Verifies that a task stays 'failed' after max retries.
    """
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        new_task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="fail_me",
            status="running",
            retry_count=3, # Already at max
            max_retries=3
        )
        db.add(new_task)
        await db.commit()
        
        # Execute
        result = await TaskExecutor.execute(new_task)
        
        # Check logic
        if result.get("outcome") == "failed" and new_task.retry_count < new_task.max_retries:
            new_task.retry_count += 1
            new_task.status = "pending"
        else:
            new_task.status = "failed"
            new_task.result = result
            
        await db.commit()
        
        # Verify
        result = await db.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
        updated_task = result.scalars().first()
        assert updated_task.status == "failed"
        assert updated_task.retry_count == 3
