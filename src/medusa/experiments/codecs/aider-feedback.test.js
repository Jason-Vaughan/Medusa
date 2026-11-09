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

describe('TangleClaw Aider & Monad-1 Open-Weight Integration Feedback Report (#75)', () => {
  test('documents all three Monad-1 open-weight models and endpoint', () => {
    const content = loadAiderFeedbackReport();
    expect(content).toContain('http://monad-1.tail123678.ts.net:11435');
    expect(content).toContain('ollama_chat/gpt-oss:120b');
    expect(content).toContain('ollama_chat/qwen3-coder-next:q4_K_M');
    expect(content).toContain('ollama_chat/qwen3.6:35b-a3b');
  });

  test('documents all 4 live Aider integration gaps and links upstream TangleClaw#2961', () => {
    const content = loadAiderFeedbackReport();
    expect(content).toContain('TangleClaw/issues/2961');
    expect(content).toContain('detect-urls: false');
    expect(content).toContain('explicit_yes_required');
    expect(content).toContain('ENGINE_WAKE_PROFILES');
    expect(content).toContain('check_for_file_mentions');
  });
});
