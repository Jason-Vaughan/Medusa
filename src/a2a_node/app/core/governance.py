from typing import Dict, Any

class GovernanceEngine:
    """
    Determines if a task requires human intervention or approval.
    """
    
    CRITICAL_KEYWORDS = [
        "rm ", "delete ", "drop ", "truncate ", # Destructive
        "publish", "deploy", "release", # Deployment
        "push ", "commit ", "reset --hard", # Git destructive
        "sudo ", "chmod ", "chown ", # System permissions
        "kill ", "pkill ", # Process management
        "api_key", "secret", "password", "token" # Sensitive data handling
    ]
    
    @classmethod
    def evaluate_task(cls, task_type: str, description: str) -> Dict[str, Any]:
        """
        Evaluates a task for potential risks and returns approval requirements.
        """
        desc_lower = description.lower()
        task_type_lower = task_type.lower()
        
        requires_approval = False
        reason = "Task appears safe for autonomous execution."
        
        # 1. Shell commands are inherently risky
        if task_type_lower in ["shell", "command"]:
            requires_approval = True
            reason = "Direct shell commands always require human oversight in this hive."
            
        # 2. Check for critical keywords in description
        for keyword in cls.CRITICAL_KEYWORDS:
            if keyword in desc_lower:
                requires_approval = True
                reason = f"Destructive or critical keyword '{keyword}' detected in task description."
                break
                
        # 3. Explicit governance overrides (can be expanded)
        if "governance" in task_type_lower:
            requires_approval = True
            reason = "Task explicitly marked for governance review."
            
        return {
            "requires_approval": requires_approval,
            "reason": reason,
            "sass": "I could do this blindly, but I'll let you feel important by asking for permission." if requires_approval else "Boringly safe. Moving on."
        }
