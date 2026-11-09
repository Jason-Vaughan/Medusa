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

const { CodecRegistry, validateCanonicalMessage } = require('../../src/medusa/experiments/codecs');
const { BENCHMARK_SCENARIOS } = require('./scenarios');
const { measureSemanticPreservation, createCodecState } = require('./harness');

const DEFAULT_BASE_URL = 'http://monad-1.tail123678.ts.net:11435';
const DEFAULT_TIMEOUT_MS = 30000;

const MONAD1_MODELS = ['gpt-oss:120b', 'qwen3-coder-next:q4_K_M', 'qwen3.6:35b-a3b'];
const FRONTIER_PROFILES = ['claude', 'codex', 'antigravity'];

/**
 * Builds the instruction prompt asking a model to reproduce `message` in `codec`'s wire format.
 *
 * @param {object} codec - `BaseCodec` instance.
 * @param {object} message - Canonical semantic message to encode.
 * @returns {string} Prompt text.
 */
function buildPrompt(codec, message) {
  const caps = codec.capabilities();
  return [
    `You are encoding an inter-agent coordination message using the "${caps.id}" wire format.`,
    `Format description: ${caps.description}`,
    'Reply with ONLY the wire text for this message, no commentary:',
    JSON.stringify(message)
  ].join('\n');
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
  const schemaAdherencePct = structural.structuralValid ? 100 : 0;

  const constraintRetentionPct =
    message.constraints === undefined || JSON.stringify(message.constraints) === JSON.stringify(decoded.message.constraints)
      ? 100
      : 0;

  const fidelity = measureSemanticPreservation(message, decoded.message);

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
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.transport = options.transport || (typeof fetch === 'function' ? fetch : null);
    this.registry = options.registry instanceof CodecRegistry ? options.registry : new CodecRegistry();
  }

  /**
   * Queries a Monad-1 Ollama model live over HTTP for a single chat completion.
   *
   * @param {string} model - Ollama model tag (e.g. `"gpt-oss:120b"`).
   * @param {string} prompt - User prompt text.
   * @param {{ think?: boolean }} [options={}] - `think: false` disables chain-of-thought where supported.
   * @returns {Promise<{ ok: boolean, content: string, promptEvalCount: number, evalCount: number, wallMs: number, evalDurationMs: number, tokPerSec: number, error: string|null }>}
   */
  async queryMonad1Model(model, prompt, { think = false } = {}) {
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
      const response = await this.transport(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          think
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
    const sample = message || BENCHMARK_SCENARIOS[0].messages[0];
    const decodeContext = createCodecState(codecId);

    if (offline) {
      return { model, codecId, mode: 'offline', error: null, ...this.evaluateOffline(codec, sample, decodeContext) };
    }

    const prompt = buildPrompt(codec, sample);
    const result = await this.queryMonad1Model(model, prompt, { think: false });
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

    const score = scoreCandidate(codec, sample, result.content.trim(), decodeContext);
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
   * Evaluates one codec against one frontier engine profile. Always runs the deterministic
   * offline path (`mode: 'frontier-deterministic'`) regardless of any `offline` flag elsewhere,
   * since no live completion endpoint is wired for frontier engines in this harness.
   *
   * @param {string} codecId - Registered codec id.
   * @param {string} profile - Frontier engine profile name (`"claude"`/`"codex"`/`"antigravity"`).
   * @param {{ message?: object }} [options={}] - Evaluation options.
   * @returns {object} Per-profile, per-codec evaluation result.
   */
  evaluateFrontierProfile(codecId, profile, { message } = {}) {
    const codec = this.registry.get(codecId);
    if (!codec) throw new Error(`Unknown codec id: "${codecId}"`);
    const sample = message || BENCHMARK_SCENARIOS[0].messages[0];
    const decodeContext = createCodecState(codecId);
    return {
      model: profile,
      codecId,
      mode: 'frontier-deterministic',
      error: null,
      ...this.evaluateOffline(codec, sample, decodeContext)
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
        rows.push(this.evaluateFrontierProfile(codecId, profile));
      }
      for (const model of monad1Models) {
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
  scoreCandidate,
  generateLiveModelMatrixReport,
  MONAD1_MODELS,
  FRONTIER_PROFILES,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS
};
