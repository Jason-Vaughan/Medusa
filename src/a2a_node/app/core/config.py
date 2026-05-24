import os

class Settings:
    PROJECT_NAME: str = os.getenv("A2A_PROJECT_NAME", "Medusa-A2A")
    VERSION: str = "0.7.8-beta"
    A2A_SPEC_VERSION: str = "1.0-draft"
    PORT: int = int(os.getenv("A2A_PORT", 3200))
    HOST: str = os.getenv("A2A_HOST", "127.0.0.1")
    DEBUG: bool = os.getenv("A2A_DEBUG", "True") == "True"
    A2A_SECRET: str = os.getenv("A2A_SECRET", "medusa-please")
    MEDUSA_SKILLS: str = os.getenv("MEDUSA_SKILLS", "python_expert,security_auditor,sass_master")
    GOSSIP_INTERVAL: int = int(os.getenv("GOSSIP_INTERVAL", 10))
    # Default 7 days provides a sufficient window for post-mortem debugging of routine tasks 
    # while keeping the SQLite file size manageable for local development environments.
    RETENTION_DAYS_ROUTINE: int = int(os.getenv("RETENTION_DAYS_ROUTINE", 7))
    # Default 30 days for HITL and pre-approved tasks to ensure a durable audit trail for critical actions.
    RETENTION_DAYS_AUDIT: int = int(os.getenv("RETENTION_DAYS_AUDIT", 30))
    STALL_TIMEOUT: int = int(os.getenv("STALL_TIMEOUT", 300))
    PERFORMANCE_MONITOR_INTERVAL: int = int(os.getenv("PERFORMANCE_MONITOR_INTERVAL", 60))
    TASK_JANITOR_INTERVAL: int = int(os.getenv("TASK_JANITOR_INTERVAL", 60))
    AUTO_TERM_UPTIME_FLOOR: int = int(os.getenv("AUTO_TERM_UPTIME_FLOOR", 900))
    AUTO_TERM_IDLE_TIMEOUT: int = int(os.getenv("AUTO_TERM_IDLE_TIMEOUT", 600))
    BIDDING_CONFIDENCE_THRESHOLD: float = 0.6
    
    # Swarm Scaling Settings (Chunk 34)
    A2A_NODE_TYPE: str = os.getenv("A2A_NODE_TYPE", "seed") # 'seed' or 'spawned'
    LOAD_THRESHOLD: int = int(os.getenv("LOAD_THRESHOLD", 5))
    EXPANSION_WINDOW: int = int(os.getenv("EXPANSION_WINDOW", 60)) # seconds
    MEDUSA_SERVER_URL: str = os.getenv("MEDUSA_SERVER_URL", f"http://localhost:{os.getenv('MEDUSA_PROTOCOL_PORT', 3009)}")
    
    # Reputation Settings
    REPUTATION_WEIGHT_COMPLETED: float = 0.1
    REPUTATION_PENALTY_FAILED: float = 0.2
    REPUTATION_PENALTY_STALLED: float = 0.5
    REPUTATION_THRESHOLD_MIN: float = 0.3
    
    # LLM Configuration (Mirroring Medusa's multi-provider setup)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "anthropic") # 'anthropic', 'openai'
    LLM_MODEL: str = os.getenv("LLM_MODEL", "claude-3-haiku-20240307")
    
    @property
    def DATABASE_URL(self) -> str:
        # Database file location (unique per port to avoid lock contention during testing)
        DB_FILENAME = f"ledger_{self.PORT}.db"
        DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), DB_FILENAME)
        return f"sqlite+aiosqlite:///{DB_PATH}"

settings = Settings()
