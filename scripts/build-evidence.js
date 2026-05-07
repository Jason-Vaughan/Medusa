const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
};

const resultsPath = '.tmp/test-results.json';
const coverageSummaryPath = 'coverage/coverage-summary.json';

if (!fs.existsSync(resultsPath)) {
  console.error('Missing test results — run with --json --outputFile=.tmp/test-results.json');
  process.exit(1);
}

if (!fs.existsSync(coverageSummaryPath)) {
  console.error('Missing coverage summary — run with --coverage flag');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const coverage = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));

const jestDurationMs = results.testResults.reduce(
  (sum, file) => sum + ((file.endTime - file.startTime) ?? 0),
  0
);

const modulesUnderTest = [...new Set(
  results.testResults
    .map((r) => r.name.replace(/.*\/(?:lib|src)\//, '').replace(/\.test\.js$/, ''))
    .filter(Boolean)
)];

// Try to get chunk ID
let chunkId = process.env.PRAWDUCT_CHUNK_ID;
if (!chunkId && fs.existsSync('.prawduct/current-chunk')) {
  chunkId = fs.readFileSync('.prawduct/current-chunk', 'utf8').trim();
} else if (!chunkId) {
  chunkId = 'chunk-33'; // Default for Phase 2
}

const evidence = {
  schemaVersion: '1.0.0',
  chunkId,
  commit: sh('git rev-parse HEAD'),
  branch: sh('git rev-parse --abbrev-ref HEAD'),
  dirty: sh('git status --porcelain').length > 0,
  timestamp: new Date().toISOString(),
  tests: {
    passed: results.numPassedTests,
    failed: results.numFailedTests,
    skipped: results.numPendingTests,
    durationMs: jestDurationMs,
  },
  coverage: {
    lines: coverage.total.lines.pct,
    branches: coverage.total.branches.pct,
    functions: coverage.total.functions.pct,
    statements: coverage.total.statements.pct,
  },
  mutation: tryReadMutationScore(),
  filesChanged: tryGitFilesChanged(),
  modulesUnderTest,
};

fs.writeFileSync('.test-evidence.json', JSON.stringify(evidence, null, 2));

// Append-only history
const historyPath = 'docs/test-evidence-history.jsonl';
if (!fs.existsSync(path.dirname(historyPath))) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
}
fs.appendFileSync(historyPath, JSON.stringify(evidence) + '\n');

console.log(`✓ .test-evidence.json written (${evidence.tests.passed} passed, ${evidence.tests.failed} failed)`);
if (evidence.tests.failed > 0) process.exit(1);

// --- helpers ---

function tryReadMutationScore() {
  const path = 'reports/mutation/mutation.json';
  if (!fs.existsSync(path)) return null;
  const m = JSON.parse(fs.readFileSync(path, 'utf8'));
  
  // Handle Stryker 6+ (Mutation Testing Elements format)
  if (m.files && (m.systemUnderTest === undefined && m.mutationScore === undefined)) {
    let killed = 0;
    let survived = 0;
    let timeout = 0;
    let noCoverage = 0;
    
    Object.values(m.files).forEach(file => {
      file.mutants.forEach(mutant => {
        if (mutant.status === 'Killed') killed++;
        else if (mutant.status === 'Survived') survived++;
        else if (mutant.status === 'Timeout') timeout++;
        else if (mutant.status === 'NoCoverage') noCoverage++;
      });
    });
    
    const total = killed + survived + timeout + noCoverage;
    const score = total > 0 ? ((killed + timeout) / total) * 100 : null;
    
    return {
      score: score !== null ? parseFloat(score.toFixed(2)) : null,
      killed: killed + timeout,
      survived: survived + noCoverage
    };
  }

  const summary = m.systemUnderTest ?? m;
  return {
    score: summary.mutationScore ?? null,
    killed: summary.killed ?? null,
    survived: summary.survived ?? null,
  };
}

function tryGitFilesChanged() {
  try {
    return sh('git diff --name-only HEAD~1').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
