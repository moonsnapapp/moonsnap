const { spawnSync } = require('node:child_process');

const BLOCKING_SEVERITIES = new Set(['critical', 'high']);

function parseAuditOutput(output) {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error('bun audit did not return a JSON report');
  }
  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

function classifyAdvisories(report) {
  const blocking = [];
  const nonBlocking = [];

  for (const [packageName, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      const finding = { ...advisory, packageName };
      if (BLOCKING_SEVERITIES.has(advisory.severity.toLowerCase())) {
        blocking.push(finding);
      } else {
        nonBlocking.push(finding);
      }
    }
  }

  return { blocking, nonBlocking };
}

function formatFinding(finding) {
  return `${finding.severity.toUpperCase()} ${finding.packageName}: ${finding.title} (${finding.url})`;
}

function runAudit() {
  const command = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const result = spawnSync(command, ['audit', '--json'], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  const report = parseAuditOutput(`${result.stdout}\n${result.stderr}`);
  const { blocking, nonBlocking } = classifyAdvisories(report);

  for (const finding of nonBlocking) {
    console.warn(`Non-blocking advisory: ${formatFinding(finding)}`);
  }

  if (blocking.length > 0) {
    console.error(`JavaScript dependency audit found ${blocking.length} blocking advisory(s):`);
    for (const finding of blocking) {
      console.error(`- ${formatFinding(finding)}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `JavaScript dependency audit passed: no critical/high advisories (${nonBlocking.length} moderate/low reported).`
  );
}

if (require.main === module) {
  try {
    runAudit();
  } catch (error) {
    console.error(`JavaScript dependency audit failed to run: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { classifyAdvisories, parseAuditOutput };
