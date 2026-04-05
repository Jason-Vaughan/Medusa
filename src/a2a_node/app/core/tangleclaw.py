import requests
from .config import settings

TANGLECLAW_URL = "https://localhost:3102/api/ports"
_reg_failed_once = False

def register_port():
    global _reg_failed_once
    payload = {
        "port": settings.PORT,
        "project": "Medusa",
        "service": "a2a-node",
        "permanent": True
    }
    try:
        # Use verify=False for self-signed cert
        response = requests.post(f"{TANGLECLAW_URL}/lease", json=payload, timeout=2.0, verify=False)
        if response.status_code in [200, 201]:
            print(f"✅ Port {settings.PORT} registered with TangleClaw (HTTPS).", flush=True)
        else:
            if not _reg_failed_once:
                print(f"⚠️ TangleClaw registration failed (Muted). Status: {response.status_code}", flush=True)
                _reg_failed_once = True
    except Exception as e:
        if not _reg_failed_once:
            print(f"⚠️ TangleClaw connection failed (HTTPS): {str(e)}", flush=True)
            _reg_failed_once = True

def release_port():
    payload = {"port": settings.PORT}
    try:
        requests.post(f"{TANGLECLAW_URL}/release", json=payload)
    except:
        pass
