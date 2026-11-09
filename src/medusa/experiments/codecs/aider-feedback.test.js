'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Load the canonical TangleClaw Aider & Open-Weight Integration Feedback Report (#75).
 * @returns {string} Raw markdown content of the report.
 */
function loadAiderFeedbackReport() {
  const reportPath = path.resolve(
    __dirname,
    '../../../../docs/research/TANGLECLAW_AIDER_INTEGRATION_FEEDBACK.md'
  );
  return fs.readFileSync(reportPath, 'utf8');
}

/**
 * Extract and parse the embedded monad1-benchmark-receipt-v1 JSON block from the report.
 * @param {string} markdown - Raw markdown content of the report.
 * @returns {object} Parsed JSON receipt object.
 */
function parseBenchmarkReceipt(markdown) {
  const match = markdown.match(/```json\s*(\{[\s\S]*?"schema":\s*"monad1-benchmark-receipt-v1"[\s\S]*?\})\s*```/);
  if (!match) {
    throw new Error('Missing monad1-benchmark-receipt-v1 JSON block in report');
  }
  return JSON.parse(match[1]);
}

describe('TangleClaw Aider & Monad-1 Open-Weight Integration Feedback Report (#75)', () => {
  test('contains verifiable empirical benchmark receipt across all 3 Monad-1 models', () => {
    const content = loadAiderFeedbackReport();
    const receipt = parseBenchmarkReceipt(content);

    expect(receipt.schema).toBe('monad1-benchmark-receipt-v1');
    expect(receipt.endpoint).toBe('http://monad-1.tail123678.ts.net:11435/api/chat');
    expect(Array.isArray(receipt.runs)).toBe(true);
    expect(receipt.runs.length).toBeGreaterThanOrEqual(4);

    const byModel = new Map();
    for (const run of receipt.runs) {
      expect(typeof run.wallMs).toBe('number');
      expect(run.wallMs).toBeGreaterThan(0);
      expect(typeof run.promptEvalCount).toBe('number');
      expect(run.promptEvalCount).toBeGreaterThan(0);
      expect(typeof run.evalCount).toBe('number');
      expect(run.evalCount).toBeGreaterThan(0);
      expect(typeof run.evalDurationMs).toBe('number');
      expect(run.evalDurationMs).toBeGreaterThan(0);
      expect(typeof run.tokPerSec).toBe('number');
      expect(run.tokPerSec).toBeGreaterThan(0);
      byModel.set(`${run.model}:${run.think ?? 'default'}`, run);
    }

    const gptOss = byModel.get('gpt-oss:120b:default');
    const qwenCoder = byModel.get('qwen3-coder-next:q4_K_M:default');
    const qwen36ThinkOn = byModel.get('qwen3.6:35b-a3b:true');
    const qwen36ThinkOff = byModel.get('qwen3.6:35b-a3b:false');

    expect(gptOss).toBeDefined();
    expect(qwenCoder).toBeDefined();
    expect(qwen36ThinkOn).toBeDefined();
    expect(qwen36ThinkOff).toBeDefined();

    // Verify qwen3-coder-next is faster in eval duration and uses fewer tokens than gpt-oss:120b
    expect(qwenCoder.evalDurationMs).toBeLessThan(gptOss.evalDurationMs);
    expect(qwenCoder.evalCount).toBeLessThan(gptOss.evalCount);
    expect(qwenCoder.hasJsDoc).toBe(true);

    // Verify qwen3.6:35b-a3b think:true vs think:false empirical behavior
    expect(qwen36ThinkOn.hasJsDoc).toBe(false);
    expect(qwen36ThinkOff.hasJsDoc).toBe(true);
    expect(qwen36ThinkOff.evalDurationMs).toBeLessThan(gptOss.evalDurationMs);
  });

  test('verifies .tangleclaw/aider-conventions.md read-only injection mechanics and all 4 live Aider gaps', () => {
    const content = loadAiderFeedbackReport();
    expect(content).toContain('.tangleclaw/aider-conventions.md');
    expect(content).toContain('readonly_files messages count: 2');
    expect(content).toContain('Here are some READ ONLY files, provided for your reference.');
    expect(content).toContain('TangleClaw/issues/2961');
    expect(content).toContain('detect-urls: false');
    expect(content).toContain('explicit_yes_required');
    expect(content).toContain('ENGINE_WAKE_PROFILES');
    expect(content).toContain('check_for_file_mentions');
  });
});
