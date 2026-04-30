#!/usr/bin/env node
/**
 * CareCoord Regression Test Bot
 *
 * Boots an isolated test server, runs all API integration tests,
 * and prints a formatted pass/fail report.
 *
 * Usage:
 *   node tests/run.js              Run all suites
 *   node tests/run.js auth         Run only the auth suite
 *   node tests/run.js tickets dash Run specific suites
 */
const { createTestServer } = require('./setup');

// Suppress noisy console output from server during tests
const originalLog = console.log;
const originalError = console.error;
let suppressLogs = true;
console.log = (...args) => { if (!suppressLogs) originalLog(...args); };
console.error = (...args) => { if (!suppressLogs) originalError(...args); };

// ── Suite Registry ────────────────────────────────────────────────────────────

const SUITES = {
  health:    { name: 'Health & Reference',  file: './suites/health' },
  auth:      { name: 'Auth API',            file: './suites/auth' },
  tickets:   { name: 'Tickets API',         file: './suites/tickets' },
  dashboard: { name: 'Dashboard API',       file: './suites/dashboard' },
  admin:     { name: 'Admin API',           file: './suites/admin' },
  chat:      { name: 'Chat API',            file: './suites/chat' },
};

// ── Output Formatting ─────────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';  // green check
const FAIL = '\x1b[31m✗\x1b[0m';  // red x
const BOLD = '\x1b[1m';
const DIM  = '\x1b[2m';
const RED  = '\x1b[31m';
const GRN  = '\x1b[32m';
const YEL  = '\x1b[33m';
const CYN  = '\x1b[36m';
const RST  = '\x1b[0m';

function printHeader() {
  originalLog('');
  originalLog(CYN + '╔══════════════════════════════════════════════════╗' + RST);
  originalLog(CYN + '║' + RST + BOLD + '       CareCoord Regression Test Bot            ' + RST + CYN + '║' + RST);
  originalLog(CYN + '╚══════════════════════════════════════════════════╝' + RST);
  originalLog('');
}

function printSuiteHeader(name) {
  originalLog(DIM + '── ' + RST + BOLD + name + RST + DIM + ' ' + '─'.repeat(Math.max(1, 46 - name.length)) + RST);
}

function printResult(r) {
  if (r.passed) {
    originalLog('  ' + PASS + ' ' + r.name);
  } else {
    originalLog('  ' + FAIL + ' ' + RED + r.name + RST);
    originalLog('    ' + DIM + r.error + RST);
  }
}

function printFooter(totalPassed, totalFailed, totalCount, elapsed, failures) {
  originalLog('');
  originalLog(CYN + '══════════════════════════════════════════════════' + RST);

  if (totalFailed === 0) {
    originalLog(GRN + BOLD + '  ALL ' + totalCount + ' TESTS PASSED' + RST + DIM + '  (' + elapsed + ')' + RST);
  } else {
    originalLog(RED + BOLD + '  ' + totalFailed + ' FAILED' + RST + ', ' + GRN + totalPassed + ' passed' + RST + ', ' + totalCount + ' total' + DIM + '  (' + elapsed + ')' + RST);
    originalLog('');
    originalLog(RED + BOLD + '  Failed tests:' + RST);
    for (const f of failures) {
      originalLog('  ' + FAIL + ' ' + f.suite + ' > ' + f.name);
      originalLog('    ' + DIM + f.error + RST);
    }
  }

  originalLog(CYN + '══════════════════════════════════════════════════' + RST);
  originalLog('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  printHeader();

  // Determine which suites to run
  const args = process.argv.slice(2).map(a => a.toLowerCase());
  let suiteKeys = Object.keys(SUITES);
  if (args.length > 0) {
    suiteKeys = args.filter(a => SUITES[a]);
    if (suiteKeys.length === 0) {
      originalLog(RED + 'Unknown suite(s): ' + args.join(', ') + RST);
      originalLog('Available: ' + Object.keys(SUITES).join(', '));
      process.exit(1);
    }
  }

  // Boot server
  originalLog(DIM + '  Starting test server...' + RST);
  let ctx;
  try {
    ctx = await createTestServer();
  } catch (err) {
    suppressLogs = false;
    originalLog(RED + '  Failed to start test server: ' + err.message + RST);
    originalLog(err.stack);
    process.exit(1);
  }
  originalLog(DIM + '  Server running on port ' + ctx.port + RST);
  originalLog('');

  let totalPassed = 0;
  let totalFailed = 0;
  const failures = [];

  // Run each suite
  for (const key of suiteKeys) {
    const suite = SUITES[key];
    printSuiteHeader(suite.name);

    try {
      const suiteFn = require(suite.file);
      const results = await suiteFn(ctx.port);

      for (const r of results) {
        printResult(r);
        if (r.passed) {
          totalPassed++;
        } else {
          totalFailed++;
          failures.push({ suite: suite.name, name: r.name, error: r.error });
        }
      }
    } catch (err) {
      originalLog('  ' + FAIL + ' ' + RED + 'Suite crashed: ' + err.message + RST);
      originalLog('    ' + DIM + err.stack + RST);
      totalFailed++;
      failures.push({ suite: suite.name, name: 'SUITE CRASH', error: err.message });
    }
    originalLog('');
  }

  // Cleanup
  try { ctx.cleanup(); } catch (e) {}

  // Report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
  printFooter(totalPassed, totalFailed, totalPassed + totalFailed, elapsed, failures);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  suppressLogs = false;
  originalLog(RED + 'Bot crashed: ' + err.message + RST);
  originalLog(err.stack);
  process.exit(1);
});
