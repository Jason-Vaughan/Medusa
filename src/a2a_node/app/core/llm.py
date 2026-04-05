import json
import logging
import httpx
from typing import Dict, Any, Optional
from .config import settings

logger = logging.getLogger(__name__)

class LLMService:
    """
    Service to handle LLM completions with multi-provider fallback.
    Supports Anthropic and OpenAI.
    """
    
    @staticmethod
    async def get_completion(system_prompt: str, user_prompt: str) -> Optional[str]:
        """
        Main entry point for LLM completions.
        Uses preferred provider and falls back to other if one fails.
        """
        provider = settings.LLM_PROVIDER.lower()
        
        if provider == "anthropic":
            result = await LLMService._call_anthropic(system_prompt, user_prompt)
            if not result:
                logger.warning("⚠️ Anthropic failed. Falling back to OpenAI.")
                result = await LLMService._call_openai(system_prompt, user_prompt)
            return result
        else:
            result = await LLMService._call_openai(system_prompt, user_prompt)
            if not result:
                logger.warning("⚠️ OpenAI failed. Falling back to Anthropic.")
                result = await LLMService._call_anthropic(system_prompt, user_prompt)
            return result

    @staticmethod
    async def _call_anthropic(system_prompt: str, user_prompt: str) -> Optional[str]:
        """
        Calls Anthropic Claude API.
        """
        if not settings.ANTHROPIC_API_KEY:
            logger.error("❌ ANTHROPIC_API_KEY is not set.")
            return None
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": settings.ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": settings.LLM_MODEL,
                        "system": system_prompt,
                        "messages": [{"role": "user", "content": user_prompt}],
                        "max_tokens": 1024,
                        "temperature": 0.7
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                data = response.json()
                return data["content"][0]["text"]
        except Exception as e:
            logger.error(f"❌ Anthropic API error: {str(e)}")
            return None

    @staticmethod
    async def _call_openai(system_prompt: str, user_prompt: str) -> Optional[str]:
        """
        Calls OpenAI GPT API.
        """
        if not settings.OPENAI_API_KEY:
            logger.error("❌ OPENAI_API_KEY is not set.")
            return None
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "gpt-4o-mini", # Standard mini model for speed
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "max_tokens": 1024,
                        "temperature": 0.7,
                        "response_format": {"type": "json_object"} if "json" in system_prompt.lower() else {"type": "text"}
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            logger.error(f"❌ OpenAI API error: {str(e)}")
            return None

    @classmethod
    async def decompose_task(cls, description: str, context: Optional[str] = None) -> Dict[str, Any]:
        """
        Specialized helper for task decomposition.
        """
        from .prompts import DECOMPOSITION_SYSTEM_PROMPT, DECOMPOSITION_USER_PROMPT
        
        user_prompt = DECOMPOSITION_USER_PROMPT.format(
            description=description,
            context=context or "No extra context provided."
        )
        
        response = await cls.get_completion(DECOMPOSITION_SYSTEM_PROMPT, user_prompt)
        
        if not response:
            return {"subtasks": []}
            
        try:
            # Handle potential JSON prefix/suffix if LLM didn't strictly output JSON
            start = response.find("{")
            end = response.rfind("}") + 1
            if start != -1 and end != -1:
                clean_json = response[start:end]
                return json.loads(clean_json)
            return {"subtasks": []}
        except Exception as e:
            logger.error(f"❌ Failed to parse LLM decomposition JSON: {str(e)}")
            return {"subtasks": []}
