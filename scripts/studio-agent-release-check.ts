import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error Browser-native module intentionally has no declarations.
import { cadCapabilityManifest } from '../static/studio-agent-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const repoRoot = join(engineRoot, '..');
const outputPath = join(engineRoot, 'var', 'studio-agent-release-manifest.json');
const checks = [
  ['core', 'scripts/studio-agent-check.ts', 'all'],
  ['headless', 'scripts/studio-agent-headless-check.ts'],
  ['mcp', 'scripts/studio-agent-mcp-check.ts'],
  ['live-parity', 'scripts/studio-agent-browser-check.ts'],
  ['public-turbofan-replay', 'scripts/studio-agent-turbofan-check.ts'],
  ['v5-benchmarks', 'scripts/studio-v5-benchmarks-check.ts', 'all'],
] as const;

function runNode(script: string, mode?: string) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script, ...(mode ? [mode] : [])], {
    cwd: engineRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = (result.stdout || '') + (result.stderr || '');
  return {
    status: result.status === 0 ? 'pass' : 'fail',
    exitCode: result.status,
    outputSha256: createHash('sha256').update(output).digest('hex'),
    outputTail: output.trim().split('\n').slice(-8),
  };
}

const results = Object.fromEntries(checks.map(([name, script, mode]) => [name, runNode(script, mode)]));
const capabilities = cadCapabilityManifest({ exactKernel: false });
const capabilityJson = JSON.stringify(capabilities);
const requiredTurbofanOperations = ['datum.create', 'body.transform', 'feature.loft', 'feature.sweep', 'pattern.create', 'component.createPart', 'component.insert', 'component.pattern', 'mate.create', 'section.create'];
const byOperation = new Map(capabilities.operations.map((entry: any) => [entry.kind, entry]));
const turbofanBlockedBy = requiredTurbofanOperations.flatMap((kind) => {
  const capability: any = byOperation.get(kind);
  return capability?.state === 'available' ? [] : [{ kind, reasonCode: capability?.disabledReasonCode || 'CAPABILITY_NOT_IMPLEMENTED' }];
});
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim() || null;
const foundationPass = Object.values(results).every((entry) => entry.status === 'pass');
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceCommit: commit,
  protocolVersion: capabilities.protocolVersion,
  studioVersion: capabilities.studioVersion,
  schemaVersions: capabilities.schemaVersions,
  kernelVersion: capabilities.kernelVersion,
  capabilityManifestSha256: createHash('sha256').update(capabilityJson).digest('hex'),
  checks: results,
  gates: {
    agentFoundation: foundationPass ? 'pass' : 'fail',
    agentTurbofan: results['public-turbofan-replay'].status === 'pass' && turbofanBlockedBy.length === 0 ? 'pass' : 'fail',
    turbofanAndGeneralityAutomated: results['v5-benchmarks'].status,
    humanVisualReview: 'required-before-v5-release-signoff',
    liveDeployment: 'not-run-by-local-release-check',
  },
  turbofanBlockedBy,
  status: foundationPass && turbofanBlockedBy.length === 0 ? 'automated-candidate-pass' : 'fail',
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({ ...manifest, manifestPath: outputPath }, null, 2));
if (manifest.status !== 'automated-candidate-pass') process.exitCode = 1;
