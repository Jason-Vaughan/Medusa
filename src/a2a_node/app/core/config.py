import os

class Settings:
    PROJECT_NAME: str = os.getenv("A2A_PROJECT_NAME", "Medusa-A2A")
    VERSION: str = "0.7.3-beta"
    A2A_SPEC_VERSION: str = "1.0-draft"
    PORT: int = int(os.getenv("A2A_PORT", 3200))
    HOST: str = "0.0.0.0"
    DEBUG: bool = os.getenv("A2A_DEBUG", "True") == "True"
    A2A_SECRET: str = os.getenv("A2A_SECRET", "medusa-please")
    MEDUSA_SKILLS: str = os.getenv("MEDUSA_SKILLS", "python_expert,security_auditor,sass_master")
    GOSSIP_INTERVAL: int = int(os.getenv("GOSSIP_INTERVAL", 10))
    
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
