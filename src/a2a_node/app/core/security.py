from fastapi import Header, HTTPException, Depends, Request
from app.core.config import settings
import hmac
import hashlib
import time

def create_signature(payload: str, secret: str) -> str:
    """
    Creates an HMAC-SHA256 signature for a payload using a secret.
    """
    return hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

def verify_signature(signature: str, payload: str, secret: str) -> bool:
    """
    Verifies an HMAC-SHA256 signature.
    """
    expected = create_signature(payload, secret)
    return hmac.compare_digest(signature, expected)

async def verify_medusa_handshake(
    request: Request,
    x_medusa_secret: str = Header(None),
    x_medusa_signature: str = Header(None),
    x_medusa_timestamp: str = Header(None)
):
    """
    Enhanced security handshake that verifies:
    1. The shared secret (X-Medusa-Secret)
    2. A cryptographic signature (X-Medusa-Signature)
    3. Timestamp validity to prevent replay attacks (X-Medusa-Timestamp)
    """
    # 1. Verify Secret
    if x_medusa_secret != settings.A2A_SECRET:
        raise HTTPException(
            status_code=403,
            detail="Forbidden. Your secret is as weak as your code."
        )

    # 2. Verify Timestamp (max 60 seconds skew)
    if not x_medusa_timestamp:
        raise HTTPException(status_code=403, detail="Missing X-Medusa-Timestamp header.")
    
    try:
        ts = float(x_medusa_timestamp)
        now = time.time()
        if abs(now - ts) > 60:
            raise HTTPException(status_code=403, detail="Timestamp expired or clock skew too high.")
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid X-Medusa-Timestamp.")

    # 3. Verify Signature
    if not x_medusa_signature:
        raise HTTPException(status_code=403, detail="Missing X-Medusa-Signature header.")

    # The signature payload is: timestamp + request path
    payload = f"{x_medusa_timestamp}{request.url.path}"
    if not verify_signature(x_medusa_signature, payload, settings.A2A_SECRET):
        raise HTTPException(status_code=403, detail="Invalid X-Medusa-Signature. Nice try, script kiddie.")

    return x_medusa_secret

# Legacy support for internal calls that might not have signatures yet
async def verify_medusa_secret(x_medusa_secret: str = Header(None)):
    if x_medusa_secret != settings.A2A_SECRET:
        raise HTTPException(
            status_code=403,
            detail="Forbidden."
        )
    return x_medusa_secret
