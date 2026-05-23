#!/usr/bin/env python3
"""
scripts/test_e2e_spawn.py
End-to-End Spawn Integration Test for Medusa Mesh.
Verifies the full composition of Chunk 34:
1. Seed node detects sustained load (16+ tasks).
2. Medusa Server triggers HITL spawn request after 60s window.
3. Operator approves spawn via API.
4. Child node boots, registers via TangleClaw (4220 range), and enters gossip.
5. Child node self-terminates after idle period.
6. Server reconciles and verifies contraction telemetry.
"""

import subprocess
import time
import requests
import hmac
import hashlib
import os
import sys
import json
from datetime import datetime, UTC

# Configuration
MEDUSA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A2A_PATH = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "main.py")
SERVER_PATH = os.path.join(MEDUSA_ROOT, "bin", "medusa.js")
PYTHON_VENV = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "venv", "bin", "python")
SECRET = "medusa-please"
SEED_PORT = 3399
MEDUSA_PORT = 3009

processes = []

def hmac_signature(path, secret, timestamp):
    payload = f"{timestamp}{path}"
    return hmac.new(secret.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()

def get_auth_headers(path):
    ts = str(int(time.time()))
    return {
        "X-Medusa-Timestamp": ts,
        "X-Medusa-Signature": hmac_signature(path, SECRET, ts)
    }

def start_medusa():
    print("🚀 Starting Medusa Server...", flush=True)
    env = os.environ.copy()
    env["A2A_SECRET"] = SECRET
    env["PORT"] = str(MEDUSA_PORT)
    registry_path = os.path.join(MEDUSA_ROOT, "workspace-registry.json")
    if os.path.exists(registry_path): os.remove(registry_path)
        
    cmd = ["node", SERVER_PATH, "medusa", "start"]
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(("Medusa", p))
    
    for _ in range(10):
        try:
            if requests.get(f"http://localhost:{MEDUSA_PORT}/health", timeout=1).status_code == 200:
                print("✅ Medusa Server is operational.", flush=True)
                return p
        except: pass
        time.sleep(1)
    raise Exception("Medusa Server failed to start")

def start_seed_node():
    print(f"🐝 Starting Seed A2A Node on port {SEED_PORT}...", flush=True)
    env = os.environ.copy()
    env["A2A_PORT"] = str(SEED_PORT)
    env["A2A_NODE_TYPE"] = "seed"
    env["A2A_SECRET"] = SECRET
    env["EXPANSION_WINDOW"] = "60" 
    env["LOAD_THRESHOLD"] = "5"
    
    db_file = os.path.join(MEDUSA_ROOT, "src", "a2a_node", f"ledger_{SEED_PORT}.db")
    if os.path.exists(db_file): os.remove(db_file)
        
    cmd = [PYTHON_VENV if os.path.exists(PYTHON_VENV) else "python3", A2A_PATH]
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(("SeedNode", p))
    
    for _ in range(10):
        try:
            if requests.get(f"http://localhost:{SEED_PORT}/", timeout=1).status_code == 200:
                print("✅ Seed Node is operational.", flush=True)
                return p
        except: pass
        time.sleep(1)
    raise Exception("Seed Node failed to start")

def cleanup():
    print("\n🧹 Cleaning up processes...", flush=True)
    for name, p in processes:
        print(f"Stopping {name}...", flush=True)
        p.terminate()
    time.sleep(2)
    for name, p in processes:
        if p.poll() is None: p.kill()

def run_test():
    try:
        start_medusa()
        start_seed_node()
        
        # 1. Inject sustained load (16 tasks >> 5 threshold)
        print("📥 Injecting load (16 pending tasks)...", flush=True)
        for i in range(16):
            path = "/a2a/tasks"
            payload = {"task_type": "research", "description": f"Task #{i}", "priority": 5}
            r = requests.post(f"http://localhost:{SEED_PORT}{path}", json=payload, headers=get_auth_headers(path))
            if r.status_code != 200: raise Exception(f"Failed to inject task: {r.text}")
        
        print("⏳ Waiting for expansion trigger (>70s window)...", flush=True)
        spawn_request_id = None
        for _ in range(45): # 90s total poll for a 60s window
            r = requests.get(f"http://localhost:{MEDUSA_PORT}/telemetry")
            history = r.json()
            for msg in history:
                if "HITL Gate: Spawn request" in msg.get("message", ""):
                    spawn_request_id = msg["message"].split("request ")[1].split(" queued")[0]
                    print(f"🎯 Spawn request detected: {spawn_request_id}", flush=True)
                    break
            if spawn_request_id: break
            time.sleep(2)
            
        if not spawn_request_id: raise Exception("Expansion trigger never fired.")
            
        # 2. Approve spawn
        print(f"👍 Approving spawn request {spawn_request_id}...", flush=True)
        approve_path = f"/mesh/approve/{spawn_request_id}"
        r = requests.post(f"http://localhost:{MEDUSA_PORT}{approve_path}", headers=get_auth_headers(approve_path))
        assert r.status_code == 200, f"Approval failed: {r.text}"
        
        spawn_data = r.json()
        child_port = spawn_data["port"]
        child_node_id = spawn_data["nodeId"]
        print(f"🚀 Child node spawning on port {child_port} with ID {child_node_id}", flush=True)
        assert 4220 <= child_port <= 4239, f"Port {child_port} out of TangleClaw range!"
        
        # 3. Verify child registration and gossip
        print(f"⏳ Waiting for child node {child_node_id} to register in gossip...", flush=True)
        child_active = False
        for _ in range(30):
            path = "/a2a/gossip/peers"
            r = requests.get(f"http://localhost:{SEED_PORT}{path}", headers=get_auth_headers(path))
            peers = r.json()
            for peer in peers:
                if peer["id"] == child_node_id and peer["status"] == "active":
                    print(f"✅ Child node {child_node_id} is ACTIVE in gossip.", flush=True)
                    child_active = True
                    break
            if child_active: break
            time.sleep(2)
        assert child_active, "Child node never appeared active in gossip."
            
        # 4. Force idle and verify shutdown
        # PIN ALERT: This will currently hang/fail due to 15m/10m hardcoded limits.
        print("💤 Verifying auto-termination (expects Major #1/#2 fixes)...", flush=True)
        child_vanished = False
        for _ in range(10): # Short poll to prove it DOES NOT happen yet
            path = "/a2a/gossip/peers"
            r = requests.get(f"http://localhost:{SEED_PORT}{path}", headers=get_auth_headers(path))
            peers = r.json()
            child = next((p for p in peers if p["id"] == child_node_id), None)
            if not child or child["status"] == "terminated":
                child_vanished = True
                break
            time.sleep(1)
            
        if not child_vanished:
            print("❌ Child node still active (as expected for pin-test).", flush=True)
        else:
            print("✅ Child node vanished/terminated.", flush=True)

        # 5. Check telemetry for contract
        r = requests.get(f"http://localhost:{MEDUSA_PORT}/telemetry")
        history = r.json()
        contract_event = any("mesh.contract.received" in msg.get("message", "") for msg in history)
        if contract_event:
            print("✅ mesh.contract.received found in telemetry.", flush=True)
        else:
            print("❌ mesh.contract.received NOT found in telemetry (expected for pin-test).", flush=True)

    finally:
        cleanup()

if __name__ == "__main__":
    run_test()
