from typing import Dict, Any, Optional, List
import re
from sqlalchemy.future import select
from datetime import datetime

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
    async def evaluate_task(cls, task_type: str, description: str, workspace_id: Optional[str] = None, db: Optional[Any] = None) -> Dict[str, Any]:
        """
        Evaluates a task for potential risks and returns approval requirements.
        Supports scoped pre-approval via capability profiles and grants.
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
                
        # 3. Explicit governance overrides
        if "governance" in task_type_lower:
            requires_approval = True
            reason = "Task explicitly marked for governance review."
            
        # 4. Check for Pre-approval Grants
        if requires_approval and workspace_id and db:
            from app.models.ledger import WorkspaceGrant, CapabilityProfile
            
            # Find active grants for this workspace
            result = await db.execute(
                select(WorkspaceGrant)
                .filter(WorkspaceGrant.workspace_id == workspace_id)
                .filter(WorkspaceGrant.revoked == 0)
                .filter(WorkspaceGrant.expires_at > datetime.utcnow())
            )
            grants = result.scalars().all()
            
            for grant in grants:
                # Load profile
                prof_result = await db.execute(
                    select(CapabilityProfile)
                    .filter(CapabilityProfile.id == grant.profile_id)
                    .filter(CapabilityProfile.version == grant.profile_version)
                )
                profile = prof_result.scalars().first()
                if not profile:
                    continue
                
                # Check patterns
                is_denied = cls._match_patterns(task_type, description, profile.denied_patterns or [])
                if is_denied:
                    reason = f"Action explicitly denied by capability profile '{profile.id}'."
                    requires_approval = True
                    break # Deny always wins
                
                is_allowed = cls._match_patterns(task_type, description, profile.allowed_patterns or [])
                if is_allowed:
                    requires_approval = False
                    reason = f"Action pre-approved by capability profile '{profile.id}' under grant '{grant.id}'."
                    return {
                        "requires_approval": False,
                        "reason": reason,
                        "grant_id": grant.id,
                        "sass": f"Profile '{profile.id}' says I can do this. I'm taking the training wheels off."
                    }

        return {
            "requires_approval": requires_approval,
            "reason": reason,
            "sass": "I could do this blindly, but I'll let you feel important by asking for permission." if requires_approval else "Boringly safe. Moving on."
        }

    @staticmethod
    def _match_patterns(task_type: str, description: str, patterns: List[Dict[str, Any]]) -> bool:
        """
        Matches a task against a list of pattern objects {tool, commandPattern}.
        """
        for p in patterns:
            tool_pattern = p.get("tool", ".*")
            cmd_pattern = p.get("commandPattern", ".*")
            
            # Match tool/task_type
            if not re.search(tool_pattern, task_type, re.IGNORECASE):
                continue
                
            # Match description/command
            if re.search(cmd_pattern, description, re.IGNORECASE):
                return True
        return False
