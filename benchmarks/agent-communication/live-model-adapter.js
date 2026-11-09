'use strict';

/**
 * Live & Offline Multi-Model Codec Evaluation Adapter (`Medusa#74`).
 *
 * Evaluates every registered codec by asking a model to reproduce a codec-encoded wire message
 * and scoring the result on schema adherence, constraint retention, and round-trip semantic
 * fidelity. Two evaluation paths:
 *
 * - **Monad-1 open-weight models** (`gpt-oss:120b`, `qwen3-coder-next:q4_K_M`, `qwen3.6:35b-a3b`)
 *   are queried live over HTTP against an Ollama-compatible `/api/chat` endpoint (default
 *   `http://monad-1.tail123678.ts.net:11435`), via an injectable `transport` function so tests
 *   never make a real network call.
 * - **Frontier engine profiles** (`claude`, `codex`, `antigravity`) have no live completion
 *   endpoint wired into this harness, so they are always evaluated deterministically against
 *   the codec's own encode/decode output (`mode: 'frontier-deterministic'`) — a reproducible
 *   ground-truth comparison point, never a fabricated "live" call to an endpoint this harness
 *   does not actually have credentials or wiring for.
 *
 * `runMatrix({ offline: true })` (the default) never touches the network: Monad-1 rows also run
 * through the same deterministic path as frontier rows, so `npm test` is 100% offline.
 */

const { CodecRegistry, validateCanonicalMessage, HEAVY_FIELDS, isArtifactPointer } = require('../../src/medusa/experiments/codecs');
const { BENCHMARK_SCENARIOS } = require('./scenarios');
const { measureSemanticPreservation, createCodecState } = require('./harness');

const DEFAULT_BASE_URL = 'http://monad-1.tail123678.ts.net:11435';
const DEFAULT_TIMEOUT_MS = 30000;

const MONAD1_MODELS = ['gpt-oss:120b', 'qwen3-coder-next:q4_K_M', 'qwen3.6:35b-a3b'];
const FRONTIER_PROFILES = ['claude', 'codex', 'antigravity'];

/**
 * Concise 7-field canonical message used for live model probes instead of a full 20-field
 * benchmark scenario message: a `graph-v1`/`nl-baseline-v1` encoding of the latter runs
 * 450-850 tokens, which truncates well before `numPredict` on a live run.
 */
const DEFAULT_LIVE_SAMPLE_MESSAGE = {
  id: 'live-probe-01',
  kind: 'task.ack',
  from: 'Medusa-Lane-B',
  to: 'Medusa-PM',
  status: 'working',
  constraints: ['bind_host=127.0.0.1', 'no_force_push=true'],
  summary: 'Implementing codec negotiation with full schema validation.'
};

/**
 * Builds a synchronized encode/decode context pair for a codec, a reference envelope for
 * `message`, and a one-shot example (a DIFFERENT message encoded in its own independent fresh
 * context) that `buildPrompt` can show the model as a concrete wire-grammar demonstration.
 *
 * Both `encodeContext` and `decodeContext` come from `createCodecState`, so for a stateful codec
 * they start at the identical pre-encode baseline (fresh symbol table / v0 store) — the same
 * baseline the model is implicitly told it's starting a conversation from, so what `decode()`
 * checks the model's reply against matches what the model was actually asked to do.
 *
 * `blackboard-ref-v1` is a deliberate exception: its wire payload carries only an opaque
 * `@art:<sha256_12>` pointer for each heavy field, never the underlying value — there is no
 * self-contained delta a fresh, unseeded decode-side store could ever resolve, unlike every
 * other stateful codec here (`dict-intern-v1`'s `newSymbols`, `json-patch-v1`/`graph-delta-v1`'s
 * versioned delta). So for this one codec, `decodeContext.store` is literally the same
 * `BlackboardStore` instance `encodeContext` just wrote the sample's artifacts into — otherwise
 * no candidate, model or ground-truth alike, could ever decode successfully.
 *
 * @param {object} codec - `BaseCodec` instance.
 * @param {string} codecId - The codec's `capabilities().id`.
 * @param {object} message - The target message to evaluate.
 * @returns {{ encodeContext: object, decodeContext: object, referenceEnvelope: object, exampleMessage: object, exampleWireText: string }}
 */
function prepareEvaluationContext(codec, codecId, message) {
  const exampleMessage = {
    id: 'example-prior-turn',
    kind: 'task.ack',
    from: 'Medusa-Lane-A',
    to: 'Medusa-PM',
    status: 'working',
    constraints: ['example_rule=true'],
    summary: 'Example prior turn shown only to demonstrate the wire grammar.'
  };
  const exampleWireText = codec.encode(exampleMessage, createCodecState(codecId)).wireText;

  const encodeContext = createCodecState(codecId);
  const referenceEnvelope = codec.encode(message, encodeContext);
  const decodeContext = codecId === 'blackboard-ref-v1' ? { store: encodeContext.store } : createCodecState(codecId);

  return { encodeContext, decodeContext, referenceEnvelope, exampleMessage, exampleWireText };
}

/**
 * Strips a single leading/trailing Markdown code fence (` ``` ` or ` ```lang `) a model sometimes
 * wraps its reply in, so `decode()` sees only the wire text itself.
 *
 * @param {string} text - Raw model response text.
 * @returns {string} Fence-stripped, trimmed text.
 */
function stripMarkdownFences(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Builds the precomputed cryptographic digest/pointer hint lines a model cannot derive on its
 * own (it cannot compute SHA-256 through pure text generation) for the 3 codecs whose wire
 * format embeds one: `blackboard-ref-v1` (`@art:<sha256_12>` pointers), `json-patch-v1`
 * (`base_hash`/`target_hash`), and `graph-delta-v1` (`bd`/`td`).
 *
 * @param {string} codecId - The codec's `capabilities().id`.
 * @param {{ encodeContext: object, referenceEnvelope: object }} evalCtx - Context from `prepareEvaluationContext`.
 * @returns {string[]} Hint lines, or `[]` for a codec with no embedded digest.
 */
function buildDigestHints(codecId, evalCtx) {
  if (codecId === 'blackboard-ref-v1') {
    const fields = evalCtx.referenceEnvelope.payload.fields;
    const pointerLines = HEAVY_FIELDS.filter((field) => isArtifactPointer(fields[field])).map(
      (field) => `  ${field} -> "${fields[field]}"`
    );
    if (pointerLines.length === 0) return [];
    return ['Pre-stored blackboard pointers for this message (use these exact pointer strings, do not invent new ones):', ...pointerLines];
  }

  if (codecId === 'json-patch-v1') {
    const { base_hash: baseHash, target_hash: targetHash } = evalCtx.referenceEnvelope.payload;
    return [`Pre-computed register hashes for this turn: base_hash="${baseHash}", target_hash="${targetHash}"`];
  }

  if (codecId === 'graph-delta-v1') {
    const { bd, td } = evalCtx.referenceEnvelope.payload;
    return [`Pre-computed graph digests for this turn: bd="${bd}", td="${td}"`];
  }

  return [];
}

/**
 * Builds the instruction prompt asking a model to reproduce `message` in `codec`'s wire format.
 * When `evalCtx` (from `prepareEvaluationContext`) is supplied, the prompt includes a concrete
 * one-shot example turn so the model can see the exact wire grammar rather than guessing it from
 * a one-line description, plus precomputed digest/pointer hints for the 3 codecs whose wire
 * format embeds a cryptographic digest the model has no way to compute itself.
 *
 * @param {object} codec - `BaseCodec` instance.
 * @param {object} message - Canonical semantic message to encode.
 * @param {{ exampleMessage?: object, exampleWireText?: string }} [evalCtx] - Optional context from `prepareEvaluationContext`.
 * @param {string} [codecId] - The codec's `capabilities().id`, for selecting digest hints. Defaults to `codec.capabilities().id`.
 * @returns {string} Prompt text.
 */
function buildPrompt(codec, message, evalCtx, codecId) {
  const caps = codec.capabilities();
  const resolvedCodecId = codecId || caps.id;
  const lines = [
    `You are encoding an inter-agent coordination message using the "${caps.id}" wire format.`,
    `Format description: ${caps.description}`
  ];

  if (evalCtx && evalCtx.exampleWireText) {
    lines.push(
      '',
      'Example — a different message encoded in this exact wire format (for grammar reference only):',
      `Input: ${JSON.stringify(evalCtx.exampleMessage)}`,
      `Wire output: ${evalCtx.exampleWireText}`
    );
  }

  if (evalCtx && evalCtx.referenceEnvelope) {
    const hints = buildDigestHints(resolvedCodecId, evalCtx);
    if (hints.length > 0) {
      lines.push('', ...hints);
    }
  }

  lines.push(
    '',
    'Now encode this message the same way. Reply with ONLY the wire text, no commentary, no Markdown code fences:',
    JSON.stringify(message)
  );

  return lines.join('\n');
}

/**
 * Scores a candidate wire-text response against `codec` and the original `message`: whether it
 * decodes and validates structurally (`schemaAdherencePct`), whether every `constraints` entry
 * survived (`constraintRetentionPct`), and field-level round-trip fidelity (`roundTripSemanticPct`).
 *
 * @param {object} codec - `BaseCodec` instance.
 * @param {object} message - Original canonical message.
 * @param {string} wireText - Candidate wire text to score.
 * @param {object} [decodeContext={}] - Context to pass to `codec.decode()`. For stateful codecs
 *   this mutates shared state exactly once (never re-decoded), since a second `decode()` of the
 *   same delta against an already-advanced store/register would spuriously fail as a version
 *   conflict rather than reflect a real schema problem.
 * @returns {{ schemaAdherencePct: number, constraintRetentionPct: number, roundTripSemanticPct: number, decodedOk: boolean }}
 */
function scoreCandidate(codec, message, wireText, decodeContext = {}) {
  const decoded = codec.decode(wireText, decodeContext);
  if (!decoded.ok || !decoded.message) {
    return { schemaAdherencePct: 0, constraintRetentionPct: 0, roundTripSemanticPct: 0, decodedOk: false };
  }

  // Validate the already-decoded message directly (a pure structural check), rather than
  // calling codec.validate() — which would decode() a second time against the same context.
  const structural = validateCanonicalMessage(decoded.message);
  const fidelity = measureSemanticPreservation(message, decoded.message);
  const hallucinatedExtraField = fidelity.mismatches.some((m) => m.startsWith('Extra unexpected field'));

  // A model that invents a field never sent is hallucinating, not just imperfectly structured —
  // it must never score full schema adherence, even if every field it was asked for is present.
  const schemaAdherencePct = structural.structuralValid && !hallucinatedExtraField ? 100 : 0;

  const constraintRetentionPct =
    message.constraints === undefined || JSON.stringify(message.constraints) === JSON.stringify(decoded.message.constraints)
      ? 100
      : 0;

  return {
    schemaAdherencePct,
    constraintRetentionPct,
    roundTripSemanticPct: fidelity.scorePct,
    decodedOk: true
  };
}

/**
 * Multi-model (frontier + Monad-1 open-weight) codec evaluation adapter.
 */
class LiveModelAdapter {
  /**
   * @param {object} [options={}] - Adapter configuration.
   * @param {string} [options.baseUrl] - Ollama-compatible base URL for Monad-1.
   * @param {number} [options.timeoutMs] - Per-request timeout in milliseconds.
   * @param {Function} [options.transport] - `(url, requestInit) => Promise<Response>`-shaped
   *   transport, injected so tests never hit the network. Defaults to global `fetch` if present.
   * @param {CodecRegistry} [options.registry] - Codec registry to evaluate against.
   * @param {Function} [options.frontierProbe] - Optional `(codecId, profile, evalCtx) =>
   *   Promise<{content, promptEvalCount?, evalCount?, wallMs?, evalDurationMs?, tokPerSec?}>`
   *   hook for a genuine recorded or live frontier engine completion. Without it, frontier
   *   profiles always use the deterministic path — this adapter never fabricates frontier
   *   session data on its own.
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.transport = options.transport || (typeof fetch === 'function' ? fetch : null);
    this.registry = options.registry instanceof CodecRegistry ? options.registry : new CodecRegistry();
    this.frontierProbe = typeof options.frontierProbe === 'function' ? options.frontierProbe : null;
  }

  /**
   * Queries a Monad-1 Ollama model live over HTTP for a single chat completion.
   *
   * @param {string} model - Ollama model tag (e.g. `"gpt-oss:120b"`).
   * @param {string} prompt - User prompt text.
   * @param {{ think?: boolean, temperature?: number, numPredict?: number }} [options={}] -
   *   `think: false` disables chain-of-thought where supported; `temperature`/`numPredict` are
   *   forwarded as Ollama's `options.temperature`/`options.num_predict` (e.g. a higher
   *   `numPredict` for a model whose hidden reasoning tokens would otherwise truncate the reply).
   * @returns {Promise<{ ok: boolean, content: string, promptEvalCount: number, evalCount: number, wallMs: number, evalDurationMs: number, tokPerSec: number, error: string|null }>}
   */
  async queryMonad1Model(model, prompt, { think = false, temperature, numPredict } = {}) {
    if (typeof this.transport !== 'function') {
      return {
        ok: false,
        content: '',
        promptEvalCount: 0,
        evalCount: 0,
        wallMs: 0,
        evalDurationMs: 0,
        tokPerSec: 0,
        error: 'No transport available (no injected transport and no global fetch)'
      };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    const wallStart = Date.now();

    try {
      const ollamaOptions = {};
      if (temperature !== undefined) ollamaOptions.temperature = temperature;
      if (numPredict !== undefined) ollamaOptions.num_predict = numPredict;

      const response = await this.transport(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          think,
          ...(Object.keys(ollamaOptions).length > 0 ? { options: ollamaOptions } : {})
        }),
        signal: controller ? controller.signal : undefined
      });

      const wallMs = Date.now() - wallStart;

      if (!response || response.ok === false) {
        const statusText = response && response.statusText ? response.statusText : 'unknown transport error';
        return {
          ok: false,
          content: '',
          promptEvalCount: 0,
          evalCount: 0,
          wallMs,
          evalDurationMs: 0,
          tokPerSec: 0,
          error: `Monad-1 request failed: ${statusText}`
        };
      }

      const body = typeof response.json === 'function' ? await response.json() : response;
      const content = (body.message && body.message.content) || '';
      const promptEvalCount = body.prompt_eval_count || 0;
      const evalCount = body.eval_count || 0;
      const evalDurationMs = (body.eval_duration || 0) / 1e6;
      const tokPerSec = evalDurationMs > 0 ? Number(((evalCount / evalDurationMs) * 1000).toFixed(2)) : 0;

      return { ok: true, content, promptEvalCount, evalCount, wallMs, evalDurationMs, tokPerSec, error: null };
    } catch (err) {
      return {
        ok: false,
        content: '',
        promptEvalCount: 0,
        evalCount: 0,
        wallMs: Date.now() - wallStart,
        evalDurationMs: 0,
        tokPerSec: 0,
        error: err.name === 'AbortError' ? `Timed out after ${this.timeoutMs}ms` : err.message
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Deterministically evaluates a codec against a sample message WITHOUT a network call: the
   * codec's own `encode()` output stands in as the ground-truth response, giving a reproducible
   * upper bound for the structural scores. Used for offline test mode and for every frontier
   * profile, which has no live completion endpoint wired into this harness.
   *
   * No model was actually queried, so the live-telemetry fields (`promptEvalCount`, `evalCount`,
   * `wallMs`, `evalDurationMs`, `tokPerSec`) are `null` rather than a fabricated estimate —
   * reporting a plausible-looking throughput number for a call that never happened would be
   * misleading even if clearly labeled.
   *
   * @param {object} codec - `BaseCodec` instance.
   * @param {object} message - Canonical message to evaluate.
   * @param {object} [decodeContext={}] - Context for `codec.encode()`/`codec.decode()`.
   * @returns {{ schemaAdherencePct: number, constraintRetentionPct: number, roundTripSemanticPct: number, decodedOk: boolean, promptEvalCount: null, evalCount: null, wallMs: null, evalDurationMs: null, tokPerSec: null }}
   */
  evaluateOffline(codec, message, decodeContext = {}) {
    const envelope = codec.encode(message, decodeContext);
    const score = scoreCandidate(codec, message, envelope.wireText, decodeContext);

    return {
      ...score,
      promptEvalCount: null,
      evalCount: null,
      wallMs: null,
      evalDurationMs: null,
      tokPerSec: null
    };
  }

  /**
   * Evaluates one codec against one Monad-1 model: live over HTTP when `offline` is false,
   * otherwise via the deterministic offline path.
   *
   * @param {string} codecId - Registered codec id.
   * @param {string} model - Monad-1 Ollama model tag.
   * @param {{ offline?: boolean, message?: object }} [options={}] - Evaluation options.
   * @returns {Promise<object>} Per-model, per-codec evaluation result.
   */
  async evaluateMonad1(codecId, model, { offline = true, message } = {}) {
    const codec = this.registry.get(codecId);
    if (!codec) throw new Error(`Unknown codec id: "${codecId}"`);

    if (offline) {
      const sample = message || BENCHMARK_SCENARIOS[0].messages[0];
      const decodeContext = createCodecState(codecId);
      return { model, codecId, mode: 'offline', error: null, ...this.evaluateOffline(codec, sample, decodeContext) };
    }

    // The concise 7-field live-probe message, not a full 20-field scenario message: the latter's
    // graph-v1/nl-baseline-v1 encoding runs 450-850 tokens, which truncates before numPredict.
    const sample = message || DEFAULT_LIVE_SAMPLE_MESSAGE;
    const evalCtx = prepareEvaluationContext(codec, codecId, sample);
    const prompt = buildPrompt(codec, sample, evalCtx, codecId);
    // num_predict per Suite A/B findings in docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md:
    // gpt-oss:120b spends ~130-200 tokens on hidden reasoning before its visible reply even with
    // think: false, so it needs a much larger cap than the other two models.
    const result = await this.queryMonad1Model(model, prompt, {
      think: false,
      temperature: 0,
      numPredict: model === 'gpt-oss:120b' ? 700 : 350
    });
    if (!result.ok) {
      return {
        model,
        codecId,
        mode: 'live',
        schemaAdherencePct: 0,
        constraintRetentionPct: 0,
        roundTripSemanticPct: 0,
        decodedOk: false,
        promptEvalCount: result.promptEvalCount,
        evalCount: result.evalCount,
        wallMs: result.wallMs,
        evalDurationMs: result.evalDurationMs,
        tokPerSec: result.tokPerSec,
        error: result.error
      };
    }

    const cleanedContent = stripMarkdownFences(result.content);
    const score = scoreCandidate(codec, sample, cleanedContent, evalCtx.decodeContext);
    return {
      model,
      codecId,
      mode: 'live',
      ...score,
      promptEvalCount: result.promptEvalCount,
      evalCount: result.evalCount,
      wallMs: result.wallMs,
      evalDurationMs: result.evalDurationMs,
      tokPerSec: result.tokPerSec,
      error: null
    };
  }

  /**
   * Evaluates one codec against one frontier engine profile.
   *
   * Without a `frontierProbe` hook (the default), always runs the deterministic offline path
   * (`mode: 'frontier-deterministic'`) regardless of `offline` — this adapter ships no fabricated
   * "recorded" frontier session data, since no such real recordings exist in this repository.
   * When the caller injects a real `frontierProbe` (a genuine recorded or live completion from
   * that engine) AND passes `offline: false`, its result is scored and reported as
   * `mode: 'frontier-session-probe'`.
   *
   * @param {string} codecId - Registered codec id.
   * @param {string} profile - Frontier engine profile name (`"claude"`/`"codex"`/`"antigravity"`).
   * @param {{ message?: object, offline?: boolean }} [options={}] - Evaluation options.
   * @returns {Promise<object>} Per-profile, per-codec evaluation result.
   */
  async evaluateFrontierProfile(codecId, profile, { message, offline = true } = {}) {
    const codec = this.registry.get(codecId);
    if (!codec) throw new Error(`Unknown codec id: "${codecId}"`);
    const sample = message || BENCHMARK_SCENARIOS[0].messages[0];

    if (offline || typeof this.frontierProbe !== 'function') {
      const decodeContext = createCodecState(codecId);
      return {
        model: profile,
        codecId,
        mode: 'frontier-deterministic',
        error: null,
        ...this.evaluateOffline(codec, sample, decodeContext)
      };
    }

    const evalCtx = prepareEvaluationContext(codec, codecId, sample);
    const probeResult = await this.frontierProbe(codecId, profile, evalCtx);
    const cleanedContent = stripMarkdownFences(probeResult.content);
    const score = scoreCandidate(codec, sample, cleanedContent, evalCtx.decodeContext);

    return {
      model: profile,
      codecId,
      mode: 'frontier-session-probe',
      ...score,
      promptEvalCount: probeResult.promptEvalCount ?? null,
      evalCount: probeResult.evalCount ?? null,
      wallMs: probeResult.wallMs ?? null,
      evalDurationMs: probeResult.evalDurationMs ?? null,
      tokPerSec: probeResult.tokPerSec ?? null,
      error: null
    };
  }

  /**
   * Runs the full matrix: every selected codec against every frontier profile and every
   * Monad-1 model.
   *
   * @param {{ offline?: boolean, codecIds?: string[], frontierProfiles?: string[], monad1Models?: string[] }} [options={}] - Matrix options.
   * @returns {Promise<{ generatedAt: string, mode: string, rows: object[] }>}
   */
  async runMatrix(options = {}) {
    const offline = options.offline !== false;
    const codecIds = options.codecIds || this.registry.listCapabilities().map((c) => c.id);
    const frontierProfiles = options.frontierProfiles || FRONTIER_PROFILES;
    const monad1Models = options.monad1Models || MONAD1_MODELS;

    const rows = [];
    for (const codecId of codecIds) {
      for (const profile of frontierProfiles) {
        // eslint-disable-next-line no-await-in-loop
        rows.push(await this.evaluateFrontierProfile(codecId, profile, { offline }));
      }
    }

    // Grouped by model (outer loop), not by codec: on a live run this is the order Ollama
    // actually serves requests in, so each Monad-1 model loads into VRAM once instead of being
    // swapped in and out once per codec (27 swaps instead of 3).
    for (const model of monad1Models) {
      for (const codecId of codecIds) {
        // eslint-disable-next-line no-await-in-loop
        rows.push(await this.evaluateMonad1(codecId, model, { offline }));
      }
    }

    return { generatedAt: new Date().toISOString(), mode: offline ? 'offline-deterministic' : 'live', rows };
  }
}

/**
 * Renders a `runMatrix()` result as a Markdown report comparing every codec across frontier
 * profiles and Monad-1 open-weight models.
 *
 * @param {{ generatedAt: string, mode: string, rows: object[] }} matrix - Output of `runMatrix()`.
 * @returns {string} Markdown report text.
 */
function generateLiveModelMatrixReport(matrix) {
  const lines = [];
  lines.push('# Live Multi-Model & Open-Weight Evaluation Matrix (`#74`)');
  lines.push('');
  lines.push('- **Issue:** [Jason-Vaughan/Medusa#74](https://github.com/Jason-Vaughan/Medusa/issues/74)');
  lines.push(`- **Mode:** \`${matrix.mode}\``);
  lines.push(`- **Generated At:** \`${matrix.generatedAt}\``);
  lines.push('');
  lines.push(
    "> Frontier profiles (`claude`, `codex`, `antigravity`) have no live completion endpoint wired into this harness and are always scored deterministically against each codec's own encode/decode output (`mode: frontier-deterministic`) as a reproducible upper-bound baseline. Only the three Monad-1 open-weight models are queried live over HTTP when run with `offline: false`."
  );
  lines.push('');
  lines.push('## 1. Per-Model, Per-Codec Matrix');
  lines.push('');
  lines.push(
    '| Model/Profile | Codec | Mode | Schema Adherence | Constraint Retention | Round-Trip Semantic | Prompt Tokens | Eval Tokens | Wall (ms) | Eval (ms) | Tok/s |'
  );
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');

  const cell = (value, digits) => (value === null || value === undefined ? '–' : digits !== undefined ? value.toFixed(digits) : value);

  for (const row of matrix.rows) {
    lines.push(
      `| \`${row.model}\` | \`${row.codecId}\` | \`${row.mode}\` | ${row.schemaAdherencePct}% | ${row.constraintRetentionPct}% | ${row.roundTripSemanticPct}% | ${cell(row.promptEvalCount)} | ${cell(row.evalCount)} | ${cell(row.wallMs)} | ${cell(row.evalDurationMs, 2)} | ${cell(row.tokPerSec)} |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. Real Monad-1 Decode-Rate Reference (from `docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md`)');
  lines.push('');
  lines.push(
    'Measured (not simulated) Suite A/B decode rates against `http://monad-1.tail123678.ts.net:11435/api/chat` (`temperature: 0`), evaluated by `Medusa-Lane-C` under `#75`:'
  );
  lines.push('');
  lines.push('| Model | Setting | Decode Rate | End-to-End Eval Duration | Note |');
  lines.push('|---|---|---:|---:|---|');
  lines.push(
    '| `gpt-oss:120b` | `num_predict: 600` | `25.78 tok/s` | `11,171 ms` | Needs the larger cap: `~200` of its tokens are hidden reasoning before the visible 88-token answer. |'
  );
  lines.push(
    '| `qwen3-coder-next:q4_K_M` | `num_predict: 220` | `28.10 tok/s` | `3,132 ms` | Zero hidden reasoning tokens — `3.57x` shorter end-to-end duration than `gpt-oss:120b`. |'
  );
  lines.push(
    '| `qwen3.6:35b-a3b` | `think: false`, `num_predict: 220` | `33.83 tok/s` | `2,986 ms` | Highest decode rate observed; fails closed to empty output if `think` is left at its `true` default under a tight token cap. |'
  );
  lines.push('');
  lines.push(
    '**Implication for this matrix:** a live (`offline: false`) run against `qwen3-coder-next:q4_K_M` or `qwen3.6:35b-a3b` (`think: false`) should set `num_predict` high enough to avoid truncating a codec reply mid-structure, and `gpt-oss:120b` should either use `think: false` or budget for its hidden reasoning tokens.'
  );

  return lines.join('\n') + '\n';
}

module.exports = {
  LiveModelAdapter,
  buildPrompt,
  buildDigestHints,
  prepareEvaluationContext,
  stripMarkdownFences,
  scoreCandidate,
  generateLiveModelMatrixReport,
  MONAD1_MODELS,
  FRONTIER_PROFILES,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIVE_SAMPLE_MESSAGE
};
