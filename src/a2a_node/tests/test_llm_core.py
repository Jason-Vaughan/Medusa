import pytest
import json
from unittest.mock import patch, AsyncMock, MagicMock
from app.core.llm import LLMService

@pytest.mark.asyncio
async def test_call_anthropic_success():
    with patch("app.core.llm.httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "content": [{"text": "Anthropic response"}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        
        with patch("app.core.llm.settings") as mock_settings:
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            mock_settings.LLM_MODEL = "claude-3-haiku"
            
            result = await LLMService._call_anthropic("sys", "user")
            assert result == "Anthropic response"

@pytest.mark.asyncio
async def test_call_anthropic_failure():
    with patch("app.core.llm.httpx.AsyncClient.post") as mock_post:
        mock_post.side_effect = Exception("API error")
        
        with patch("app.core.llm.settings") as mock_settings:
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            result = await LLMService._call_anthropic("sys", "user")
            assert result is None

@pytest.mark.asyncio
async def test_call_openai_success():
    with patch("app.core.llm.httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "OpenAI response"}}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        
        with patch("app.core.llm.settings") as mock_settings:
            mock_settings.OPENAI_API_KEY = "test-key"
            
            result = await LLMService._call_openai("sys", "user")
            assert result == "OpenAI response"

@pytest.mark.asyncio
async def test_get_completion_fallback():
    # Mock Anthropic to fail and OpenAI to succeed
    with patch("app.core.llm.LLMService._call_anthropic", return_value=None):
        with patch("app.core.llm.LLMService._call_openai", return_value="Fallback Success"):
            with patch("app.core.llm.settings") as mock_settings:
                mock_settings.LLM_PROVIDER = "anthropic"
                
                result = await LLMService.get_completion("sys", "user")
                assert result == "Fallback Success"

@pytest.mark.asyncio
async def test_decompose_task_json_parsing():
    json_response = '{"subtasks": [{"task_type": "test", "description": "sub"}]}'
    with patch("app.core.llm.LLMService.get_completion", return_value=f"Here is your JSON: {json_response}"):
        result = await LLMService.decompose_task("desc")
        assert len(result["subtasks"]) == 1
        assert result["subtasks"][0]["task_type"] == "test"

@pytest.mark.asyncio
async def test_get_completion_retry():
    with patch("app.core.llm.LLMService._call_anthropic") as mock_anthropic:
        mock_anthropic.side_effect = [None, "Success after retry"]
        with patch("app.core.llm.settings") as mock_settings:
            mock_settings.LLM_PROVIDER = "anthropic"
            with patch("app.core.llm.asyncio.sleep", return_value=None):
                result = await LLMService.get_completion("sys", "user", max_retries=1)
                assert result == "Success after retry"
                assert mock_anthropic.call_count == 2
