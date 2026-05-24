# 🔒 Security Policy

## 🛡️ Reporting a Vulnerability

If you find a security vulnerability in Medusa, we want to know about it. Please don't blast it on social media; tell the swarm directly.

To report a vulnerability:
1.  **Email:** `jason@vaughan.io` (This is the lead maintainer).
2.  **Encrypted:** If you prefer PGP, my key is available on common key servers.

Please include:
*   A description of the vulnerability.
*   The affected version(s).
*   A Proof of Concept (PoC) or steps to reproduce.

We will acknowledge your report within 48 hours and provide a timeline for a fix.

## 🚫 What Is Not a Vulnerability?

Medusa is a local-first coordination tool.
*   **Physical Access:** If someone has physical access to your machine, they can see your Medusa config. That's on you.
*   **Environment Variables:** If you leak your `OPENAI_API_KEY` or `A2A_SECRET`, that's a user error.
*   **Default Secrets:** The default `A2A_SECRET` is `medusa-please`. We recommend changing this in production, but it's not a vulnerability in the tool itself.

## 🧪 Security Principles

1.  **Local-First / Loopback-Only (v1.0):** Medusa v1.0 is designed for local-first coordination. By default, all services (Medusa Server and A2A Nodes) bind strictly to `127.0.0.1`.
2.  **Multi-Host Trust:** If you need to coordinate across machines in v1.0, you MUST use a secure network layer. Recommended options in order of simplicity:
    *   **VPN / Tailscale:** Use a private overlay network where all nodes trust each other via the encrypted tunnel.
    *   **Nginx Reverse Proxy:** Use Nginx with `ssl_verify_client on` (client certificates) to gate access.
    *   **Stunnel:** Wrap the loopback ports in a TLS tunnel.
    Native asymmetric identity and end-to-end encryption are deferred to v1.1.
3.  **HMAC Integrity:** All mesh communication is signed using HMAC-SHA256 with a 5-minute replay protection window. This ensures message integrity but not confidentiality on the wire (hence the TLS requirement for non-loopback traffic).
4.  **Secret Management:** We never log, print, or commit API keys. The `A2A_SECRET` should be treated as a sensitive credential.

## 🔑 Secret Management Guidance

### A2A_SECRET Generation
Never use the default `medusa-please` outside of a quick local test. Generate a strong, unique secret for your swarm:
```bash
openssl rand -hex 32
```

### Storage
Store secrets in environment variables managed by your process manager (e.g., `systemd` Environment, Docker env files, or `.env` files that are EXPLICITLY ignored by git). Never commit secrets to your repository.

## 🔄 Secret Rotation Policy

To rotate the `A2A_SECRET` in v1.0:
1.  Stop the Medusa server and all A2A nodes.
2.  Update the `A2A_SECRET` on all nodes.
3.  Restart the services.

**Note:** v1.0 requires a full mesh restart for rotation. Zero-downtime rolling rotation is a v1.1 roadmap item. In-flight tasks will fail if nodes have mismatched secrets during the transition.

## 🌐 Opt-In Network Binding
If you have secured your network layer (e.g., via Tailscale) and need to bind to a physical interface, use the following overrides:
*   **A2A Node:** Set `A2A_HOST=0.0.0.0` (or a specific IP).
*   **Medusa Server:** Set `MEDUSA_PROTOCOL_HOST=0.0.0.0` and `MEDUSA_WEB_HOST=0.0.0.0`.

Thank you for helping keep the swarm secure! 🧠🐝🛡️
