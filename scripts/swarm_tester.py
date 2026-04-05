import subprocess
import time
import requests
import os
import signal
import sys
import json
import traceback

# Configuration
MEDUSA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A2A_PATH = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "main.py")
PYTHON_VENV = os.path.join(MEDUSA_ROOT, "src", "a2a_node", "venv", "bin", "python")
SECRET = "medusa-please"

# Use free ports (4200+)
nodes = []

def start_node(port, skills):
    print(f"STARTING node on port {port} with skills: {skills}", flush=True)
    env = os.environ.copy()
    env["A2A_PORT"] = str(port)
    env["MEDUSA_SKILLS"] = skills
    env["A2A_SECRET"] = SECRET
    
    log_file = open(f"node_{port}.log", "w")
    cmd = [PYTHON_VENV if os.path.exists(PYTHON_VENV) else "python3", A2A_PATH]
    p = subprocess.Popen(cmd, env=env, stdout=log_file, stderr=subprocess.STDOUT)
    nodes.append({"port": port, "process": p, "log": log_file})
    return p

def cleanup():
    print("\nCLEANUP: Cleaning up swarm...", flush=True)
    for n in nodes:
        print(f"KILLING node on port {n['port']}", flush=True)
        try:
            n["process"].terminate()
            n["log"].close()
        except:
            pass
    
    # Also clean up DB files to start fresh
    for n in nodes:
        db_file = os.path.join(MEDUSA_ROOT, "src", "a2a_node", f"ledger_{n['port']}.db")
        if os.path.exists(db_file):
            print(f"DELETING {db_file}", flush=True)
            try:
                os.remove(db_file)
            except:
                pass

def check_sync(task_id):
    results = {}
    for n in nodes:
        url = f"http://localhost:{n['port']}/a2a/gossip/sync"
        headers = {"X-Medusa-Secret": SECRET}
        try:
            r = requests.get(url, headers=headers, timeout=2)
            if r.status_code == 200:
                data = r.json()
                task = next((t for t in data["tasks"] if t["id"] == task_id), None)
                results[n['port']] = task["status"] if task else "missing"
            else:
                results[n['port']] = f"error {r.status_code}"
        except Exception as e:
            results[n['port']] = f"failed"
    return results

def main():
    try:
        # 1. Start 5 nodes with diverse skills
        start_node(4200, "generic")
        start_node(4201, "python_expert,fastapi_pro")
        start_node(4202, "security_auditor,code_reviewer")
        start_node(4203, "research,analysis,data")
        start_node(4204, "writer,reporter,editor")
        
        print("WAITING for nodes to become operational...", flush=True)
        for n in nodes:
            url = f"http://localhost:{n['port']}/"
            success = False
            for i in range(20):
                if n["process"].poll() is not None:
                    print(f"ERROR: Node {n['port']} crashed early.", flush=True)
                    break
                try:
                    r = requests.get(url, timeout=1)
                    if r.status_code == 200:
                        print(f"OK: Node {n['port']} is operational.", flush=True)
                        success = True
                        break
                except:
                    pass
                time.sleep(2)
            if not success:
                print(f"ERROR: Node {n['port']} failed to start.", flush=True)
                return

        print("DEBUG: All nodes operational", flush=True)
        time.sleep(5)
        
        # 2. Create a COMPLEX task that triggers DECOMPOSITION
        print("POSTING Complex Research task to Node 4200...", flush=True)
        task_payload = {
            "task_type": "research_project",
            "description": "Research and report on the history of Fibonacci numbers.",
            "priority": 8,
            "assigned_to": "swarm"
        }
        headers = {"X-Medusa-Secret": SECRET}
        
        r = requests.post("http://localhost:4200/a2a/tasks", json=task_payload, headers=headers, timeout=5)
        if r.status_code != 200:
            print(f"ERROR: Failed to create task on 4200: {r.status_code} {r.text}", flush=True)
            return
        
        parent_task_id = r.json()["task_id"]
        print(f"SUCCESS: Parent Task created: {parent_task_id}", flush=True)
        
        # 3. Monitor for 120 seconds to allow for decomposition and execution
        print("MONITORING swarm activity (Decomposition & Execution)...", flush=True)
        for i in range(24): # 2 mins total
            time.sleep(5)
            sync_status = check_sync(parent_task_id)
            print(f"   SYNC Status (T+{ (i+1)*5 }s): {json.dumps(sync_status)}", flush=True)
            
            # Check for sub-tasks (any node having more than 1 task in ledger)
            subtasks_found = False
            for n in nodes:
                url = f"http://localhost:{n['port']}/a2a/gossip/sync"
                r = requests.get(url, headers=headers, timeout=2)
                if r.status_code == 200:
                    tasks = r.json()["tasks"]
                    if len(tasks) > 1:
                        subtasks_found = True
                        pending_count = len([t for t in tasks if t["status"] == "pending"])
                        completed_count = len([t for t in tasks if t["status"] == "completed"])
                        print(f"      Node {n['port']} ledger: {len(tasks)} tasks ({pending_count} pending, {completed_count} completed)", flush=True)
            
            if any(s == "completed" for s in sync_status.values()):
                print("SUCCESS: Swarm successfully completed the complex task via decomposition!", flush=True)
                break
        
        # 4. Create a Security task on Node 4201
        print("POSTING Security Audit task to Node 4201...", flush=True)
        sec_payload = {
            "task_type": "security_audit",
            "description": "Perform a security audit and report findings.",
            "priority": 10,
            "assigned_to": "swarm"
        }
        r = requests.post("http://localhost:4201/a2a/tasks", json=sec_payload, headers=headers, timeout=5)
        if r.status_code == 200:
            sec_task_id = r.json()["task_id"]
            for i in range(24):
                time.sleep(5)
                sync_status = check_sync(sec_task_id)
                print(f"   SYNC Status (T+{ (i+1)*5 }s): {json.dumps(sync_status)}", flush=True)
                if any(s == "completed" for s in sync_status.values()):
                    print("SUCCESS: Security audit completed!", flush=True)
                    break

    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"EXCEPTION: {e}", flush=True)
        traceback.print_exc()
    finally:
        cleanup()

if __name__ == "__main__":
    main()
