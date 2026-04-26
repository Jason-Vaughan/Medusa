import time
from app.core.config import settings
from app.core.security import create_signature

def get_auth_headers(path: str) -> dict:
    """
    Generates the authentication headers required for Medusa A2A communication.
    The path should be the absolute path on the target server (e.g. /a2a/gossip/ping).
    """
    timestamp = str(time.time())
    payload = f"{timestamp}{path}"
    signature = create_signature(payload, settings.A2A_SECRET)
    
    return {
        "X-Medusa-Secret": settings.A2A_SECRET,
        "X-Medusa-Timestamp": timestamp,
        "X-Medusa-Signature": signature
    }
