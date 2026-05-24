import pytest
from fastapi import HTTPException, Request
from app.core.security import verify_medusa_handshake, verify_medusa_secret, create_signature
from unittest.mock import MagicMock
import time

@pytest.mark.asyncio
async def test_verify_medusa_handshake_missing_timestamp():
    request = MagicMock(spec=Request)
    with pytest.raises(HTTPException) as exc:
        await verify_medusa_handshake(request, x_medusa_timestamp=None)
    assert exc.value.status_code == 403
    assert "Missing X-Medusa-Timestamp" in exc.value.detail

@pytest.mark.asyncio
async def test_verify_medusa_handshake_invalid_timestamp():
    request = MagicMock(spec=Request)
    with pytest.raises(HTTPException) as exc:
        await verify_medusa_handshake(request, x_medusa_timestamp="not-a-float")
    assert exc.value.status_code == 403
    assert "Invalid X-Medusa-Timestamp" in exc.value.detail

@pytest.mark.asyncio
async def test_verify_medusa_handshake_expired_timestamp():
    request = MagicMock(spec=Request)
    old_ts = str(time.time() - 600) # 10 minutes ago
    with pytest.raises(HTTPException) as exc:
        await verify_medusa_handshake(request, x_medusa_timestamp=old_ts)
    assert exc.value.status_code == 403
    assert "Timestamp expired" in exc.value.detail

@pytest.mark.asyncio
async def test_verify_medusa_handshake_missing_signature():
    request = MagicMock(spec=Request)
    ts = str(time.time())
    with pytest.raises(HTTPException) as exc:
        await verify_medusa_handshake(request, x_medusa_timestamp=ts, x_medusa_signature=None)
    assert exc.value.status_code == 403
    assert "Missing X-Medusa-Signature" in exc.value.detail

@pytest.mark.asyncio
async def test_verify_medusa_handshake_invalid_signature():
    request = MagicMock(spec=Request)
    request.url.path = "/test"
    ts = str(time.time())
    with pytest.raises(HTTPException) as exc:
        await verify_medusa_handshake(request, x_medusa_timestamp=ts, x_medusa_signature="wrong")
    assert exc.value.status_code == 403
    assert "Invalid X-Medusa-Signature" in exc.value.detail

@pytest.mark.asyncio
async def test_verify_medusa_handshake_success():
    from app.core.config import settings
    request = MagicMock(spec=Request)
    request.url.path = "/test"
    ts = str(time.time())
    payload = f"{ts}{request.url.path}"
    sig = create_signature(payload, settings.A2A_SECRET)
    
    result = await verify_medusa_handshake(
        request, 
        x_medusa_timestamp=ts, 
        x_medusa_signature=sig,
        x_medusa_client_id="test-client"
    )
    assert result == "test-client"

@pytest.mark.asyncio
async def test_verify_medusa_secret_success():
    from app.core.config import settings
    result = await verify_medusa_secret(x_medusa_secret=settings.A2A_SECRET)
    assert result == settings.A2A_SECRET

@pytest.mark.asyncio
async def test_verify_medusa_secret_failure():
    with pytest.raises(HTTPException) as exc:
        await verify_medusa_secret(x_medusa_secret="wrong-secret")
    assert exc.value.status_code == 403
