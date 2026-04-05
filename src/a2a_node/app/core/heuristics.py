from typing import List, Dict, Any, Optional
from datetime import datetime
from app.core.config import settings

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
    def evaluate_task(cls, task_type: str, description: str) -> Dict[str, Any]:
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
            
        # 3. Decision
        # If confidence is high enough, or if it's a generic task
        should_bid = confidence >= 0.6 or len(description.split()) > 10
        
        # 4. Bid Value (Cost/Time)
        # Base value 1.0, decreased by skills (lower is better/faster)
        bid_value = 1.0 - (0.1 * len(matched_skills))

        return {
            "should_bid": should_bid,
            "confidence": min(confidence, 1.0),
            "bid_value": max(bid_value, 0.1),
            "matched_skills": matched_skills,
            "sass": "I suppose I could do this better than anyone else." if should_bid else "This is beneath my specialized talents."
        }

    @classmethod
    def evaluate_decomposition(cls, task_type: str, description: str) -> Dict[str, Any]:
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
        
        should_decompose = has_keywords or (is_long and "and" in desc_lower) or is_multi_step
        
        return {
            "should_decompose": should_decompose,
            "reason": "Complex multi-step request detected." if should_decompose else "Task appears atomic.",
            "sass": "This is a bit much for one node. Let's make it a team effort." if should_decompose else "I can handle this myself, thanks."
        }

    @classmethod
    def share_heuristic(cls) -> Dict[str, Any]:
        """
        Returns a summary of the node's current problem-solving heuristics.
        To be used for collective strategy sharing.
        """
        return {
            "strategy": "skill-priority",
            "skills": cls.get_local_skills(),
            "min_confidence": 0.6,
            "timestamp": datetime.utcnow().isoformat()
        }

    @classmethod
    def evaluate_with_swarm_intelligence(cls, task_type: str, description: str, peers: List[Any]) -> Dict[str, Any]:
        """
        Evaluates a task while considering the strategies of other nodes in the swarm.
        Implements 'Strategic Yield' - yielding to nodes with better specialized strategies.
        """
        # 1. Local Evaluation
        local_eval = cls.evaluate_task(task_type, description)

        # 2. Peer Strategy Analysis
        better_peers = []
        for peer in peers:
            strategies = peer.strategies or {}
            peer_skills = strategies.get("skills", [])

            # Check if peer has a better skill match for this task
            peer_matches = 0
            for skill in peer_skills:
                skill_lower = skill.lower()
                if skill_lower in task_type.lower() or skill_lower in description.lower():
                    peer_matches += 1

            peer_confidence = strategies.get("min_confidence", 0.5) + (0.1 * peer_matches)

            if peer_confidence > local_eval["confidence"]:
                better_peers.append({
                    "id": peer.id,
                    "confidence": peer_confidence,
                    "skills": peer_skills
                })

        # 3. Strategic Yield Decision
        if better_peers and local_eval["should_bid"]:
            # We have a match, but someone else is better suited
            # If our confidence is high but someone else's is HIGHER, we yield
            # Unless it's a critical priority or we are already under-loaded (TODO)
            local_eval["should_bid"] = False
            local_eval["yielded_to"] = better_peers[0]["id"]
            local_eval["sass"] = f"Node {better_peers[0]['id']} seems more qualified for this. I'll allow them to fail first."
            print(f"🧠 Strategic Yield: Yielding task {task_type} to peer {better_peers[0]['id']} (Confidence: {better_peers[0]['confidence']:.2f} > {local_eval['confidence']:.2f})", flush=True)

        return local_eval

