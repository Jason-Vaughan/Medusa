import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from app.core.execution import TaskExecutor, run_execution_engine
from app.models.ledger import TaskEntry
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from datetime import datetime, UTC, timedelta
import uuid

@pytest.mark.asyncio
async def test_invoke_mcp_tool_success():
    with patch("app.core.execution.asyncio.create_subprocess_shell") as mock_spawn:
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"Tool output", b"")
        mock_proc.returncode = 0
        mock_spawn.return_value = mock_proc
        
        result = await TaskExecutor.invoke_mcp_tool("medusa_send", "message")
        assert result["outcome"] == "completed"
        assert result["stdout"] == "Tool output"
        assert "medusa_send" in result["tool"]

@pytest.mark.asyncio
async def test_invoke_mcp_tool_failure():
    with patch("app.core.execution.asyncio.create_subprocess_shell") as mock_spawn:
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"", b"Error message")
        mock_proc.returncode = 1
        mock_spawn.return_value = mock_proc
        
        result = await TaskExecutor.invoke_mcp_tool("medusa_send", "message")
        assert result["outcome"] == "failed"
        assert result["stderr"] == "Error message"

@pytest.mark.asyncio
async def test_prune_tasks():
    async with AsyncSessionLocal() as db:
        # Create an old task
        old_time = datetime.now(UTC) - timedelta(days=10)
        task = TaskEntry(
            id=str(uuid.uuid4()),
            task_type="routine",
            description="prune me",
            status="completed",
            updated_at=old_time.replace(tzinfo=None)
        )
        db.add(task)
        await db.commit()
        
        # Prune with 7-day routine threshold
        pruned_count = await TaskExecutor.prune_tasks(days_routine=7, days_audit=30)
        assert pruned_count >= 1

@pytest.mark.asyncio
async def test_execution_engine_loop_iteration():
    # Mocking the loop is hard, so we'll mock dependencies and run one iteration
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="echo 'loop test'",
            status="pending",
            assigned_to="local"
        )
        db.add(task)
        await db.commit()
        
    with patch("app.core.execution.TaskExecutor.execute", return_value={"outcome": "completed"}) as mock_exec:
        with patch("app.core.performance.PerformanceMonitor.record_execution") as mock_perf:
            with patch("app.core.reputation.ReputationEngine.update_reputation") as mock_rep:
                with patch("app.core.performance.PerformanceMonitor.get_current_load", return_value={"total_load": 0}):
                    # Run the engine in a task and cancel it after it processes the task
                    engine_task = asyncio.create_task(run_execution_engine())
                
                # Wait for task to be processed (status changes from pending -> running -> completed)
                for _ in range(20):
                    async with AsyncSessionLocal() as db_check:
                        res = await db_check.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
                        t = res.scalars().first()
                        if t and t.status == "completed":
                            break
                    await asyncio.sleep(0.5)
                
                engine_task.cancel()
                try:
                    await engine_task
                except asyncio.CancelledError:
                    pass
                
                mock_exec.assert_called()
                mock_perf.assert_called()
                mock_rep.assert_called()

@pytest.mark.asyncio
async def test_invoke_mcp_tool_exception():
    with patch("app.core.execution.asyncio.create_subprocess_shell", side_effect=Exception("Spawn failed")):
        result = await TaskExecutor.invoke_mcp_tool("medusa_send", "message")
        assert result["outcome"] == "failed"
        assert "Spawn failed" in result["error"]

@pytest.mark.asyncio
async def test_prune_tasks_exception():
    # To fix the RuntimeWarning, we need to ensure ALL coroutines are awaited.
    # The issue is that TaskExecutor.prune_tasks makes multiple calls.
    mock_session = AsyncMock()
    
    # Define a helper that returns a MagicMock with .all() returning []
    def mock_execute(*args, **kwargs):
        m = MagicMock()
        m.all.return_value = []
        return m

    mock_session.execute.side_effect = mock_execute
    
    # Trigger exception on commit to reach the exception handler
    mock_session.commit.side_effect = Exception("DB error")
    
    # We must patch AsyncSessionLocal to return our mock_session
    # and ensure the 'async with' context manager works.
    with patch("app.core.database.AsyncSessionLocal", return_value=mock_session):
        # We also need to mock the context manager behavior if it's used as a factory
        mock_session.__aenter__.return_value = mock_session
        
        pruned_count = await TaskExecutor.prune_tasks()
        assert pruned_count == 0

@pytest.mark.asyncio
async def test_execution_engine_retry_logic():
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="echo 'retry test'",
            status="pending",
            assigned_to="local",
            max_retries=1,
            retry_count=0
        )
        db.add(task)
        await db.commit()
        
    # Mock failure first
    with patch("app.core.execution.TaskExecutor.execute", return_value={"outcome": "failed", "error": "Planned failure"}):
        with patch("app.core.performance.PerformanceMonitor.record_execution"):
            with patch("app.core.reputation.ReputationEngine.update_reputation"):
                engine_task = asyncio.create_task(run_execution_engine())
                
                # Wait for retry increment
                for _ in range(20):
                    async with AsyncSessionLocal() as db_check:
                        res = await db_check.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
                        t = res.scalars().first()
                        if t and t.retry_count == 1:
                            break
                    await asyncio.sleep(0.5)
                
                engine_task.cancel()
                try: await engine_task
                except asyncio.CancelledError: pass
                
                async with AsyncSessionLocal() as db_final:
                    res = await db_final.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
                    t = res.scalars().first()
                    assert t.retry_count == 1
                    assert t.status == "pending"

@pytest.mark.asyncio
async def test_execution_engine_consensus_path():
    task_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        task = TaskEntry(
            id=task_id,
            task_type="shell",
            description="echo 'consensus test'",
            status="pending",
            assigned_to="local",
            requires_consensus=1,
            min_votes=1
        )
        db.add(task)
        await db.commit()
        
    with patch("app.core.execution.TaskExecutor.execute", return_value={"outcome": "completed", "stdout": "ok"}):
        with patch("app.core.performance.PerformanceMonitor.record_execution"):
            with patch("app.core.reputation.ReputationEngine.update_reputation"):
                with patch("app.api.gossip.reach_consensus", new_callable=AsyncMock) as mock_consensus:
                    engine_task = asyncio.create_task(run_execution_engine())
                    
                    for _ in range(20):
                        async with AsyncSessionLocal() as db_check:
                            res = await db_check.execute(select(TaskEntry).filter(TaskEntry.id == task_id))
                            t = res.scalars().first()
                            if t and t.status == "completed":
                                break
                        await asyncio.sleep(0.5)
                    
                    engine_task.cancel()
                    try: await engine_task
                    except asyncio.CancelledError: pass
                    
                    mock_consensus.assert_called()
