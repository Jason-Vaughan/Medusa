'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

/**
 * Parse and apply an Aider SEARCH/REPLACE block from a raw model response against an original file string.
 * Replicates Aider's EditBlockCoder.find_original_update_blocks + do_replace verification in Jest.
 * @param {string} originalContent - Original file content prior to edit.
 * @param {string} rawResponse - Verbatim LLM response containing a SEARCH/REPLACE block.
 * @returns {{ ok: boolean, updatedContent: string|null, error: string|null }} Application result.
 */
function applyAiderSearchReplaceBlock(originalContent, rawResponse) {
  const startIdx = rawResponse.indexOf('<<<<<<< SEARCH\n');
  if (startIdx === -1) {
    return { ok: false, updatedContent: null, error: 'Missing <<<<<<< SEARCH marker' };
  }
  const dividerIdx = rawResponse.indexOf('\n=======\n', startIdx);
  if (dividerIdx === -1) {
    return { ok: false, updatedContent: null, error: 'Expected `>>>>>>> REPLACE` or `=======`' };
  }
  const endIdx = rawResponse.indexOf('\n>>>>>>> REPLACE', dividerIdx);
  if (endIdx === -1) {
    return { ok: false, updatedContent: null, error: 'Expected `>>>>>>> REPLACE` or `=======`' };
  }
  const searchBlock = rawResponse.slice(startIdx + '<<<<<<< SEARCH\n'.length, dividerIdx) + '\n';
  const replaceBlock = rawResponse.slice(dividerIdx + '\n=======\n'.length, endIdx) + '\n';

  if (!originalContent.includes(searchBlock)) {
    return { ok: false, updatedContent: null, error: 'SEARCH block did not match originalContent' };
  }
  const updatedContent = originalContent.replace(searchBlock, replaceBlock);
  return { ok: true, updatedContent, error: null };
}

describe('TangleClaw Aider & Monad-1 Open-Weight Integration Feedback Report (#75)', () => {
  test('verifies Suite A & Suite B benchmark receipt and executes Aider SEARCH/REPLACE patching across all 3 models', () => {
    const content = loadAiderFeedbackReport();
    const receipt = parseBenchmarkReceipt(content);

    expect(receipt.schema).toBe('monad1-benchmark-receipt-v1');
    expect(receipt.endpoint).toBe('http://monad-1.tail123678.ts.net:11435/api/chat');
    expect(Array.isArray(receipt.runs)).toBe(true);
    expect(receipt.runs.length).toBe(4);
    expect(Array.isArray(receipt.editBlockRuns)).toBe(true);
    expect(receipt.editBlockRuns.length).toBe(4);

    // Suite B: Re-verify every model's rawResponse through applyAiderSearchReplaceBlock and execute patched JS
    const editRunsByKey = new Map();
    for (const run of receipt.editBlockRuns) {
      const patchResult = applyAiderSearchReplaceBlock(receipt.editBlockOriginalFile, run.rawResponse);
      expect(patchResult.ok).toBe(run.editAppliedCleanly);
      if (run.editAppliedCleanly) {
        expect(patchResult.updatedContent).toBe(run.appliedFileResult);
        expect(patchResult.updatedContent).toContain('@param {number}');
        expect(patchResult.updatedContent).toContain('@returns {number}');
        // Execute the patched function in an isolated VM context to verify behavioral correctness
        const sandbox = {};
        vm.createContext(sandbox);
        vm.runInContext(`${patchResult.updatedContent}; globalThis.result = add(7, 5);`, sandbox);
        expect(sandbox.result).toBe(12);
      } else {
        expect(patchResult.error).toContain('Expected `>>>>>>> REPLACE`');
      }
      editRunsByKey.set(`${run.model}:${run.numPredict}:${run.think ?? 'default'}`, run);
    }

    const gptOss220 = editRunsByKey.get('gpt-oss:120b:220:default');
    const gptOss600 = editRunsByKey.get('gpt-oss:120b:600:default');
    const qwenCoder220 = editRunsByKey.get('qwen3-coder-next:q4_K_M:220:default');
    const qwen36NoThink220 = editRunsByKey.get('qwen3.6:35b-a3b:220:false');

    expect(gptOss220.editAppliedCleanly).toBe(false);
    expect(gptOss600.editAppliedCleanly).toBe(true);
    expect(qwenCoder220.editAppliedCleanly).toBe(true);
    expect(qwen36NoThink220.editAppliedCleanly).toBe(true);

    // Verify token efficiency & end-to-end completion duration advantage of Qwen models on SEARCH/REPLACE
    expect(qwenCoder220.evalCount).toBeLessThan(gptOss600.evalCount);
    expect(qwenCoder220.evalDurationMs).toBeLessThan(gptOss600.evalDurationMs);
    expect(qwen36NoThink220.evalDurationMs).toBeLessThan(gptOss600.evalDurationMs);
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
