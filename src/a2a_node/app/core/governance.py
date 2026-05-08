from typing import Dict, Any, Optional, List
import re
from sqlalchemy.future import select
from datetime import datetime, timezone

class GovernanceEngine:
    """
    Determines if a task requires human intervention or approval.
    """
    
    CRITICAL_KEYWORDS = [
        r"\brm\b", r"\bdelete\b", r"\bdrop\b", r"\btruncate\b", # Destructive
        r"\bpublish\b", r"\bdeploy\b", r"\brelease\b", # Deployment
        r"\bpush\b", r"\bcommit\b", r"\breset\s+--hard\b", # Git destructive
        r"\bsudo\b", r"\bchmod\b", r"\bchown\b", # System permissions
        r"\bkill\b", r"\bpkill\b", # Process management
        r"\bapi_key\b", r"\bsecret\b", r"\bpassword\b", r"\btoken\b" # Sensitive data handling
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
        if re.search(r"\b(shell|command|bash|sh)\b", task_type_lower):
            requires_approval = True
            reason = "Direct shell commands always require human oversight in this hive."
            
        # 2. Check for critical keywords in description (using word boundaries)
        for pattern in cls.CRITICAL_KEYWORDS:
            if re.search(pattern, desc_lower):
                requires_approval = True
                reason = f"Destructive or critical keyword matching '{pattern}' detected in task description."
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
                .filter(WorkspaceGrant.expires_at > datetime.now(timezone.utc).replace(tzinfo=None))
            )
            grants = result.scalars().all()
            
            any_allowed = False
            approving_grant_id = None
            approving_profile_id = None

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
                # Deny always wins globally
                is_denied = cls._match_patterns(task_type, description, profile.denied_patterns or [])
                if is_denied:
                    return {
                        "requires_approval": True,
                        "reason": f"Action explicitly denied by capability profile '{profile.id}' under grant '{grant.id}'.",
                        "sass": "One of your minders said 'No'. I'm listening to them."
                    }
                
                # Check if allowed by this grant
                if not any_allowed:
                    is_allowed = cls._match_patterns(task_type, description, profile.allowed_patterns or [])
                    if is_allowed:
                        any_allowed = True
                        approving_grant_id = grant.id
                        approving_profile_id = profile.id

            if any_allowed:
                return {
                    "requires_approval": False,
                    "reason": f"Action pre-approved by capability profile '{approving_profile_id}' under grant '{approving_grant_id}'.",
                    "grant_id": approving_grant_id,
                    "sass": f"Profile '{approving_profile_id}' says I can do this. I'm taking the training wheels off."
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
