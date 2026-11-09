'use strict';

/**
 * Automated Test Suite for the Live Multi-Model Codec Evaluation Adapter (`Medusa#74`).
 *
 * Verifies:
 * 1. Offline deterministic evaluation across all 9 registered codecs (frontier + Monad-1 rows).
 * 2. Live Monad-1 HTTP querying against a mocked transport (never a real network call).
 * 3. Graceful handling of malformed/truncated model output and transport-level errors.
 * 4. Request timeout handling via an injected, signal-aware mock transport.
 * 5. Markdown report generation.
 */

const { CodecRegistry } = require('./CodecRegistry');
const {
  LiveModelAdapter,
  buildPrompt,
  scoreCandidate,
  generateLiveModelMatrixReport,
  MONAD1_MODELS,
  FRONTIER_PROFILES
} = require('../../../../benchmarks/agent-communication/live-model-adapter');
const { BENCHMARK_SCENARIOS } = require('../../../../benchmarks/agent-communication/scenarios');
const { createCodecState } = require('../../../../benchmarks/agent-communication/harness');

const ALL_CODEC_IDS = new CodecRegistry().listCapabilities().map((c) => c.id);
const SAMPLE_MESSAGE = BENCHMARK_SCENARIOS[0].messages[0];

describe('LiveModelAdapter (Issue #74)', () => {
  describe('1. Offline deterministic evaluation across all 9 codecs', () => {
    test('runMatrix({ offline: true }) never constructs a real transport call and scores every codec perfectly', async () => {
      const calls = [];
      const adapter = new LiveModelAdapter({
        transport: async () => {
          calls.push('called');
          throw new Error('offline mode must never invoke the transport');
        }
      });

      const matrix = await adapter.runMatrix({ offline: true });

      expect(calls).toEqual([]);
      expect(matrix.mode).toBe('offline-deterministic');
      expect(matrix.rows.length).toBe(ALL_CODEC_IDS.length * (FRONTIER_PROFILES.length + MONAD1_MODELS.length));

      for (const row of matrix.rows) {
        expect(row.schemaAdherencePct).toBe(100);
        expect(row.constraintRetentionPct).toBe(100);
        expect(row.roundTripSemanticPct).toBe(100);
        expect(row.decodedOk).toBe(true);
        expect(['offline', 'frontier-deterministic']).toContain(row.mode);
      }
    });

    test.each(ALL_CODEC_IDS)('evaluateFrontierProfile scores codec "%s" deterministically with no network access', async (codecId) => {
      const adapter = new LiveModelAdapter({ transport: null });
      const result = await adapter.evaluateFrontierProfile(codecId, 'claude', { message: SAMPLE_MESSAGE });

      expect(result.mode).toBe('frontier-deterministic');
      expect(result.schemaAdherencePct).toBe(100);
      expect(result.roundTripSemanticPct).toBe(100);
      expect(result.error).toBeNull();
    });

    test('evaluateFrontierProfile stays deterministic even with offline:false if no frontierProbe is injected', async () => {
      const adapter = new LiveModelAdapter({ transport: null });
      const result = await adapter.evaluateFrontierProfile('compact-json-v1', 'codex', {
        message: SAMPLE_MESSAGE,
        offline: false
      });
      expect(result.mode).toBe('frontier-deterministic');
    });

    test('evaluateFrontierProfile scores a genuine injected frontierProbe as frontier-session-probe', async () => {
      const registry = new CodecRegistry();
      const codec = registry.get('compact-json-v1');
      let capturedEvalCtx;
      const adapter = new LiveModelAdapter({
        registry,
        frontierProbe: async (codecId, profile, evalCtx) => {
          capturedEvalCtx = evalCtx;
          return {
            content: codec.encode(SAMPLE_MESSAGE, evalCtx.decodeContext).wireText,
            promptEvalCount: 30,
            evalCount: 10,
            wallMs: 200,
            evalDurationMs: 180,
            tokPerSec: 55.6
          };
        }
      });

      const result = await adapter.evaluateFrontierProfile('compact-json-v1', 'claude', {
        message: SAMPLE_MESSAGE,
        offline: false
      });

      expect(capturedEvalCtx.exampleWireText).toBeDefined();
      expect(result.mode).toBe('frontier-session-probe');
      expect(result.schemaAdherencePct).toBe(100);
      expect(result.roundTripSemanticPct).toBe(100);
      expect(result.promptEvalCount).toBe(30);
      expect(result.tokPerSec).toBe(55.6);
    });
  });

  describe('2. Live Monad-1 HTTP querying against a mocked transport', () => {
    test('scores a well-formed mocked Ollama /api/chat response correctly', async () => {
      const registry = new CodecRegistry();
      const codec = registry.get('compact-json-v1');
      const wireText = codec.encode(SAMPLE_MESSAGE).wireText;

      let capturedUrl;
      let capturedInit;
      const adapter = new LiveModelAdapter({
        registry,
        transport: async (url, init) => {
          capturedUrl = url;
          capturedInit = init;
          return {
            ok: true,
            json: async () => ({
              message: { content: wireText },
              prompt_eval_count: 42,
              eval_count: 17,
              eval_duration: 500_000_000 // 500ms in nanoseconds
            })
          };
        }
      });

      const result = await adapter.evaluateMonad1('compact-json-v1', 'qwen3-coder-next:q4_K_M', {
        offline: false,
        message: SAMPLE_MESSAGE
      });

      expect(capturedUrl).toBe('http://monad-1.tail123678.ts.net:11435/api/chat');
      const body = JSON.parse(capturedInit.body);
      expect(body.model).toBe('qwen3-coder-next:q4_K_M');
      expect(body.think).toBe(false);

      expect(result.mode).toBe('live');
      expect(result.error).toBeNull();
      expect(result.schemaAdherencePct).toBe(100);
      expect(result.roundTripSemanticPct).toBe(100);
      expect(result.promptEvalCount).toBe(42);
      expect(result.evalCount).toBe(17);
      expect(result.evalDurationMs).toBe(500);
      expect(result.tokPerSec).toBe(34);
    });

    test('buildPrompt names the codec id and embeds the message as JSON', () => {
      const registry = new CodecRegistry();
      const codec = registry.get('tuple-table-v1');
      const prompt = buildPrompt(codec, SAMPLE_MESSAGE);
      expect(prompt).toContain('tuple-table-v1');
      expect(prompt).toContain(JSON.stringify(SAMPLE_MESSAGE));
    });

    test('buildPrompt includes a one-shot wire-grammar example when evalCtx is supplied', () => {
      const registry = new CodecRegistry();
      const codec = registry.get('tuple-table-v1');
      const evalCtx = { exampleMessage: { kind: 'task.ack' }, exampleWireText: '@tuple-v1|...' };
      const prompt = buildPrompt(codec, SAMPLE_MESSAGE, evalCtx);
      expect(prompt).toContain('Example');
      expect(prompt).toContain('@tuple-v1|...');
    });

    test('strips a Markdown code fence wrapped around the model wire output before decoding', async () => {
      const registry = new CodecRegistry();
      const codec = registry.get('compact-json-v1');
      const wireText = codec.encode(SAMPLE_MESSAGE).wireText;
      const fenced = '```json\n' + wireText + '\n```';

      const adapter = new LiveModelAdapter({
        registry,
        transport: async () => ({
          ok: true,
          json: async () => ({ message: { content: fenced }, prompt_eval_count: 1, eval_count: 1, eval_duration: 1 })
        })
      });

      const result = await adapter.evaluateMonad1('compact-json-v1', 'gpt-oss:120b', {
        offline: false,
        message: SAMPLE_MESSAGE
      });
      expect(result.decodedOk).toBe(true);
      expect(result.schemaAdherencePct).toBe(100);
    });

    test.each(['dict-intern-v1', 'json-patch-v1', 'blackboard-ref-v1', 'graph-delta-v1'])(
      'evaluateMonad1 fairly scores a realistic mocked reply for the stateful codec "%s"',
      async (codecId) => {
        const registry = new CodecRegistry();
        const codec = registry.get(codecId);
        // Simulate "the model got it right": encode the same sample against a fresh context,
        // exactly like a model starting a fresh evaluation turn would be expected to produce.
        const mockWireText = codec.encode(SAMPLE_MESSAGE, createCodecState(codecId)).wireText;

        const adapter = new LiveModelAdapter({
          registry,
          transport: async () => ({
            ok: true,
            json: async () => ({
              message: { content: mockWireText },
              prompt_eval_count: 50,
              eval_count: 20,
              eval_duration: 400_000_000
            })
          })
        });

        const result = await adapter.evaluateMonad1(codecId, 'qwen3.6:35b-a3b', {
          offline: false,
          message: SAMPLE_MESSAGE
        });

        expect(result.mode).toBe('live');
        expect(result.error).toBeNull();
        expect(result.decodedOk).toBe(true);
        expect(result.schemaAdherencePct).toBe(100);
        expect(result.roundTripSemanticPct).toBe(100);
      }
    );

    test('evaluateMonad1 requests a larger num_predict for gpt-oss:120b than the other Monad-1 models', async () => {
      const captured = [];
      const adapter = new LiveModelAdapter({
        transport: async (url, init) => {
          captured.push(JSON.parse(init.body));
          return { ok: true, json: async () => ({ message: { content: '' }, prompt_eval_count: 1, eval_count: 1, eval_duration: 1 }) };
        }
      });

      await adapter.evaluateMonad1('compact-json-v1', 'gpt-oss:120b', { offline: false, message: SAMPLE_MESSAGE });
      await adapter.evaluateMonad1('compact-json-v1', 'qwen3.6:35b-a3b', { offline: false, message: SAMPLE_MESSAGE });

      expect(captured[0].options.num_predict).toBe(600);
      expect(captured[1].options.num_predict).toBe(220);
      expect(captured[0].options.temperature).toBe(0);
    });
  });

  describe('3. Malformed/truncated model output and transport-level errors', () => {
    test('scores a truncated/garbled model response as a graceful decode failure, not a throw', async () => {
      const adapter = new LiveModelAdapter({
        transport: async () => ({
          ok: true,
          json: async () => ({
            message: { content: '{"v": 1, "k": "task.ass' }, // truncated mid-JSON
            prompt_eval_count: 10,
            eval_count: 5,
            eval_duration: 100_000_000
          })
        })
      });

      const result = await adapter.evaluateMonad1('compact-json-v1', 'gpt-oss:120b', {
        offline: false,
        message: SAMPLE_MESSAGE
      });

      expect(result.mode).toBe('live');
      expect(result.error).toBeNull();
      expect(result.decodedOk).toBe(false);
      expect(result.schemaAdherencePct).toBe(0);
      expect(result.constraintRetentionPct).toBe(0);
      expect(result.roundTripSemanticPct).toBe(0);
    });

    test('reports a non-ok transport response as a graceful error result', async () => {
      const adapter = new LiveModelAdapter({
        transport: async () => ({ ok: false, statusText: 'Service Unavailable' })
      });

      const result = await adapter.evaluateMonad1('compact-json-v1', 'gpt-oss:120b', { offline: false });
      expect(result.mode).toBe('live');
      expect(result.error).toMatch(/Service Unavailable/);
      expect(result.schemaAdherencePct).toBe(0);
    });

    test('reports a rejected transport promise as a graceful error result', async () => {
      const adapter = new LiveModelAdapter({
        transport: async () => {
          throw new Error('ECONNREFUSED');
        }
      });

      const result = await adapter.evaluateMonad1('compact-json-v1', 'gpt-oss:120b', { offline: false });
      expect(result.mode).toBe('live');
      expect(result.error).toMatch(/ECONNREFUSED/);
    });

    test('queryMonad1Model reports a clean error when no transport is available at all', async () => {
      const adapter = new LiveModelAdapter();
      adapter.transport = undefined;

      const result = await adapter.queryMonad1Model('gpt-oss:120b', 'prompt text');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No transport available/);
    });
  });

  describe('4. Request timeout handling', () => {
    test('aborts and reports a timeout when the transport never resolves within timeoutMs', async () => {
      const adapter = new LiveModelAdapter({
        timeoutMs: 10,
        transport: (url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      });

      const result = await adapter.queryMonad1Model('gpt-oss:120b', 'prompt text');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Timed out after 10ms/);
    });
  });

  describe('5. scoreCandidate helper', () => {
    test('returns a zeroed score without throwing when decode fails', () => {
      const registry = new CodecRegistry();
      const codec = registry.get('tuple-table-v1');
      const score = scoreCandidate(codec, SAMPLE_MESSAGE, 'not-a-tuple-record');
      expect(score.decodedOk).toBe(false);
      expect(score.schemaAdherencePct).toBe(0);
    });

    test('penalizes a decoded candidate that hallucinates an extra field never sent', () => {
      const registry = new CodecRegistry();
      const codec = registry.get('tuple-table-v1');
      // A model that invented a field the sender never sent: encode a MUTATED message (with an
      // extra field), then score that wire text against the ORIGINAL message actually requested.
      const hallucinated = { ...SAMPLE_MESSAGE, invented: 'this field was never sent' };
      const hallucinatedWireText = codec.encode(hallucinated).wireText;

      const score = scoreCandidate(codec, SAMPLE_MESSAGE, hallucinatedWireText);
      expect(score.decodedOk).toBe(true);
      expect(score.schemaAdherencePct).toBeLessThan(100);
      expect(score.roundTripSemanticPct).toBeLessThan(100);
    });
  });

  describe('6. Markdown report generation', () => {
    test('renders a null-telemetry deterministic row (no model was queried) as "–", not a fabricated number', () => {
      const matrix = {
        generatedAt: '2026-11-09T00:00:00.000Z',
        mode: 'offline-deterministic',
        rows: [
          {
            model: 'claude',
            codecId: 'tuple-table-v1',
            mode: 'frontier-deterministic',
            schemaAdherencePct: 100,
            constraintRetentionPct: 100,
            roundTripSemanticPct: 100,
            promptEvalCount: null,
            evalCount: null,
            wallMs: null,
            evalDurationMs: null,
            tokPerSec: null
          }
        ]
      };

      const md = generateLiveModelMatrixReport(matrix);
      expect(md).toContain('# Live Multi-Model & Open-Weight Evaluation Matrix');
      expect(md).toContain('`offline-deterministic`');
      expect(md).toContain('`claude`');
      expect(md).toContain('`tuple-table-v1`');
      expect(md).toContain('`frontier-deterministic`');
      expect(md).toContain('Real Monad-1 Decode-Rate Reference');
      expect(md).toContain('qwen3.6:35b-a3b');

      const dataRow = md.split('\n').find((line) => line.includes('`claude`') && line.includes('`tuple-table-v1`'));
      expect(dataRow).toMatch(/\|\s*–\s*\|\s*–\s*\|\s*–\s*\|\s*–\s*\|\s*–\s*\|/);
    });

    test('renders real numeric telemetry for a live row', () => {
      const matrix = {
        generatedAt: '2026-11-09T00:00:00.000Z',
        mode: 'live',
        rows: [
          {
            model: 'qwen3-coder-next:q4_K_M',
            codecId: 'compact-json-v1',
            mode: 'live',
            schemaAdherencePct: 100,
            constraintRetentionPct: 100,
            roundTripSemanticPct: 100,
            promptEvalCount: 42,
            evalCount: 17,
            wallMs: 600,
            evalDurationMs: 500,
            tokPerSec: 34
          }
        ]
      };

      const md = generateLiveModelMatrixReport(matrix);
      const dataRow = md.split('\n').find((line) => line.includes('qwen3-coder-next:q4_K_M'));
      expect(dataRow).toContain('42');
      expect(dataRow).toContain('17');
      expect(dataRow).toContain('500.00');
      expect(dataRow).toContain('34');
      expect(dataRow).not.toContain('–');
    });
  });
});
