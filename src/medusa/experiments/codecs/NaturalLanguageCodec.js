'use strict';

/**
 * Approach A — Natural Language Baseline Codec (`nl-baseline-v1`).
 *
 * Models the current verbose markdown/prose messages exchanged by Medusa + TangleClaw sessions
 * (formal headers, prose explanations, markdown lists, and structured field blocks).
 * Serves as the control condition against which all structured/graph/delta/command codecs are measured.
 */

const { BaseCodec, formatHumanAuditText } = require('./BaseCodec');

class NaturalLanguageCodec extends BaseCodec {
  /**
   * Returns codec identity and capabilities.
   *
   * @returns {object}
   */
  capabilities() {
    return {
      id: 'nl-baseline-v1',
      schemaVersion: '1.0.0',
      description: 'Conventional multi-paragraph English markdown prose (Medusa production baseline)',
      supportsDeltas: false,
      supportsArtifactRefs: false,
      requiresSharedState: false,
      losslessRoundTrip: true
    };
  }

  /**
   * Encodes a canonical message into realistic multi-paragraph TangleClaw/Medusa markdown prose.
   *
   * @param {object} message - Canonical semantic message.
   * @param {object} [context={}] - Optional context.
   * @returns {object}
   */
  encode(message, context = {}) {
    if (!message || typeof message !== 'object') {
      throw new Error('NaturalLanguageCodec.encode requires a message object');
    }

    const lines = [];
    const kind = message.kind || 'state.update';
    const from = message.from || 'unknown-sender';
    const to = message.to || 'unknown-recipient';

    lines.push(`# Medusa Coordination Dispatch — \`${kind}\` (from \`${from}\` to \`${to}\`)`);
    lines.push('');
    lines.push(
      `Hello \`${to}\`, this is \`${from}\` sending an official coordination update regarding our current sprint workflow.`
    );
    if (message.summary) {
      lines.push(`Please review the following summary carefully and take the appropriate next action: ${message.summary}`);
    }
    lines.push('');
    lines.push('## Envelope & Reference Metadata');
    if (message.id) lines.push(`- **Message ID:** \`${message.id}\``);
    lines.push(`- **Intent Kind:** \`${kind}\``);
    lines.push(`- **Sender Workspace:** \`${from}\``);
    lines.push(`- **Recipient Workspace:** \`${to}\``);
    if (message.repository) lines.push(`- **Repository:** \`${message.repository}\``);
    if (message.issue !== undefined) {
      const issueStr = JSON.stringify(message.issue);
      lines.push(`- **Issue Reference(s):** \`${issueStr}\``);
    }
    if (message.pr !== undefined) lines.push(`- **Pull Request:** \`#${message.pr}\``);
    if (message.base) lines.push(`- **Base Branch:** \`${message.base}\``);
    if (message.head) lines.push(`- **Head Branch:** \`${message.head}\``);
    if (message.headRefOid) lines.push(`- **Head Commit SHA (headRefOid):** \`${message.headRefOid}\``);
    if (message.status) lines.push(`- **Current Status:** \`${message.status}\``);
    if (message.verdict) lines.push(`- **Verdict:** \`${message.verdict}\``);
    if (message.tests) lines.push(`- **Test Evidence:** \`${message.tests}\``);
    if (message.round !== undefined) lines.push(`- **Review Round:** \`${message.round}\``);
    if (message.turn !== undefined) lines.push(`- **Exchange Turn:** \`${message.turn}\``);

    if (Array.isArray(message.scope) && message.scope.length > 0) {
      lines.push('');
      lines.push('## Allowed File Scope');
      for (const file of message.scope) {
        lines.push(`- \`${file}\``);
      }
    }

    if (Array.isArray(message.constraints) && message.constraints.length > 0) {
      lines.push('');
      lines.push('## Binding Governance & Technical Constraints');
      for (const c of message.constraints) {
        lines.push(`- [CONSTRAINT] \`${c}\``);
      }
    }

    if (Array.isArray(message.dependencies) && message.dependencies.length > 0) {
      lines.push('');
      lines.push('## Upstream & Downstream Dependencies');
      for (const dep of message.dependencies) {
        lines.push(`- [DEPENDENCY] \`${typeof dep === 'string' ? dep : JSON.stringify(dep)}\``);
      }
    }

    if (Array.isArray(message.findings)) {
      lines.push('');
      lines.push('## Review Findings & Required Revisions');
      if (message.findings.length === 0) {
        lines.push('- [FINDINGS_EMPTY]');
      } else {
        for (const f of message.findings) {
          lines.push(`- [FINDING] \`${JSON.stringify(f)}\``);
        }
      }
    }

    if (Array.isArray(message.assignments) && message.assignments.length > 0) {
      lines.push('');
      lines.push('## Wave Car Assignments');
      for (const a of message.assignments) {
        lines.push(`- [ASSIGNMENT] \`${JSON.stringify(a)}\``);
      }
    }

    if (message.sharedContext && typeof message.sharedContext === 'object') {
      lines.push('');
      lines.push('## Repeated Sprint Context Snapshot');
      lines.push(
        'For completeness and self-contained context across turns, here is the active sprint charter and background state:'
      );
      lines.push(`- [SHARED_CONTEXT] \`${JSON.stringify(message.sharedContext)}\``);
    }

    const wireText = lines.join('\n');
    return {
      codec: 'nl-baseline-v1',
      schemaVersion: '1.0.0',
      payload: wireText,
      wireText,
      humanAuditText: formatHumanAuditText(message),
      metadata: {
        lineCount: lines.length
      }
    };
  }

  /**
   * Decodes a natural-language markdown message back into the canonical semantic structure.
   *
   * @param {object|string} envelopeOrWireText - Envelope or markdown string.
   * @param {object} [context={}] - Optional context.
   * @returns {object}
   */
  decode(envelopeOrWireText, context = {}) {
    const wireText =
      typeof envelopeOrWireText === 'string'
        ? envelopeOrWireText
        : envelopeOrWireText && typeof envelopeOrWireText.wireText === 'string'
          ? envelopeOrWireText.wireText
          : null;

    if (!wireText || typeof wireText !== 'string') {
      return {
        ok: false,
        message: null,
        errors: ['NaturalLanguageCodec.decode requires a non-empty markdown string'],
        warnings: []
      };
    }

    const message = {};
    const scope = [];
    const constraints = [];
    const dependencies = [];
    const findings = [];
    const assignments = [];
    let hasEmptyFindings = false;
    let section = '';

    const lines = wireText.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('## ')) {
        section = line.slice(3).trim();
        continue;
      }

      const summaryMatch = line.match(
        /^Please review the following summary carefully and take the appropriate next action:\s*(.+)$/
      );
      if (summaryMatch) {
        message.summary = summaryMatch[1].trim();
        continue;
      }

      const kvMatch = line.match(/^- \*\*(.+?):\*\* `(.+)`$/);
      if (kvMatch) {
        const label = kvMatch[1].trim();
        const val = kvMatch[2].trim();
        switch (label) {
          case 'Message ID':
            message.id = val;
            break;
          case 'Intent Kind':
            message.kind = val;
            break;
          case 'Sender Workspace':
            message.from = val;
            break;
          case 'Recipient Workspace':
            message.to = val;
            break;
          case 'Repository':
            message.repository = val;
            break;
          case 'Issue Reference(s)':
            try {
              message.issue = JSON.parse(val);
            } catch (_) {
              const n = Number(val);
              message.issue = Number.isNaN(n) ? val : n;
            }
            break;
          case 'Pull Request':
            message.pr = Number(val.replace(/^#/, ''));
            break;
          case 'Base Branch':
            message.base = val;
            break;
          case 'Head Branch':
            message.head = val;
            break;
          case 'Head Commit SHA (headRefOid)':
            message.headRefOid = val;
            break;
          case 'Current Status':
            message.status = val;
            break;
          case 'Verdict':
            message.verdict = val;
            break;
          case 'Test Evidence':
            message.tests = val;
            break;
          case 'Review Round':
            message.round = Number(val);
            break;
          case 'Exchange Turn':
            message.turn = Number(val);
            break;
          default:
            break;
        }
        continue;
      }

      if (section === 'Allowed File Scope') {
        const fMatch = line.match(/^- `(.+)`$/);
        if (fMatch) scope.push(fMatch[1]);
      } else if (line.startsWith('- [CONSTRAINT] `')) {
        const m = line.match(/^- \[CONSTRAINT\] `(.+)`$/);
        if (m) constraints.push(m[1]);
      } else if (line.startsWith('- [DEPENDENCY] `')) {
        const m = line.match(/^- \[DEPENDENCY\] `(.+)`$/);
        if (m) {
          try {
            dependencies.push(JSON.parse(m[1]));
          } catch (_) {
            dependencies.push(m[1]);
          }
        }
      } else if (line.trim() === '- [FINDINGS_EMPTY]') {
        hasEmptyFindings = true;
      } else if (line.startsWith('- [FINDING] `')) {
        const m = line.match(/^- \[FINDING\] `(.+)`$/);
        if (m) {
          try {
            findings.push(JSON.parse(m[1]));
          } catch (_) {
            findings.push({ summary: m[1] });
          }
        }
      } else if (line.startsWith('- [ASSIGNMENT] `')) {
        const m = line.match(/^- \[ASSIGNMENT\] `(.+)`$/);
        if (m) {
          try {
            assignments.push(JSON.parse(m[1]));
          } catch (_) {
            assignments.push({ raw: m[1] });
          }
        }
      } else if (line.startsWith('- [SHARED_CONTEXT] `')) {
        const m = line.match(/^- \[SHARED_CONTEXT\] `(.+)`$/);
        if (m) {
          try {
            message.sharedContext = JSON.parse(m[1]);
          } catch (_) {
            // ignore
          }
        }
      }
    }

    if (scope.length > 0) message.scope = scope;
    if (constraints.length > 0) message.constraints = constraints;
    if (dependencies.length > 0) message.dependencies = dependencies;
    if (findings.length > 0 || hasEmptyFindings) message.findings = findings;
    if (assignments.length > 0) message.assignments = assignments;

    if (!message.kind || !message.from || !message.to) {
      return {
        ok: false,
        message: null,
        errors: ['Failed to extract required header fields (kind, from, to) from natural language payload'],
        warnings: []
      };
    }

    return {
      ok: true,
      message,
      errors: [],
      warnings: []
    };
  }
}

module.exports = {
  NaturalLanguageCodec
};
