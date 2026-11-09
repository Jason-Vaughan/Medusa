# Efficient Agent-to-Agent Communication: Architecture, Research Plan & Latent Feasibility Study

- **Issue:** [Medusa #71](https://github.com/Jason-Vaughan/Medusa/issues/71)
- **Branch:** `experiment/agent-communication-protocols`
- **Status:** Experimental Research Spike (Isolated from Production Defaults)

---

## 1. Executive Summary & Research Hypothesis

Multi-agent orchestration platforms such as TangleClaw + Medusa exchange hundreds of coordination messages per sprint (task dispatches, exact-head PR review envelopes, multi-finding HOLD reports, A-Gate architectural rulings, dependency updates, and chunk completion receipts). Today, these messages are transmitted as rich English markdown prose (`nl-baseline-v1`).

A recent hackathon demonstration claimed that replacing natural-language agent messages with graph structures yielded dramatic token savings and "zero hallucinations." **We treat both claims with rigorous scientific skepticism:**
1. **Tokenization Reality:** When an LLM communicates via a JSON graph or structured DSL over standard model APIs (Anthropic Messages API, OpenAI Responses/Chat API, Gemini API), the serialized representation is still tokenized into subword tokens by the model's BPE/SentencePiece tokenizer. Verbose JSON keys, repeated node schemas, and UUIDs can easily consume *more* tokens than concise domain notation unless carefully designed.
2. **Hallucination Reality:** Structural or schema validity ($\text{valid}(G) = \text{true}$) only guarantees that a message conforms to a grammar or graph metamodel. It does **not** guarantee semantic truth. An agent can emit a schema-valid graph edge `("PR#69", "CERTIFIED_AT_SHA", "deadbeef")` where `"deadbeef"` does not exist in Git, or claim `("TestSuite", "PASSED", "252/252")` when tests failed, or silently omit a binding constraint (`"bind_host=127.0.0.1"`).

### Primary Hypothesis
> **H1 (Efficiency):** Compact machine-oriented representations that eliminate narrative prose and redundant shared state (`compact-json-v1`, `graph-delta-v1`, and especially `typed-cmd-v1`) can reduce cumulative multi-turn input/output tokens by $\ge 40\%$ compared to natural-language markdown prose (`nl-baseline-v1`), whereas naive full-graph serialization (`graph-v1`) will suffer from structural token overhead on short exchanges.
>
> **H2 (Correctness & Grounding):** Structured codecs paired with **deterministic semantic & state-grounding validators** (checking mandatory fields, constraint retention, state version digests, and authoritative artifact references) can catch both structural omissions and verifiable state contradictions that free-form prose obscures—but **no communication format by itself prevents ungrounded factual hallucinations** without external state verification.

---

## 2. Existing Medusa Architecture & Non-Negotiable Boundaries

### 2.1 Current Medusa Message Flow
1. **Switchboard Hub (`src/medusa/medusa-server.js`):**
   - Exposes `POST /messages/direct`, `POST /messages/broadcast`, `GET /messages/workspace/:id`, `POST /messages/ack`, `GET /messages/workspace/:id/peek`, and `GET /messages/receipts/:idempotencyKey`.
   - Enqueues every direct message into `this.offlineQueues` (durable store-and-forward) and atomically writes `medusa-registry.json` via temp-file-and-rename (`saveRegistry({ throwOnError: true })`) **before** live WebSocket delivery (`Medusa#67` / `PR #69`).
   - Retains messages in the workspace queue even when delivered live over WebSocket until the recipient explicitly calls `POST /messages/ack` (`Medusa#33`, `Medusa#44`, `Medusa#64`).
2. **A2A Mesh Node (`src/a2a_node/`):**
   - Provides SQLAlchemy ledger persistence (`MessageEntry`, `TaskEntry`), HMAC-SHA256 replay protection (`300s` window), and gossip propagation.

### 2.2 Experimental Isolation Boundaries
To ensure zero risk to live TangleClaw + Medusa operations:
1. **Production wire compatibility:** In Medusa, `msgPayload.message` remains a string (or backwards-compatible envelope) and all transport fields (`id`, `from`, `to`, `timestamp`, `idempotencyKey`) remain untouched by codecs.
2. **Authority separation:** Medusa transports, validates, and decodes communication envelopes; **TangleClaw** remains the sole authority for project state, role permissions, holds, and chunk receipts (`TangleClaw#1889`).
3. **Human auditability:** Every experimental codec MUST emit a deterministic `humanAuditText` rendering alongside its compact `wireText` so operators inspecting logs or the TangleClaw UI never lose visibility.
4. **Fail-safe fallback:** Unknown codec IDs or unsupported schema versions fail closed with structured validation errors (`UNSUPPORTED_CODEC`, `SCHEMA_VERSION_MISMATCH`) rather than silently corrupting state.

---

## 3. Candidate Communication Methods (A–F)

### Condition A — Conventional Natural Language (`nl-baseline-v1`)
- **Mechanism:** Standard multi-paragraph English markdown used in current Medusa fleet operations (full prose headers, narrative context, markdown bullet lists, and polite conversational framing).
- **Role:** Control baseline for token count, byte size, latency, and semantic extraction fidelity.

### Condition B — Compact Structured JSON (`compact-json-v1`)
- **Mechanism:** Versioned, schema-validated JSON envelopes using concise canonical keys (`v`, `k` kind, `id`, `s` sender, `r` recipient, `p` payload, `c` constraints, `e` evidence, `ref` artifact references) and omitting narrative boilerplate.
- **Supported Intent Kinds:**
  - `task.assign`, `task.ack`, `review.request`, `review.findings`, `decision.escalate`, `decision.verdict`, `dependency.notify`, `state.update`, `chunk.receipt`, `error.report`.

### Condition C — Property Graph Communication (`graph-v1`)
- **Mechanism:** Represents each message as a self-contained property subgraph $G = (V, E)$:
  - **Nodes ($V$):** Typed entities (`Agent`, `Issue`, `PullRequest`, `Commit`, `File`, `Finding`, `Constraint`, `TestRun`, `Decision`, `TaskCar`).
  - **Edges ($E$):** Directed typed relationships (`ASSIGNED_TO`, `MODIFIES`, `DEPENDS_ON`, `BLOCKS`, `CERTIFIES`, `REJECTS`, `REQUIRES_CONSTRAINT`, `EVIDENCED_BY`).
- **Trade-off under test:** Tests whether explicit relational structure improves multi-hop dependency and constraint tracking vs. whether JSON graph syntax (`nodes`/`edges` arrays) inflates token usage.

### Condition D — Shared State with Graph-Delta Communication (`graph-delta-v1`)
- **Mechanism:** Participants maintain a synchronized, versioned `SharedGraphStore` ($G_0 \xrightarrow{\Delta_1} G_1 \xrightarrow{\Delta_2} \dots \xrightarrow{\Delta_n} G_n$).
- **Wire Payload:** Transmits only:
  - `baseVersion` ($v_{n-1}$), `targetVersion` ($v_n$), `baseDigest`, and `targetDigest` (truncated SHA-256 of canonical graph state).
  - Compact delta operations: `upsertNodes`, `removeNodes`, `upsertEdges`, `removeEdges`, and a lightweight `focus` pointer naming the active event node.
- **Resilience Mechanisms:**
  - **Optimistic Concurrency Detection:** If a sender's `baseVersion` or `baseDigest` does not match the receiver's current state (e.g., concurrent writes from two Builders), `decode()` flags a deterministic `VERSION_CONFLICT` or `DIGEST_MISMATCH`.
  - **Missed-Delta / Reconnect Recovery:** If a participant disconnects and misses $\Delta_k \dots \Delta_{k+m}$, the receiver detects the version gap (`MISSING_BASE_VERSION`) and requests a compact state snapshot or delta range replay.

### Condition E — Typed Commands & Artifact References (`typed-cmd-v1`)
- **Mechanism:** Inspired by functional RPC / CLI grammar and content-addressed references. Represents coordination acts as single-line canonical command expressions with typed key-value arguments and `@ref` pointers:
  ```text
  !v1 review.request id="msg-102" from="Medusa-Lane-A" to="Medusa-PRR" issue=[67,64] pr=69 repo="Jason-Vaughan/Medusa" base="main" head="4c3d6bc" scope=["src/medusa/medusa-server.js","WS_CONSUMER_CONTRACT.md"] tests="15/15:252/252" constraints=["bind=127.0.0.1","hmac_window=300"]
  ```
- **Trade-off under test:** Evaluates whether a grammar designed specifically for BPE token efficiency and zero JSON nesting overhead outperforms both `compact-json-v1` and `graph-v1` while retaining 100% deterministic parseability and validation.

---

## 4. Approach F — Direct Latent Communication Feasibility Study (Research Track)

### 4.1 What Is Direct Latent Communication?
In natural-language or structured-text communication (Approaches A–E), Agent 1 projects its final hidden states $h_t \in \mathbb{R}^{d_{\text{model}}}$ through its unembedding matrix $W_U$ and softmax layer to sample discrete tokens $w_1, \dots, w_k \in \mathcal{V}$, serializes them to UTF-8 bytes, transmits them over HTTP/WebSocket, and Agent 2 re-tokenizes and re-embeds those discrete tokens through $W_E$.

**Direct latent communication** proposes bypassing discrete token decoding (`unembed -> sample -> detokenize -> tokenize -> embed`) by directly transmitting continuous internal representations between agents:
1. **Last-Layer Hidden State / Continuous Thought Vectors (e.g., Coconut, LatentMAS, Soft-Prompt Handoff):** Passing continuous vectors $z_1, \dots, z_m \in \mathbb{R}^d$ directly into the recipient model's input embedding layer (`inputs_embeds`).
2. **KV-Cache Sharing / Prefix Injection:** Sharing key-value attention tensors $\{(K^{(\ell)}, V^{(\ell)})\}_{\ell=1}^L$ across agents running on the same model backbone.
3. **Cross-Model Latent Projection Adapters:** Training a learned linear or MLP projection $P_{A \to B}: \mathbb{R}^{d_A} \to \mathbb{R}^{d_B}$ to map hidden states between two different model architectures.

### 4.2 Critical Evaluation Against Medusa & TangleClaw Requirements

| Evaluation Dimension | Homogenous Open-Weight Models (Same Checkpoint, e.g., Llama-3.3-70B -> Llama-3.3-70B) | Heterogeneous Frontier + Open-Weight Fleet (Claude + Codex + Gemini + Local Open-Weight) |
|---|---|---|
| **Bypasses Natural-Language Tokenization?** | **Yes** (if transferring raw `inputs_embeds` or KV-cache tensors directly between local inference workers). | **No.** Frontier APIs expose only text/token/tool endpoints; any vector serialized over text APIs is worse than text. |
| **Requires Identical Model Architecture & Weights?** | **Yes** for training-free KV-cache or `inputs_embeds` handoff (even a minor fine-tune shifts activation geometry). | **Incompatible without trained adapters.** Different hidden dimensions ($d_{\text{model}}$), layer counts ($L$), attention head layouts (GQA/MLA), and RoPE bases make raw tensors incompatible. |
| **Requires Shared Tokenizer?** | Bypassed for hidden-state steps, though still needed for grounding initial/final text. | N/A (latent spaces are non-isomorphic across model families). |
| **Requires Fine-Tuning or Custom Inference Stack?** | **Yes.** Standard autoregressive models trained on discrete token embeddings often degrade out-of-distribution when fed raw last-layer hidden states without continuous-thought fine-tuning (as shown in Coconut / LatentMAS). Requires custom vLLM/SGLang tensor endpoints. | **Requires per-pair adapter training** ($O(N^2)$ adapters for $N$ model families) retrained on every provider model version bump. |
| **Supported by Current Claude, Codex, or Antigravity Interfaces?** | **No.** | **No.** Neither Anthropic (Claude Code), OpenAI (Codex), nor Google (Antigravity/Gemini) exposes raw residual-stream hidden state export or `inputs_embeds` injection in their agent/chat APIs. |
| **Payload Size & Transport Cost** | **Much larger on the wire than text!** A single token's KV-cache across 80 layers in FP16 can be $160\text{ KB}$–$512\text{ KB}$, whereas a 50-token `typed-cmd-v1` message is $< 300\text{ bytes}$. | Infeasible over JSON/WebSocket switchboards without high-bandwidth tensor IPC (RDMA/gRPC). |
| **Human Inspectability & Governance Auditability** | **Opaque.** Operators and PR Reviewers cannot read raw floating-point tensors without a trained decoder, violating Medusa's human-auditability and TangleClaw's deterministic governance rules. | **Opaque.** Cannot be deterministically verified by runtime security gates (`Rule #282`, `A-Gate`, `R-Gate`). |

### 4.3 Feasibility Verdict on Approach F
1. **Why JSON Graphs Are Not Latent Communication:** Any claim that sending JSON graphs between Claude/Codex/Gemini agents constitutes "latent communication" or "bypasses tokenization" is technically false. JSON graphs are discrete UTF-8 strings processed through the standard BPE tokenizer.
2. **Current Fleet Verdict:** For TangleClaw's multi-provider elastic fleet (`claude`, `codex`, `antigravity`), **direct latent communication is infeasible today** because frontier APIs do not expose continuous `inputs_embeds` or KV-cache ports, latent spaces are non-isomorphic across providers, and opaque vectors break deterministic runtime governance.
3. **Where Latent Communication *Could* Apply in Future Research:** Only inside a homogenous local open-weight sub-swarm (e.g., two local vLLM workers running the exact same checkpoint on the same Apple Silicon / Linux GPU host exchanging prefix KV-caches for shared repo context). Even there, **KV-cache prefix sharing** (reusing prefill compute on shared files) is practical and lossless, whereas free-form continuous latent dialogue requires specialized fine-tuning and sacrifices human auditability.
4. **Actionable Decision:** Do **not** implement fake latent communication in Medusa's runtime codec suite. Instead, focus empirical engineering on **Approaches B (`compact-json-v1`), C (`graph-v1`), D (`graph-delta-v1`), and E (`typed-cmd-v1`)**, which work across **all** model families (`claude`, `codex`, `antigravity`, and open-weight models) today with 100% deterministic auditability.
