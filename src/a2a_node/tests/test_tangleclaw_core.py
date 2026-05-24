import pytest
from unittest.mock import patch, MagicMock
from app.core.tangleclaw import register_port, release_port
from app.core.config import settings

@patch("app.core.tangleclaw.requests.post")
def test_register_port_success(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_post.return_value = mock_response
    
    with patch("app.core.tangleclaw.settings") as mock_settings:
        mock_settings.PORT = 3200
        register_port()
        
    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert kwargs["json"]["port"] == 3200
    assert kwargs["verify"] is False

@patch("app.core.tangleclaw.requests.post")
def test_register_port_failure(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_post.return_value = mock_response
    
    with patch("app.core.tangleclaw.settings") as mock_settings:
        mock_settings.PORT = 3200
        register_port()
        
    mock_post.assert_called_once()

@patch("app.core.tangleclaw.requests.post")
def test_register_port_exception(mock_post):
    mock_post.side_effect = Exception("Connection refused")
    
    with patch("app.core.tangleclaw.settings") as mock_settings:
        mock_settings.PORT = 3200
        register_port()
        
    mock_post.assert_called_once()

@patch("app.core.tangleclaw.requests.post")
def test_release_port(mock_post):
    with patch("app.core.tangleclaw.settings") as mock_settings:
        mock_settings.PORT = 3200
        release_port()
        
    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert kwargs["json"]["port"] == 3200
