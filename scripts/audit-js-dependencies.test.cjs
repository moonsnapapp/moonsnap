const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyAdvisories,
  parseAuditOutput,
} = require('./audit-js-dependencies.cjs');

test('parses Bun banner output and JSON report', () => {
  const report = parseAuditOutput(
    'bun audit v1.3.14\n{"vite":[{"severity":"high","title":"example","url":"https://example.test"}]}'
  );
  assert.equal(report.vite[0].severity, 'high');
});

test('blocks critical and high while retaining moderate and low findings', () => {
  const result = classifyAdvisories({
    criticalPackage: [{ severity: 'critical', title: 'critical', url: 'https://example.test/1' }],
    highPackage: [{ severity: 'high', title: 'high', url: 'https://example.test/2' }],
    moderatePackage: [{ severity: 'moderate', title: 'moderate', url: 'https://example.test/3' }],
    lowPackage: [{ severity: 'low', title: 'low', url: 'https://example.test/4' }],
  });

  assert.deepEqual(
    result.blocking.map((finding) => finding.packageName),
    ['criticalPackage', 'highPackage']
  );
  assert.deepEqual(
    result.nonBlocking.map((finding) => finding.packageName),
    ['moderatePackage', 'lowPackage']
  );
});

test('rejects output without a JSON report', () => {
  assert.throws(() => parseAuditOutput('bun audit failed'), /did not return a JSON report/);
});
