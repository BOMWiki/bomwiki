import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// @ts-expect-error Browser-native module intentionally has no declarations.
import { CadCommandService, cadCapabilityManifest } from '../static/studio-agent-service.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { canonicalStudioV5Project, parseOrMigrateStudioV5RuntimeProject } from '../static/studio-v5-runtime-document.js';

const args = process.argv.slice(2);
const command = args[0];
const rootFlag = args.indexOf('--root');
const projectRoot = resolve(rootFlag >= 0 && args[rootFlag + 1] ? args[rootFlag + 1] : process.cwd());

function flag(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positional(index: number) {
  return args[index];
}

function output(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function fail(code: string, message: string): never {
  const error = Object.assign(new Error(message), { code });
  throw error;
}

function isInside(root: string, candidate: string) {
  const suffix = relative(root, candidate);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

async function inputPath(path: string | undefined) {
  if (!path) fail('INVALID_PATH', 'A project path is required.');
  const root = await realpath(projectRoot);
  const candidate = await realpath(resolve(path));
  if (!isInside(root, candidate)) fail('PATH_OUTSIDE_SCOPE', 'Input path is outside --root.');
  if (!(await stat(candidate)).isFile()) fail('INVALID_PATH', 'Input path must be a regular file.');
  return candidate;
}

async function outputPath(path: string | undefined) {
  if (!path) fail('INVALID_PATH', '--out is required.');
  const root = await realpath(projectRoot);
  const candidate = resolve(path);
  const parent = await realpath(dirname(candidate));
  if (!isInside(root, parent)) fail('PATH_OUTSIDE_SCOPE', 'Output path is outside --root.');
  try {
    const existing = await realpath(candidate);
    if (!isInside(root, existing)) fail('PATH_OUTSIDE_SCOPE', 'Output symlink escapes --root.');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return candidate;
}

async function loadService(path: string | undefined) {
  const source = await inputPath(path);
  const project = parseOrMigrateStudioV5RuntimeProject(await readFile(source, 'utf8'));
  return { source, service: new CadCommandService({ project }) };
}

const fullScope = (projectId: string) => ({
  granted: ['project.read', 'project.edit', 'project.save-new', 'artifact.export-project'],
  projectIds: [projectId],
});

async function main() {
  if (command === 'capabilities') {
    output(cadCapabilityManifest({ exactKernel: false }));
    return;
  }
  if (!command || command === 'help' || command === '--help') {
    output({
      usage: [
        'bomcad capabilities',
        'bomcad inspect <project> [--query <json>]',
        'bomcad validate <project>',
        'bomcad preview <project> --transaction <file>',
        'bomcad apply <project> --transaction <file> --out <project>',
        'bomcad replay <project> --journal <file> --out <project>',
      ],
      note: 'All file paths are confined to --root (default: current directory). STEP/STL/render require an exact browser-kernel adapter and are not claimed by this CLI.',
    });
    return;
  }
  const { source, service } = await loadService(positional(1));
  const projectId = service.snapshot().projectId;
  const scope = fullScope(projectId);
  if (command === 'inspect') {
    const query = flag('--query') ? JSON.parse(flag('--query')!) : { kind: 'project.summary' };
    output({ source, revision: service.revision, result: service.inspect(query) });
    return;
  }
  if (command === 'validate') {
    output({ source, revision: service.revision, valid: true, summary: service.inspect(), documentHash: service.inspect().documentHash, exactGeometry: false });
    return;
  }
  if (command === 'render' || command === 'export') fail('EXACT_KERNEL_REQUIRED', command + ' requires the browser exact-kernel adapter.');
  const transactionPath = flag('--transaction');
  if (command === 'preview' || command === 'apply') {
    const txFile = await inputPath(transactionPath);
    const transaction = JSON.parse(await readFile(txFile, 'utf8'));
    const preview = await service.preview(transaction, scope);
    if (command === 'preview') {
      output({ source, transaction: txFile, revision: service.revision, preview });
      return;
    }
    const committed = await service.commit(preview.previewId, transaction.expectedRevision, scope);
    const target = await outputPath(flag('--out'));
    const text = JSON.stringify(canonicalStudioV5Project(service.snapshot()), null, 2) + '\n';
    await writeFile(target, text, { encoding: 'utf8', mode: 0o600 });
    output({ source, transaction: txFile, output: target, revision: service.revision, committed, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
    return;
  }
  if (command === 'replay') {
    const journalPath = await inputPath(flag('--journal'));
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    if (!Array.isArray(journal)) fail('INVALID_JOURNAL', 'Replay journal must be an array of transactions.');
    const results = [];
    for (const sourceTransaction of journal) {
      const transaction = { ...sourceTransaction, expectedRevision: service.revision };
      const preview = await service.preview(transaction, scope);
      results.push(await service.commit(preview.previewId, service.revision, scope));
    }
    const target = await outputPath(flag('--out'));
    const text = JSON.stringify(canonicalStudioV5Project(service.snapshot()), null, 2) + '\n';
    await writeFile(target, text, { encoding: 'utf8', mode: 0o600 });
    output({ source, journal: journalPath, output: target, revision: service.revision, commands: results.length, documentHash: service.inspect().documentHash, sha256: createHash('sha256').update(text).digest('hex') });
    return;
  }
  fail('UNKNOWN_COMMAND', 'Unknown bomcad command "' + command + '".');
}

try {
  await main();
} catch (error: any) {
  process.stdout.write(JSON.stringify({ status: 'error', code: error?.code || 'BOMCAD_FAILED', message: String(error?.message || error) }) + '\n');
  process.exitCode = 1;
}
