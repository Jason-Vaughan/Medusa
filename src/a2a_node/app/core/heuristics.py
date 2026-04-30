from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from app.core.config import settings
from app.core.performance import PerformanceMonitor

class BiddingHeuristics:
    """
    Collective Intelligence module for making smarter bidding decisions.
    Determines if a node should bid on a task based on its skills and current load.
    """

    @staticmethod
    def get_local_skills() -> List[str]:
        """Returns the list of local skills from configuration."""
        return [s.strip() for s in settings.MEDUSA_SKILLS.split(',') if s.strip()]

    @classmethod
    async def evaluate_task(cls, task_type: str, description: str, current_load: int = 0) -> Dict[str, Any]:
        """
        Evaluates a task and returns a bid decision.
        """
        local_skills = cls.get_local_skills()
        
        # 1. Skill Match (Primary Heuristic)
        # Check if any skill matches the task_type or keywords in the description
        matched_skills = []
        for skill in local_skills:
            skill_lower = skill.lower()
            task_type_lower = task_type.lower()
            desc_lower = description.lower()
            
            # 1. Exact or Substring match for skill name
            if skill_lower in task_type_lower or task_type_lower in skill_lower:
                matched_skills.append(skill)
                continue
                
            # 2. Keyword-based matching
            skill_keywords = skill_lower.split('_')
            for kw in skill_keywords:
                if len(kw) <= 3: continue
                if kw in task_type_lower or kw in desc_lower or task_type_lower in kw:
                    matched_skills.append(skill)
                    break

        # 2. Confidence Calculation
        # Base confidence is 0.5, increased by skill matches
        confidence = 0.5
        if matched_skills:
            confidence += 0.1 * len(matched_skills)
            
        # 3. Load Adjustment (Chunk 20)
        # Reduce confidence if load is high. Each active task reduces confidence by 0.05
        load_penalty = current_load * 0.05
        confidence -= load_penalty

        # 4. Resource Health Adjustment (Chunk 24)
        health = await PerformanceMonitor.get_resource_health()
        cpu = health.get("cpu_percent", 0)
        mem = health.get("memory_percent", 0)
        
        # Penalties for high resource usage
        if cpu > 80: confidence -= 0.3
        if mem > 90: confidence -= 0.4
        
        # Auto-rejection for extreme conditions
        critical_condition = False
        if cpu > 95 or mem > 98:
            critical_condition = True

        # 5. Dynamic Threshold Adjustment (Chunk 25)
        # Adjust confidence threshold based on swarm health
        swarm_health = await PerformanceMonitor.get_swarm_health()
        min_confidence = settings.BIDDING_CONFIDENCE_THRESHOLD # Default 0.6
        if swarm_health < 0.8:
            min_confidence += 0.1
        if swarm_health < 0.5:
            min_confidence += 0.2

        # 6. Decision
        # If confidence is high enough, or if it's a generic task and load is low
        # Auto-reject if in critical condition
        should_bid = (confidence >= min_confidence or (len(description.split()) > 10 and current_load < 3)) and not critical_condition
        
        # 7. Bid Value (Cost/Time)
        # Base value 1.0, decreased by skills (lower is better/faster)
        # Increased by load (higher load = more "expensive" to take on)
        bid_value = 1.0 - (0.1 * len(matched_skills)) + (0.2 * current_load)
        
        # Health multiplier for bid value (unhealthy = more expensive)
        if cpu > 70: bid_value *= 1.5
        if mem > 80: bid_value *= 2.0

        return {
            "should_bid": should_bid,
            "confidence": min(max(confidence, 0.1), 1.0),
            "min_confidence": min_confidence,
            "swarm_health": swarm_health,
            "bid_value": max(bid_value, 0.1),
            "matched_skills": matched_skills,
            "current_load": current_load,
            "health": {"cpu": cpu, "mem": mem},
            "sass": "I'm literally melting. No." if critical_condition else
                    "Swarm is struggling. I'm being selective." if should_bid and swarm_health < 0.7 else
                    "I'm busy, but for this, I'll make time." if should_bid and current_load > 2 else 
                    "I suppose I could do this better than anyone else." if should_bid else 
                    "I'm too swamped for this triviality." if current_load > 5 or cpu > 85 else
                    "This is beneath my specialized talents."
        }
        # Base value 1.0, decreased by skills (lower is better/faster)
        # Increased by load (higher load = more "expensive" to take on)
        bid_value = 1.0 - (0.1 * len(matched_skills)) + (0.2 * current_load)
        
        # Health multiplier for bid value (unhealthy = more expensive)
        if cpu > 70: bid_value *= 1.5
        if mem > 80: bid_value *= 2.0

        return {
            "should_bid": should_bid,
            "confidence": min(max(confidence, 0.1), 1.0),
            "min_confidence": min_confidence,
            "swarm_health": swarm_health,
            "bid_value": max(bid_value, 0.1),
            "matched_skills": matched_skills,
            "current_load": current_load,
            "health": {"cpu": cpu, "mem": mem},
            "sass": "I'm literally melting. No." if critical_condition else
                    "Swarm is struggling. I'm being selective." if should_bid and swarm_health < 0.7 else
                    "I'm busy, but for this, I'll make time." if should_bid and current_load > 2 else 
                    "I suppose I could do this better than anyone else." if should_bid else 
                    "I'm too swamped for this triviality." if current_load > 5 or cpu > 85 else
                    "This is beneath my specialized talents."
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
            "skills": cls.get_local_skills(),
            "min_confidence": settings.BIDDING_CONFIDENCE_THRESHOLD,
            "current_load": load_info.get("total_load", 0),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    @classmethod
    async def evaluate_with_swarm_intelligence(cls, task_type: str, description: str, peers: List[Any], current_load: int = 0) -> Dict[str, Any]:
        """
        Evaluates a task while considering the strategies and performance of other nodes.
        Implements 'Strategic Yield' - yielding to nodes with better specialized strategies,
        proven superior performance, lower current load, or better resource health.
        """
        # 1. Local Evaluation
        local_eval = await cls.evaluate_task(task_type, description, current_load)

        # 2. Peer Analysis
        better_peers = []
        for peer in peers:
            strategies = peer.strategies or {}
            peer_skills = strategies.get("skills", [])
            peer_perf = peer.performance or {}
            peer_load = strategies.get("current_load", 0)
            peer_health = peer.health_metadata or {}

            # A. Skill Match Check
            peer_matches = 0
            for skill in peer_skills:
                skill_lower = skill.lower()
                if skill_lower in task_type.lower() or skill_lower in description.lower():
                    peer_matches += 1

            # B. Performance Multiplier
            # Factor in success rate and average latency if available
            perf_multiplier = 1.0
            
            # Check for task-specific performance first, then global
            task_perf = peer_perf.get("task_types", {}).get(task_type)
            if task_perf:
                success_rate = task_perf["success"] / task_perf["count"] if task_perf["count"] > 0 else 1.0
                avg_latency = task_perf["latency"] / task_perf["count"] if task_perf["count"] > 0 else 1.0
                
                # Penalty for low success rate
                if success_rate < 0.8: perf_multiplier *= 0.7
                if success_rate > 0.95: perf_multiplier *= 1.2
                
                # Bonus/Penalty for latency (fast is better)
                if avg_latency < 1.0: perf_multiplier *= 1.1
                if avg_latency > 5.0: perf_multiplier *= 0.9
            else:
                # Use global performance if task-specific is missing
                total = peer_perf.get("total_tasks", 0)
                if total > 5: # Need a minimum sample size
                    success_rate = peer_perf.get("success_count", 0) / total
                    if success_rate < 0.8: perf_multiplier *= 0.8
                    if success_rate > 0.95: perf_multiplier *= 1.1

            # C. Load Balancing & Health Multiplier (Chunk 20 & 24)
            # If peer has lower load or better health than us, they are more attractive
            load_multiplier = 1.0
            
            # Load component
            if current_load > peer_load:
                load_multiplier += (0.1 * (current_load - peer_load))
            elif peer_load > current_load + 2:
                load_multiplier *= 0.7

            # Health component (Chunk 24)
            peer_cpu = peer_health.get("cpu_percent", 0)
            peer_mem = peer_health.get("memory_percent", 0)
            
            local_cpu = local_eval["health"]["cpu"]
            local_mem = local_eval["health"]["mem"]
            
            # Bonus if peer is significantly healthier
            if local_cpu > peer_cpu + 30:
                load_multiplier *= 1.2
            if local_mem > peer_mem + 20:
                load_multiplier *= 1.1
                
            # Penalty if peer is unhealthy
            if peer_cpu > 80 or peer_mem > 90:
                load_multiplier *= 0.5

            # D. Reputation Adjustment (Chunk 25)
            # Factor in long-term reputation score
            reputation_score = peer_perf.get("reputation_score", 1.0)
            
            # Heavy penalty for low reputation
            rep_multiplier = 1.0
            if reputation_score < settings.REPUTATION_THRESHOLD_MIN:
                rep_multiplier = 0.1 # Basically never yield to them
            elif reputation_score < 0.7:
                rep_multiplier = 0.5
            
            peer_confidence = (strategies.get("min_confidence", 0.5) + (0.1 * peer_matches)) * perf_multiplier * load_multiplier * rep_multiplier

            if peer_confidence > local_eval["confidence"] and reputation_score >= settings.REPUTATION_THRESHOLD_MIN:
                better_peers.append({
                    "id": peer.id,
                    "confidence": peer_confidence,
                    "reputation": reputation_score,
                    "skills": peer_skills,
                    "perf_multiplier": perf_multiplier,
                    "load": peer_load,
                    "cpu": peer_cpu
                })

        # 3. Strategic Yield Decision
        if better_peers and local_eval["should_bid"]:
            # Sort by confidence descending
            better_peers.sort(key=lambda x: x["confidence"], reverse=True)
            best_peer = better_peers[0]
            
            local_eval["should_bid"] = False
            local_eval["yielded_to"] = best_peer["id"]
            
            reason = []
            if best_peer["reputation"] > 0.9: reason.append("stellar reputation")
            if best_peer["perf_multiplier"] > 1.0: reason.append("superior performance")
            if best_peer["load"] < current_load: reason.append("lower load")
            if best_peer["cpu"] < local_eval["health"]["cpu"] - 20: reason.append("better resource health")
            if not reason: reason.append("better specialization")
            
            local_eval["sass"] = f"Node {best_peer['id']} has {' and '.join(reason)}. I'll let them handle the heavy lifting while I take a nap."
            print(f"🧠 Strategic Yield: Yielding task {task_type} to peer {best_peer['id']} (Conf: {best_peer['confidence']:.2f} > {local_eval['confidence']:.2f}, Rep: {best_peer['reputation']:.2f}, Load: {best_peer['load']} vs {current_load})", flush=True)

        return local_eval

