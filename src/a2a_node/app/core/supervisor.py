import asyncio
import logging
from typing import Callable, Coroutine, List, Dict
from app.core.config import settings

logger = logging.getLogger("a2a_supervisor")

class TaskSupervisor:
    """
    Supervises background tasks, restarting them if they crash.
    """
    def __init__(self):
        self.tasks: Dict[str, Callable[[], Coroutine]] = {}
        self.running_tasks: Dict[str, asyncio.Task] = {}
        self.restart_counts: Dict[str, int] = {}
        self.max_restarts = 5
        self.restart_delay = 5 # seconds

    def register_task(self, name: str, task_func: Callable[[], Coroutine]):
        """
        Registers a task function to be supervised.
        """
        self.tasks[name] = task_func
        self.restart_counts[name] = 0
        logger.info(f"📋 Registered background task: {name}")

    async def start_task(self, name: str):
        """
        Starts or restarts a supervised task.
        """
        if name in self.running_tasks:
            self.running_tasks[name].cancel()
            
        task_func = self.tasks[name]
        logger.info(f"🚀 Starting background task: {name}")
        
        async def wrapped_task():
            try:
                await task_func()
            except asyncio.CancelledError:
                logger.info(f"🛑 Task {name} cancelled.")
                raise
            except Exception as e:
                logger.error(f"💥 Task {name} crashed: {str(e)}")
                self.restart_counts[name] += 1
                if self.restart_counts[name] <= self.max_restarts:
                    logger.info(f"🔄 Restarting task {name} in {self.restart_delay}s (Attempt {self.restart_counts[name]}/{self.max_restarts})")
                    await asyncio.sleep(self.restart_delay)
                    await self.start_task(name)
                else:
                    logger.error(f"💀 Task {name} exceeded max restarts. It is now dead to me.")

        self.running_tasks[name] = asyncio.create_task(wrapped_task())

    async def start_all(self):
        """
        Starts all registered tasks.
        """
        for name in self.tasks:
            await self.start_task(name)

    def stop_all(self):
        """
        Stops all supervised tasks.
        """
        for name, task in self.running_tasks.items():
            logger.info(f"🛑 Stopping task: {name}")
            task.cancel()

supervisor = TaskSupervisor()
