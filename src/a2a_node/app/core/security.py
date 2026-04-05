from fastapi import Header, HTTPException, Depends
from app.core.config import settings

async def verify_medusa_secret(x_medusa_secret: str = Header(None)):
    """
    Verifies the X-Medusa-Secret header against the configured A2A_SECRET.
    """
    if x_medusa_secret != settings.A2A_SECRET:
        raise HTTPException(
            status_code=403,
            detail="Forbidden. Your secret is as weak as your code."
        )
    return x_medusa_secret
