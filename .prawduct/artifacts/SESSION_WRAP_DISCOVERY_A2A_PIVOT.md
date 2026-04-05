# Session Wrap Artifact: Discovery & Planning - The A2A Pivot (v0.6.0)

**Date:** 2026-03-25  
**Session Goal:** Complete Discovery & Planning for the new BiTCH architecture.

## 🏁 Summary of Decisions
- **Pivot:** Abandoned the file-based `/loop` system and the centralized Medusa server.
- **Protocol:** Adopted the **Agent2Agent (A2A)** standard (Linux Foundation) for P2P AI communication.
- **Language:** Chose **Python** for the BiTCH Node (Daemon) for its robust AI ecosystem and FastAPI performance.
- **Storage:** Replacing text-file messaging with a **SQLite Ledger** to handle concurrent task state and conversation history.

## 📦 Next Chunk (Chunk 1: The Foundation)
- **Objective:** Initialize the Python environment and build the core FastAPI A2A Node.
- **Key Deliverable:** `/.well-known/agent-card.json` (A2A Discovery Endpoint).
- **Architecture:** Local Mesh/P2P (each workspace runs a BiTCH Node).

## 💡 Independent Critic Pass (Self-Criticism)
- **Risk:** Python adds another dependency for users who expect a pure Node.js project.
- **Mitigation:** We will bundle the Python daemon as a self-contained environment (using `venv`) and manage its lifecycle via the existing BiTCH CLI (Node.js).
- **Risk:** A2A protocol is still maturing (Draft v1.0).
- **Mitigation:** We will implement the core JSON-RPC task endpoints first to ensure basic functionality before moving to advanced streaming features.

---
**Status:** Planning Complete. Ready for Implementation in Session 2.
