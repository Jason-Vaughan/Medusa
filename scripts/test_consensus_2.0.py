import httpx
import asyncio
import json
import time

A2A_NODES = ["http://localhost:3200", "http://localhost:3201", "http://localhost:3202"]

async def test_consensus_2_0():
    print("🚀 Testing Advanced Consensus 2.0...")
    
    # 1. Create a task that requires consensus (Weighted Threshold)
    payload = {
        "task_type": "critical_calc",
        "description": "Calculate the swarm vitality coefficient with high precision.",
        "requires_consensus": True,
        "min_votes": 3,
        "consensus_strategy": "weighted_threshold",
        "quorum_threshold": 0.7
    }
    
    # We use node 3200 to create the task
    try:
        async with httpx.AsyncClient() as client:
            # Need auth headers? Yes.
            # But the dashboard proxy usually handles this.
            # Let's use the Medusa Protocol proxy if available.
            MEDUSA_URL = "http://localhost:3009/a2a/tasks"
            
            print(f"📡 Creating task via Medusa Proxy: {MEDUSA_URL}")
            r = await client.post(MEDUSA_URL, json=payload, timeout=5)
            if r.status_code != 200:
                print(f"❌ Failed to create task: {r.text}")
                return
            
            task_id = r.json().get("task_id")
            print(f"✅ Task created: {task_id}")
            
            # 2. Wait for nodes to gossip and pick it up
            print("⏳ Waiting for nodes to vote (Simulated)...")
            # In a real test, the nodes would execute it.
            # Here we just wait and observe the dashboard or ledger.
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_consensus_2_0())
