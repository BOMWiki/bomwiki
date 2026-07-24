import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import { buildCadMcpPackage } from './studio-v6-package.ts';
import { assertCadMcpPublicationPlan } from './studio-v6-publish.ts';

const execFile = promisify(execFileCallback);
let passed = 0;
let failed = 0;

function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

console.log('\nCAD Studio V6 installable agent package');
const root = await mkdtemp(join(tmpdir(), 'bomwiki-cad-mcp-install-'));
const npmEnv = { ...process.env, npm_config_cache: join(root, 'npm-cache') };
const built = await buildCadMcpPackage(join(root, 'artifacts'));
const rebuilt = await buildCadMcpPackage(join(root, 'artifacts-rebuilt'));
check('package build produces a checksummed npm artifact',
  built.name === '@bomwiki/cad-mcp' &&
  built.version === '6.0.0-alpha.1' &&
  built.distTag === 'next' &&
  /^[a-f0-9]{40}$/.test(built.sourceCommit) &&
  built.bytes > 0 &&
  /^[a-f0-9]{64}$/.test(built.sha256));
check('the same source commit rebuilds byte-identical package contents',
  rebuilt.sourceCommit === built.sourceCommit &&
  rebuilt.bytes === built.bytes &&
  rebuilt.sha256 === built.sha256 &&
  rebuilt.files.join('\n') === built.files.join('\n'),
  { first: built.sha256, rebuilt: rebuilt.sha256 });
check('package contains the host-neutral server, bridge, exact document runtime, and canonical skill',
  [
    'bin/bomwiki-cad-mcp.js',
    'scripts/studio-agent-mcp.js',
    'scripts/studio-agent-loopback.js',
    'static/studio-agent-service.js',
    'README.md',
    'LICENSE',
    'skills/bomwiki-cad/SKILL.md',
    'skills/bomwiki-cad/agents/openai.yaml',
  ].every((file) => built.files.includes(file)), built.files);

const publishDryRun = await execFile('npm', [
  'publish',
  '--dry-run',
  '--access', 'public',
  '--tag', built.distTag,
  built.tarball,
], {
  cwd: root,
  maxBuffer: 4 * 1024 * 1024,
  env: npmEnv,
});
check('npm publication plan keeps the alpha candidate off the stable latest tag',
  `${publishDryRun.stdout}\n${publishDryRun.stderr}`.includes('tag next') &&
  !`${publishDryRun.stdout}\n${publishDryRun.stderr}`.includes('tag latest'));

await execFile('npm', ['init', '--yes'], { cwd: root, env: npmEnv });
await execFile('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', built.tarball], {
  cwd: root,
  maxBuffer: 4 * 1024 * 1024,
  env: npmEnv,
});
const packageJson = JSON.parse(await readFile(join(root, 'node_modules', '@bomwiki', 'cad-mcp', 'package.json'), 'utf8'));
check('npm installs the package with a callable bomwiki-cad-mcp binary',
  packageJson.name === '@bomwiki/cad-mcp' &&
  packageJson.publishConfig?.access === 'public' &&
  packageJson.publishConfig?.tag === 'next' &&
  packageJson.publishConfig?.registry === 'https://registry.npmjs.org/' &&
  packageJson.bin?.['bomwiki-cad-mcp'] === 'bin/bomwiki-cad-mcp.js' &&
  packageJson.bomwiki?.sourceCommit === built.sourceCommit &&
  packageJson.bomwiki?.skillVersion === '0.6.0');
const publicationPlan = assertCadMcpPublicationPlan(built, {
  expectedSha: built.sourceCommit,
  expectedVersion: built.version,
});
let mismatchedPublication: any = null;
try {
  assertCadMcpPublicationPlan(built, {
    expectedSha: '0'.repeat(40),
    expectedVersion: built.version,
  });
} catch (error) {
  mismatchedPublication = error;
}
check('guarded publisher binds prerelease identity, source SHA, tarball hash, and exact confirmation',
  publicationPlan.distTag === 'next' &&
  publicationPlan.sha256 === built.sha256 &&
  publicationPlan.confirmation === `publish:${built.name}@${built.version}:${built.sourceCommit}` &&
  mismatchedPublication?.code === 'SOURCE_SHA_MISMATCH');

const child = spawn(join(root, 'node_modules', '.bin', 'bomwiki-cad-mcp'), [
  '--bridge-port', '0',
  '--permissions', 'project.read',
], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.setEncoding('utf8');
let buffer = '';
const pending: Array<(value: any) => void> = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    pending.shift()?.(JSON.parse(line));
  }
});
let rpcId = 0;
function rpc(method: string, params?: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for installed MCP package. stderr=${stderr}`)), 10_000);
    pending.push((message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }) + '\n');
  });
}

const initialized = await rpc('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'portable-package-check', version: '1.0.0' },
});
const resources = await rpc('resources/list');
const capabilities = await rpc('tools/call', { name: 'cad_capabilities', arguments: {} });
check('installed package initializes through standard MCP with canonical skill resources',
  initialized.result?.serverInfo?.name === 'bomwiki-cad' &&
  resources.result?.resources?.some((entry: any) => entry.uri === 'bomwiki-cad://skills/core') &&
  capabilities.result?.structuredContent?.skillCompatibility?.skillId === 'bomwiki-cad');

child.stdin.end();
await new Promise<void>((resolve) => child.once('exit', () => resolve()));
check('installed package exits cleanly and writes only JSON-RPC on stdout',
  child.exitCode === 0 && buffer === '' && stderr === '', { exitCode: child.exitCode, stderr, buffer });

console.log(`\n${passed}/${passed + failed} V6 package checks passed`);
if (failed) process.exitCode = 1;
