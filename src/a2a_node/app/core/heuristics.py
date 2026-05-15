from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from app.core.config import settings
from app.core.performance import PerformanceMonitor
from app.core.learning import LearningEngine

class BiddingHeuristics:
    """
    Collective Intelligence module for making smarter bidding decisions.
    Determines if a node should bid on a task based on its skills and current load.
    """

    @staticmethod
    async def get_local_skills() -> dict:
        """Returns the weighted local skills matrix (Chunk 27)."""
        return await LearningEngine.get_local_skills()

    @classmethod
    def calculate_raw_confidence(cls, task_type: str, description: str, skills: dict, load: int, health: dict) -> Dict[str, Any]:
        """
        Shared logic for calculating confidence score.
        Multiplicative model for better sensitivity to overlapping factors.
        """
        task_type_lower = task_type.lower()
        desc_lower = description.lower()
        
        # 1. Base confidence
        confidence = 0.5
        matched_skills = []
        
        # 2. Skill Match Bonus
        skill_weight_bonus = 0.0
        for skill, weight in skills.items():
            skill_lower = skill.lower()
            match_found = False
            
            # Exact or Substring match
            if skill_lower in task_type_lower or task_type_lower in skill_lower:
                match_found = True
            else:
                # Keyword match
                skill_keywords = skill_lower.split('_')
                for kw in skill_keywords:
                    if len(kw) <= 3: continue
                    if kw in task_type_lower or kw in desc_lower or task_type_lower in kw:
                        match_found = True
                        break
            
            if match_found:
                skill_weight_bonus += (0.1 * weight)
                matched_skills.append(skill)
        
        confidence += skill_weight_bonus
        
        # 3. Load Adjustment (Multiplicative penalty)
        # Load 0 = 1.0, Load 5 = 0.75
        load_multiplier = max(0.5, 1.0 - (load * 0.05))
        confidence *= load_multiplier
        
        # 4. Health Adjustment
        cpu = health.get("cpu_percent", 0)
        mem = health.get("memory_percent", 0)
        
        health_multiplier = 1.0
        if cpu > 80: health_multiplier *= 0.7
        if mem > 90: health_multiplier *= 0.6
        
        confidence *= health_multiplier
        
        final_confidence = min(max(confidence, 0.1), 1.0)
        return {
            "confidence": final_confidence,
            "matched_skills": matched_skills
        }

    @classmethod
    async def evaluate_task(cls, task_type: str, description: str, current_load: int = 0) -> Dict[str, Any]:
        """
        Evaluates a task and returns a bid decision.
        """
        local_skills = await cls.get_local_skills()
        local_health = await PerformanceMonitor.get_resource_health()
        
        conf_data = cls.calculate_raw_confidence(task_type, description, local_skills, current_load, local_health)
        confidence = conf_data["confidence"]
        matched_skills = conf_data["matched_skills"]
            
        # Resource health critical check
        cpu = local_health.get("cpu_percent", 0)
        mem = local_health.get("memory_percent", 0)
        critical_condition = cpu > 95 or mem > 98

        # Dynamic Threshold Adjustment
        swarm_health = await PerformanceMonitor.get_swarm_health()
        min_confidence = settings.BIDDING_CONFIDENCE_THRESHOLD
        if swarm_health < 0.8: min_confidence += 0.1
        if swarm_health < 0.5: min_confidence += 0.2

        # Decision
        # Stability Bias: Local node prefers to work unless someone is significantly better
        word_count = len(description.split())
        should_bid = (confidence >= min_confidence or (word_count > 10 and current_load < 3)) and not critical_condition
        
        # bid_value: Lower is better. Scale 1.0 - confidence.
        bid_value = round(1.0 - confidence, 2)

        sass = "I'm on it. My skills are a perfect match." if matched_skills else "I can do this, but I'm not exactly a specialist."
        if critical_condition:
            sass = "I'm literally melting. CPU is at critical levels. Someone else take this!"
        elif current_load > 4:
            sass = "I'm a bit swamped, but I'll squeeze it in if I have to."

        return {
            "should_bid": should_bid,
            "confidence": confidence,
            "bid_value": bid_value,
            "matched_skills": matched_skills,
            "sass": sass,
            "min_confidence": min_confidence,
            "swarm_health": swarm_health,
            "current_load": current_load,
            "health": {"cpu": cpu, "mem": mem},
            "critical_condition": critical_condition
        }

    @classmethod
    def evaluate_decomposition(cls, task_type: str, description: str, current_load: int = 0) -> Dict[str, Any]:
        """
        Determines if a task should be decomposed into sub-tasks.
        """
        desc_lower = description.lower()
        
        # 1. Complexity Keywords
        keywords = ["and then", "research and", "implement and", "fix and", "analyze and"]
        has_keywords = any(kw in desc_lower for kw in keywords)
        
        # 2. Description Length
        is_long = len(description.split()) > 12
        
        # 3. Explicit Multi-step types
        multi_step_types = ["workflow", "pipeline", "complex_task", "project"]
        is_multi_step = any(t in task_type.lower() for t in multi_step_types)
        
        # 4. Swamped Adjustment (Chunk 20)
        # If we have too many tasks, decompose even simpler tasks to share the load
        is_swamped = current_load > 3
        
        should_decompose = has_keywords or (is_long and "and" in desc_lower) or is_multi_step or (is_swamped and len(description.split()) > 5)
        
        reason = "Complex multi-step request detected."
        if is_swamped and not (has_keywords or is_long or is_multi_step):
            reason = f"Node is swamped (Load: {current_load}). Decomposing to share load."

        return {
            "should_decompose": should_decompose,
            "reason": reason if should_decompose else "Task appears atomic.",
            "sass": "I'm buried in work. Let's break this up so someone else can help." if is_swamped and should_decompose else
                    "This is a bit much for one node. Let's make it a team effort." if should_decompose else 
                    "I can handle this myself, thanks."
        }

    @classmethod
    async def share_heuristic(cls) -> Dict[str, Any]:
        """
        Returns a summary of the node's current problem-solving heuristics.
        To be used for collective strategy sharing.
        """
        load_info = await PerformanceMonitor.get_current_load()
        return {
            "strategy": "skill-priority",
            "skills": await cls.get_local_skills(),
            "min_confidence": settings.BIDDING_CONFIDENCE_THRESHOLD,
            "current_load": load_info.get("total_load", 0),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    @classmethod
    async def evaluate_with_swarm_intelligence(cls, task_type: str, description: str, peers: List[Any], current_load: int = 0) -> Dict[str, Any]:
        """
        Evaluates a task while considering the strategies and performance of other nodes.
        Implements 'Strategic Yield' with Loop-Prevention (Stability Bias).
        """
        # 1. Local Evaluation
        local_eval = await cls.evaluate_task(task_type, description, current_load)
        if local_eval["critical_condition"] or not local_eval["should_bid"]:
            return local_eval

        # 2. Peer Analysis
        better_peers = []
        local_id = f"{settings.PROJECT_NAME}-{settings.PORT}"
        
        for peer in peers:
            if peer.id == local_id: continue
            
            strategies = peer.strategies or {}
            peer_skills_raw = strategies.get("skills", {})
            peer_perf = peer.performance or {}
            peer_load = strategies.get("current_load", 0)
            peer_health = peer.health_metadata or {}

            # Skills normalization
            peer_skills = peer_skills_raw if isinstance(peer_skills_raw, dict) else {s: 1.0 for s in peer_skills_raw}

            # A. Peer Confidence (Using the same core logic)
            peer_conf_data = cls.calculate_raw_confidence(task_type, description, peer_skills, peer_load, peer_health)
            peer_confidence = peer_conf_data["confidence"]

            # B. Apply Peer-Specific Multipliers (Reputation & Performance)
            reputation_score = peer_perf.get("reputation_score", 1.0)
            rep_multiplier = 1.0
            if reputation_score < settings.REPUTATION_THRESHOLD_MIN: rep_multiplier = 0.1
            elif reputation_score < 0.7: rep_multiplier = 0.5

            peer_confidence *= rep_multiplier

            # Performance Multiplier
            task_perf = peer_perf.get("task_types", {}).get(task_type)
            if task_perf:
                success_rate = task_perf["success"] / task_perf["count"] if task_perf["count"] > 0 else 1.0
                if success_rate < 0.8: peer_confidence *= 0.8
                if success_rate > 0.95: peer_confidence *= 1.2
            
            # Latency Bonus (Chunk 24)
            avg_latency = peer_perf.get("total_latency", 0) / peer_perf.get("total_tasks", 1) if peer_perf.get("total_tasks", 0) > 0 else 0
            if 0 < avg_latency < 1.0: # Sub-second average
                peer_confidence *= 1.1

            # Load Balance Multiplier (Strategic Yield)
            # If we are busy and peer is idle, give peer a bonus to encourage yielding (Chunk 20)
            if current_load > 2 and peer_load < current_load:
                load_bonus = 1.0 + (0.1 * (current_load - peer_load))
                peer_confidence *= load_bonus
            
            # C. Yield Decision with Stability Bias (0.1 threshold to break loops)
            if peer_confidence > (local_eval["confidence"] + 0.1) and reputation_score >= settings.REPUTATION_THRESHOLD_MIN:                better_peers.append({
                    "id": peer.id,
                    "confidence": peer_confidence,
                    "reputation": reputation_score
                })

        # 3. Strategic Yield Decision
        if better_peers:
            better_peers.sort(key=lambda x: x["confidence"], reverse=True)
            best_peer = better_peers[0]
            
            local_eval["should_bid"] = False
            local_eval["yielded_to"] = best_peer["id"]
            local_eval["sass"] = f"Yielding to peer {best_peer['id']} due to superior performance or lower load."
            
            print(f"🧠 Strategic Yield: Yielding task {task_type} to peer {best_peer['id']} (PeerConf: {best_peer['confidence']:.2f} >> LocalConf: {local_eval['confidence']:.2f})", flush=True)

        return local_eval
