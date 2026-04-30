import pytest
import hmac
import hashlib
import time
from httpx import AsyncClient, ASGITransport
from main import app
from app.core.governance import GovernanceEngine
from app.models.ledger import TaskEntry, CapabilityProfile, WorkspaceGrant
from app.core.database import AsyncSessionLocal, init_db
from app.core.config import settings
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
import uuid

def get_auth_headers(path: str):
    timestamp = str(int(time.time()))
    payload = f"{timestamp}{path}"
    signature = hmac.new(
        settings.A2A_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return {
        "X-Medusa-Secret": settings.A2A_SECRET,
        "X-Medusa-Timestamp": timestamp,
        "X-Medusa-Signature": signature
    }

@pytest.mark.asyncio
async def test_capability_profiles_and_grants():
    """
    Verifies the full capability profile and grant lifecycle.
    """
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        workspace_id = "test-workspace-1"
        
        # 1. Create Profile
        profile_payload = {
            "id": "test-profile",
            "description": "Allows non-destructive git and ls",
            "allowed_patterns": [
                {"tool": "shell", "commandPattern": "^git status$"},
                {"tool": "shell", "commandPattern": "^ls.*$"}
            ],
            "denied_patterns": [
                {"tool": "shell", "commandPattern": "rm -rf"}
            ]
        }
        path = "/a2a/capabilities/profiles"
        resp = await ac.post(path, json=profile_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        
        # 2. Issue Grant
        path = f"/a2a/workspaces/{workspace_id}/grants"
        grant_payload = {
            "profile_id": "test-profile",
            "granted_by": "human-admin",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        }
        resp = await ac.post(path, json=grant_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        grant_id = resp.json()["id"]
        
        # 3. Create task matching profile (ls -la)
        path = "/a2a/tasks"
        task_payload = {
            "task_type": "shell",
            "description": "ls -la",
            "assigned_by": workspace_id
        }
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pending"
        
        # Verify in DB
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(TaskEntry).filter(TaskEntry.id == data["task_id"]))
            task = res.scalars().first()
            assert task.approval_status == "pre_approved"
            
        # 4. Create task NOT matching profile (git commit -m "oops")
        path = "/a2a/tasks"
        task_payload = {
            "task_type": "shell",
            "description": "git commit -m 'oops'",
            "assigned_by": workspace_id
        }
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending_approval"
        
        # 5. Create task matching denied profile (ls; rm -rf /)
        path = "/a2a/tasks"
        task_payload = {
            "task_type": "shell",
            "description": "ls; rm -rf /",
            "assigned_by": workspace_id
        }
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending_approval"
        
        # 6. Revoke Grant
        path = f"/a2a/grants/{grant_id}"
        resp = await ac.delete(path, headers=get_auth_headers(path))
        assert resp.status_code == 200
        
        # 7. Create task matching profile again (ls) -> should now require approval
        path = "/a2a/tasks"
        task_payload = {
            "task_type": "shell",
            "description": "ls",
            "assigned_by": workspace_id
        }
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending_approval"

@pytest.mark.asyncio
async def test_grant_expiry():
    """
    Verifies that expired grants are ignored.
    """
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        workspace_id = "test-workspace-expiry"
        
        # 1. Create Profile
        path = "/a2a/capabilities/profiles"
        profile_payload = {
            "id": "expiry-profile",
            "allowed_patterns": [{"tool": "shell", "commandPattern": ".*"}]
        }
        await ac.post(path, json=profile_payload, headers=get_auth_headers(path))
        
        # 2. Issue EXPIRED Grant
        path = f"/a2a/workspaces/{workspace_id}/grants"
        grant_payload = {
            "profile_id": "expiry-profile",
            "granted_by": "human-admin",
            "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        }
        await ac.post(path, json=grant_payload, headers=get_auth_headers(path))
        
        # 3. Create task -> should require approval
        path = "/a2a/tasks"
        task_payload = {
            "task_type": "shell",
            "description": "ls",
            "assigned_by": workspace_id
        }
        resp = await ac.post(path, json=task_payload, headers=get_auth_headers(path))
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending_approval"
