import asyncio
import sys
import os

# Add src/a2a_node to sys.path
sys.path.append(os.path.join(os.getcwd(), "src/a2a_node"))

from app.core.learning import LearningEngine
from app.core.heuristics import BiddingHeuristics
from app.core.database import engine, Base
from app.models.ledger import LocalState, PeerEntry

async def setup_db():
    async with engine.begin() as conn:
        # Recreate tables to ensure clean state for test
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

async def test_skills_evolution():
    print("🚀 Starting Skills Evolution Test...")
    await setup_db()

    # 1. Initial Skills (from settings default)
    skills = await LearningEngine.get_local_skills()
    print(f"Initial skills: {skills}")
    assert "python_expert" in skills
    assert skills["python_expert"] == 1.0

    # 2. Test Success Evolution
    print("\n✅ Testing Success Evolution...")
    await LearningEngine.update_skill("python_expert", "completed")
    updated_skills = await LearningEngine.get_local_skills()
    print(f"Updated skills after success: {updated_skills['python_expert']}")
    assert updated_skills["python_expert"] > 1.0

    # 3. Test Skill Discovery
    print("\n🎓 Testing Skill Discovery...")
    await LearningEngine.update_skill("rust_ninja", "completed")
    discovered_skills = await LearningEngine.get_local_skills()
    print(f"Skills after discovery: {discovered_skills}")
    assert "rust_ninja" in discovered_skills
    assert discovered_skills["rust_ninja"] > 1.0

    # 4. Test Failure Penalty
    print("\n❌ Testing Failure Penalty...")
    before_fail = discovered_skills["rust_ninja"]
    await LearningEngine.update_skill("rust_ninja", "failed")
    after_fail_skills = await LearningEngine.get_local_skills()
    print(f"Weight after failure: {after_fail_skills['rust_ninja']}")
    assert after_fail_skills["rust_ninja"] < before_fail

    # 5. Test Heuristics Integration
    print("\n🧠 Testing Heuristics Integration...")
    # Node should have higher confidence for python_expert (weight > 1.0) 
    # than for a generic task with no skill match.
    
    eval_expert = await BiddingHeuristics.evaluate_task("python_expert", "Write some python code")
    eval_generic = await BiddingHeuristics.evaluate_task("generic", "Do something random")
    
    print(f"Confidence (Expert): {eval_expert['confidence']}")
    print(f"Confidence (Generic): {eval_generic['confidence']}")
    
    assert eval_expert["confidence"] > eval_generic["confidence"]
    assert eval_expert["bid_value"] < eval_generic["bid_value"] # Lower is better

    print("\n✨ Skills Evolution Test Passed!")

if __name__ == "__main__":
    asyncio.run(test_skills_evolution())
