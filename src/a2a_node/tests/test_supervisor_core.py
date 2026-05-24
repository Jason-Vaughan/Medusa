import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from app.core.supervisor import TaskSupervisor

@pytest.mark.asyncio
async def test_supervisor_register_and_start():
    supervisor = TaskSupervisor()
    mock_task = AsyncMock()
    
    supervisor.register_task("test-task", mock_task)
    assert "test-task" in supervisor.tasks
    
    await supervisor.start_task("test-task")
    assert "test-task" in supervisor.running_tasks
    
    # Give it a moment to run
    await asyncio.sleep(0.1)
    mock_task.assert_called_once()
    
    supervisor.stop_all()

@pytest.mark.asyncio
async def test_supervisor_crash_restart():
    supervisor = TaskSupervisor()
    supervisor.restart_delay = 0.1
    
    crash_count = 0
    async def crashing_task():
        nonlocal crash_count
        crash_count += 1
        if crash_count <= 2:
            raise Exception("Boom!")
        await asyncio.sleep(10) # Stay alive after 2 crashes
        
    supervisor.register_task("crashing", crashing_task)
    await supervisor.start_task("crashing")
    
    # Wait for restarts (0.1s delay * 2)
    await asyncio.sleep(0.5)
    
    assert supervisor.restart_counts["crashing"] == 2
    assert crash_count == 3
    
    supervisor.stop_all()

@pytest.mark.asyncio
async def test_supervisor_max_restarts():
    supervisor = TaskSupervisor()
    supervisor.max_restarts = 2
    supervisor.restart_delay = 0.1
    
    async def always_crashes():
        raise Exception("Continuous Boom!")
        
    supervisor.register_task("dead-task", always_crashes)
    await supervisor.start_task("dead-task")
    
    await asyncio.sleep(0.5)
    
    assert supervisor.restart_counts["dead-task"] == 3 # Initial + 2 restarts
    # Wait, the code says:
    # self.restart_counts[name] += 1
    # if self.restart_counts[name] <= self.max_restarts:
    # So if max is 2:
    # 1st crash: count=1, count <= 2 (True) -> restart
    # 2nd crash: count=2, count <= 2 (True) -> restart
    # 3rd crash: count=3, count <= 2 (False) -> stop
    
    supervisor.stop_all()

@pytest.mark.asyncio
async def test_supervisor_start_all_stop_all():
    supervisor = TaskSupervisor()
    
    async def long_task():
        await asyncio.sleep(10)
    
    supervisor.register_task("task1", long_task)
    supervisor.register_task("task2", long_task)
    
    await supervisor.start_all()
    assert len(supervisor.running_tasks) == 2
    
    supervisor.stop_all()
    for name, task in supervisor.running_tasks.items():
        assert task.cancelling() > 0 or task.cancelled()
