import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import ts from 'typescript';

const execFile = promisify(execFileCallback);
export const CAD_MCP_PACKAGE_NAME = '@bomwiki/cad-mcp';
export const CAD_MCP_PACKAGE_VERSION = '6.0.0-alpha.1';
export const CAD_MCP_PACKAGE_DIST_TAG = 'next';
const ENGINE_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(ENGINE_ROOT, '..');
const PACKAGE_FILES = [
  'static/studio-agent-service.js',
  'static/studio-sketch-solver.js',
  'static/studio-v5-runtime-document.js',
  'static/studio-project-v5.js',
  'static/studio-v5-modeling.js',
  'static/studio-v5-assembly.js',
  'static/studio-v5-inspection.js',
  'static/studio-document.js',
] as const;

const BIN_SOURCE = `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const server = resolve(import.meta.dirname, '..', 'scripts', 'studio-agent-mcp.js');
const child = spawn(process.execPath, [server, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
`;

export async function buildCadMcpPackage(outputDirectory?: string) {
  const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (!process.env.BOMWIKI_CAD_SOURCE_COMMIT && gitCommit.status !== 0) {
    throw new Error(`Unable to resolve the CAD MCP package source commit: ${gitCommit.stderr.trim()}`);
  }
  const sourceCommit = process.env.BOMWIKI_CAD_SOURCE_COMMIT || gitCommit.stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('CAD MCP package source commit must be one exact 40-character Git SHA.');
  }
  const workingRoot = await mkdtemp(join(tmpdir(), 'bomwiki-cad-mcp-package-'));
  const packageRoot = join(workingRoot, 'package');
  const outputRoot = resolve(outputDirectory || join(workingRoot, 'dist'));
  await mkdir(outputRoot, { recursive: true });

  for (const file of PACKAGE_FILES) {
    const target = join(packageRoot, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(ENGINE_ROOT, file), target);
  }
  await cp(join(ENGINE_ROOT, 'CAD_MCP_PACKAGE_README.md'), join(packageRoot, 'README.md'));
  await cp(join(ENGINE_ROOT, 'LICENSE'), join(packageRoot, 'LICENSE'));
  await mkdir(join(packageRoot, 'scripts'), { recursive: true });
  for (const sourceName of ['studio-agent-mcp.ts', 'studio-agent-loopback.ts']) {
    const source = await readFile(join(ENGINE_ROOT, 'scripts', sourceName), 'utf8');
    const compiled = ts.transpileModule(source, {
      fileName: sourceName,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        rewriteRelativeImportExtensions: true,
        verbatimModuleSyntax: true,
      },
    }).outputText;
    await writeFile(join(packageRoot, 'scripts', sourceName.replace(/\.ts$/, '.js')), compiled, 'utf8');
  }
  await cp(join(ENGINE_ROOT, 'skills', 'bomwiki-cad'), join(packageRoot, 'skills', 'bomwiki-cad'), { recursive: true });
  await mkdir(join(packageRoot, 'bin'), { recursive: true });
  const binPath = join(packageRoot, 'bin', 'bomwiki-cad-mcp.js');
  await writeFile(binPath, BIN_SOURCE, 'utf8');
  await chmod(binPath, 0o755);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: CAD_MCP_PACKAGE_NAME,
    version: CAD_MCP_PACKAGE_VERSION,
    description: 'Host-neutral MCP integration and canonical skill for BOMwiki CAD Studio.',
    type: 'module',
    bin: { 'bomwiki-cad-mcp': 'bin/bomwiki-cad-mcp.js' },
    files: ['bin', 'scripts', 'static', 'skills'],
    engines: { node: '>=22.6' },
    license: 'AGPL-3.0-only',
    publishConfig: {
      access: 'public',
      tag: CAD_MCP_PACKAGE_DIST_TAG,
      registry: 'https://registry.npmjs.org/',
    },
    repository: {
      type: 'git',
      url: 'https://github.com/BOMWiki/bomwiki.git',
      directory: 'engine',
    },
    homepage: 'https://bomwiki.com/cad/studio',
    bomwiki: {
      sourceCommit,
      protocolVersion: 'bomwiki.cad.agent/v1',
      uiProfile: 'bomwiki.cad.agentic-ui/v1',
      skillVersion: '0.6.0',
    },
  }, null, 2) + '\n', 'utf8');

  const { stdout } = await execFile('npm', ['pack', '--json', '--pack-destination', outputRoot], {
    cwd: packageRoot,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: join(workingRoot, 'npm-cache') },
  });
  const packed = JSON.parse(stdout)[0];
  const tarball = join(outputRoot, basename(packed.filename));
  const bytes = await readFile(tarball);
  return {
    name: CAD_MCP_PACKAGE_NAME,
    version: CAD_MCP_PACKAGE_VERSION,
    distTag: CAD_MCP_PACKAGE_DIST_TAG,
    sourceCommit,
    tarball,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    files: packed.files.map((entry: { path: string }) => entry.path).sort(),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  console.log(JSON.stringify(await buildCadMcpPackage(output), null, 2));
}
