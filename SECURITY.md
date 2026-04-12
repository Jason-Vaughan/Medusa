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

1.  **Local-First:** All coordination happens on your machine or within your local swarm.
2.  **Secret Management:** We never log, print, or commit API keys.
3.  **Encrypted Communication:** All sensitive P2P traffic should use HTTPS (TangleClaw handles this by default).

Thank you for helping keep the swarm secure! 🧠🐝🛡️
