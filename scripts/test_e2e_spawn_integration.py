#!/usr/bin/env python3
"""
scripts/test_e2e_spawn_integration.py
Phase 4 Step 2: End-to-End Spawn Integration Test.
Verifies the complete Chunk 34 autonomous-capacity-expansion chain:
1. Seed node detects sustained load.
2. Medusa Server triggers HITL spawn request.
3. Operator approves spawn via API.
4. Child node boots, registers via TangleClaw (4220 range), and enters gossip.
5. Child node self-terminates after idle period (verified via shortened timeouts).
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
import socket

# Configuration
MEDUSA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A2A_PATH = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "main.py")
SERVER_PATH = os.path.join(MEDUSA_ROOT, "src", "medusa", "medusa-server.js")
PYTHON_VENV = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "venv", "bin", "python")
SECRET = os.getenv("A2A_SECRET", "medusa-please")
SEED_PORT = 3399
MEDUSA_PORT = 3909 # Fixed to 3909 per requirement

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
    print(f"[*] Starting Medusa Server on port {MEDUSA_PORT}...", flush=True)
    env = os.environ.copy()
    env["A2A_SECRET"] = SECRET
    env["MEDUSA_PROTOCOL_PORT"] = str(MEDUSA_PORT)
    env["MEDUSA_PROTOCOL_HOST"] = "127.0.0.1"
    env["A2A_BASE_URL"] = f"http://localhost:{SEED_PORT}"
    
    # Configure fast auto-termination for test
    env["AUTO_TERM_UPTIME_FLOOR"] = "5"
    env["AUTO_TERM_IDLE_TIMEOUT"] = "3"
    env["TASK_JANITOR_INTERVAL"] = "2"
    env["PERFORMANCE_MONITOR_INTERVAL"] = "2"
    
    cmd = ["node", SERVER_PATH]
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(("Medusa", p))
    
    for _ in range(15):
        try:
            # Check protocol port responds (404 is fine, proves it's listening)
            r = requests.get(f"http://localhost:{MEDUSA_PORT}/health", timeout=1)
            if r.status_code in [200, 404]:
                print("[+] Medusa Server is operational.", flush=True)
                return p
        except: pass
        time.sleep(1)
    
    raise Exception("Medusa Server failed to start")

def start_seed_node():
    print(f"[*] Starting Seed A2A Node on port {SEED_PORT}...", flush=True)
    env = os.environ.copy()
    env["A2A_PORT"] = str(SEED_PORT)
    env["A2A_HOST"] = "127.0.0.1"
    env["A2A_NODE_TYPE"] = "seed"
    env["A2A_SECRET"] = SECRET
    env["MEDUSA_PROTOCOL_PORT"] = str(MEDUSA_PORT)
    env["EXPANSION_WINDOW"] = "10" # Fast expansion for test
    env["LOAD_THRESHOLD"] = "3"    # Low threshold for test
    env["PERFORMANCE_MONITOR_INTERVAL"] = "2"
    env["TASK_JANITOR_INTERVAL"] = "2"
    
    db_file = os.path.join(MEDUSA_ROOT, "src", "a2a_node", f"ledger_{SEED_PORT}.db")
    if os.path.exists(db_file): os.remove(db_file)
        
    cmd = [PYTHON_VENV if os.path.exists(PYTHON_VENV) else "python3", A2A_PATH]
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(("SeedNode", p))
    
    for _ in range(15):
        try:
            r = requests.get(f"http://localhost:{SEED_PORT}/", timeout=1)
            if r.status_code == 200:
                print("[+] Seed Node is operational.", flush=True)
                return p
        except: pass
        time.sleep(1)
    raise Exception("Seed Node failed to start")

def cleanup():
    print("\n[-] Cleaning up processes...", flush=True)
    for name, p in reversed(processes):
        print(f"Stopping {name}...", flush=True)
        try:
            p.terminate()
            p.wait(timeout=5)
        except:
            p.kill()
    
    subprocess.run(["pkill", "-f", "src/a2a_node/main.py"], capture_output=True)

def run_test():
    try:
        start_medusa()
        start_seed_node()
        
        # 1. Inject sustained load
        print("[*] Injecting load (10 pending tasks)...", flush=True)
        for i in range(10):
            path = "/a2a/tasks"
            payload = {"task_type": "research", "description": f"Integration Task #{i}", "priority": 5}
            r = requests.post(f"http://localhost:{SEED_PORT}{path}", json=payload, headers=get_auth_headers(path))
            if r.status_code != 200: raise Exception(f"Failed to inject task: {r.text}")
        
        print("[*] Waiting for expansion trigger...", flush=True)
        time.sleep(5)
        spawn_request_id = None
        for _ in range(30):
            r = requests.get(f"http://localhost:{MEDUSA_PORT}/telemetry")
            data = r.json()
            history = data.get("history", [])
            for msg in history:
                if "mesh.expand.requested" in msg.get("message", ""):
                    # Message format: "mesh.expand.requested: Approval required (ID: spawn-1716480000)"
                    parts = msg["message"].split("(ID: ")
                    if len(parts) > 1:
                        spawn_request_id = parts[1].split(")")[0]
                        print(f"[!] Spawn request detected: {spawn_request_id}", flush=True)
                        break
            if spawn_request_id: break
            time.sleep(2)
            
        if not spawn_request_id: raise Exception("Expansion trigger never fired.")
            
        # 2. Approve spawn
        print(f"[*] Approving spawn request {spawn_request_id}...", flush=True)
        approve_path = f"/mesh/approve/{spawn_request_id}"
        r = requests.post(f"http://localhost:{MEDUSA_PORT}{approve_path}", headers=get_auth_headers(approve_path))
        assert r.status_code == 200, f"Approval failed: {r.text}"
        
        spawn_data = r.json()
        child_port = spawn_data["port"]
        child_node_id = spawn_data["nodeId"]
        print(f"[*] Child node spawning on port {child_port} with ID {child_node_id}", flush=True)
        assert 4220 <= child_port <= 4239, f"Port {child_port} out of TangleClaw range!"
        
        # 3. Verify child registration and gossip
        print(f"[*] Waiting for child node {child_node_id} to register in gossip...", flush=True)
        child_active = False
        for _ in range(30):
            path = "/a2a/gossip/peers"
            try:
                r = requests.get(f"http://localhost:{SEED_PORT}{path}", headers=get_auth_headers(path))
                peers = r.json()
                for peer in peers:
                    if peer["id"] == child_node_id and peer["status"] == "active":
                        print(f"[+] Child node {child_node_id} is ACTIVE in gossip.", flush=True)
                        child_active = True
                        break
            except: pass
            if child_active: break
            time.sleep(2)
        assert child_active, "Child node never appeared active in gossip."
            
        # 4. Verify TangleClaw PortHub integration
        print("[*] Verifying TangleClaw PortHub lease...", flush=True)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            assert s.connect_ex(('127.0.0.1', child_port)) == 0, f"Child port {child_port} is not listening!"
        print(f"[+] Port {child_port} is verified listening.")

        # 5. Wait for self-termination
        print("[*] Waiting for child node self-termination (uptime=5s, idle=3s)...", flush=True)
        child_terminated = False
        # (uptime_floor + idle_timeout + buffer) = 5 + 3 + 60s (for task janitor loop)
        for _ in range(60):
            path = "/a2a/gossip/peers"
            r = requests.get(f"http://localhost:{SEED_PORT}{path}", headers=get_auth_headers(path))
            peers = r.json()
            child = next((p for p in peers if p["id"] == child_node_id), None)
            if not child or child["status"] == "terminated":
                print(f"[+] Child node {child_node_id} has terminated.", flush=True)
                child_terminated = True
                break
            time.sleep(2)
        assert child_terminated, "Child node failed to self-terminate within timeout."

        # 6. Verify /mesh/contract.received in telemetry
        print("[*] Verifying contraction telemetry...", flush=True)
        contract_verified = False
        for _ in range(5):
            r = requests.get(f"http://localhost:{MEDUSA_PORT}/telemetry")
            data = r.json()
            history = data.get("history", [])
            for msg in history:
                if "mesh.contract.received" in msg.get("message", "") and child_node_id in msg.get("message", ""):
                    print("[+] contraction event found in telemetry history.", flush=True)
                    contract_verified = True
                    break
            if contract_verified: break
            time.sleep(2)
        assert contract_verified, "Contraction telemetry not found."

        # 7. Verify spawnedChildrenExpected cleanup
        print("[*] Verifying registry cleanup...", flush=True)
        r = requests.get(f"http://localhost:{MEDUSA_PORT}/mesh/status")
        status = r.json()
        assert status["liveChildren"] == 0, f"Expected 0 live children, found {status['liveChildren']}"
        print("[+] Registry cleanup verified.")

        print("[!] Step 2: E2E Spawn Integration Test PASSED.", flush=True)

    except Exception as e:
        print(f"[-] Test FAILED: {str(e)}")
        sys.exit(1)
    finally:
        cleanup()

if __name__ == "__main__":
    run_test()
