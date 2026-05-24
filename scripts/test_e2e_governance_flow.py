#!/usr/bin/env python3
"""
scripts/test_e2e_governance_flow.py
Phase 4 Step 2c: E2E HITL Governance Flow Test.
Verifies secure task approval/denial paths:
1. Create a task that requires HITL approval.
2. Verify task status is 'pending_approval'.
3. Attempt to approve/deny with INVALID auth (should fail).
4. Approve with VALID auth.
5. Verify task proceeds to 'pending'/'running'.
"""

import subprocess
import time
import requests
import hmac
import hashlib
import os
import sys
import json

# Configuration
MEDUSA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A2A_PATH = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "main.py")
PYTHON_VENV = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "venv", "bin", "python")
SECRET = os.getenv("A2A_SECRET", "medusa-please")
A2A_PORT = 3395

processes = []

def hmac_signature(path, secret, timestamp):
    payload = f"{timestamp}{path}"
    return hmac.new(secret.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()

def get_auth_headers(path, secret=SECRET):
    ts = str(int(time.time()))
    return {
        "X-Medusa-Timestamp": ts,
        "X-Medusa-Signature": hmac_signature(path, secret, ts)
    }

def start_a2a():
    print(f"[*] Starting A2A Node on port {A2A_PORT}...", flush=True)
    env = os.environ.copy()
    env["A2A_PORT"] = str(A2A_PORT)
    env["A2A_HOST"] = "127.0.0.1"
    env["A2A_SECRET"] = SECRET
    
    db_file = os.path.join(MEDUSA_ROOT, "src", "a2a_node", f"ledger_{A2A_PORT}.db")
    if os.path.exists(db_file): os.remove(db_file)
        
    cmd = [PYTHON_VENV if os.path.exists(PYTHON_VENV) else "python3", A2A_PATH]
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(("A2A", p))
    
    for _ in range(15):
        try:
            r = requests.get(f"http://localhost:{A2A_PORT}/", timeout=1)
            if r.status_code == 200:
                print("✅ A2A Node is operational.", flush=True)
                return p
        except: pass
        time.sleep(1)
    raise Exception("A2A Node failed to start")

def cleanup():
    for name, p in reversed(processes):
        p.terminate()

def run_test():
    try:
        start_a2a()
        
        # 1. Create task requiring approval
        # (Using a shell command that's inherently destructive/risky triggers HITL)
        print("[*] Creating risky task to trigger HITL...", flush=True)
        task_path = "/a2a/tasks"
        payload = {
            "task_type": "shell", 
            "description": "rm -rf /important/data",
            "priority": 10
        }
        r = requests.post(f"http://localhost:{A2A_PORT}{task_path}", json=payload, headers=get_auth_headers(task_path))
        assert r.status_code == 200
        task_id = r.json()["task_id"]
        
        # 2. Verify status
        print(f"[*] Verifying task {task_id} status is pending_approval...", flush=True)
        get_path = f"/a2a/tasks/{task_id}"
        r = requests.get(f"http://localhost:{A2A_PORT}{get_path}", headers=get_auth_headers(get_path))
        task = r.json()
        assert task["status"] == "pending_approval"
        assert task["requires_approval"] == 1
        print("[+] Task correctly gated by HITL.", flush=True)
        
        # 3. Attempt approval with WRONG SECRET
        print("[*] Testing unauthorized approval path...", flush=True)
        approve_path = f"/a2a/tasks/{task_id}/approve"
        r = requests.post(f"http://localhost:{A2A_PORT}{approve_path}", headers=get_auth_headers(approve_path, secret="wrong-secret"))
        assert r.status_code == 403
        print("[+] Unauthorized access correctly blocked.", flush=True)
        
        # 4. Approve with VALID SECRET
        print("[*] Testing authorized approval path...", flush=True)
        r = requests.post(f"http://localhost:{A2A_PORT}{approve_path}", headers=get_auth_headers(approve_path))
        assert r.status_code == 200
        print("[+] Task approved successfully.", flush=True)
        
        # 5. Verify task is now pending (unblocked)
        r = requests.get(f"http://localhost:{A2A_PORT}{get_path}", headers=get_auth_headers(get_path))
        task = r.json()
        assert task["status"] == "pending"
        assert task["approval_status"] == "approved"
        print("[+] Task correctly unblocked and ready for execution.", flush=True)

        print("[!] E2E HITL Governance Flow Test PASSED.", flush=True)

    except Exception as e:
        print(f"[-] Test FAILED: {str(e)}")
        sys.exit(1)
    finally:
        cleanup()

if __name__ == "__main__":
    run_test()
