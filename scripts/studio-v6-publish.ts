import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import {
  buildCadMcpPackage,
  CAD_MCP_PACKAGE_DIST_TAG,
  CAD_MCP_PACKAGE_NAME,
  CAD_MCP_PACKAGE_VERSION,
} from './studio-v6-package.ts';

const execFile = promisify(execFileCallback);
const engineRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(engineRoot, '..');
const npmRegistry = 'https://registry.npmjs.org/';
let externalMutationStarted = false;

type BuiltPackage = Awaited<ReturnType<typeof buildCadMcpPackage>>;

function fail(code: string, message: string): never {
  const error = new Error(message);
  (error as any).code = code;
  throw error;
}

export function assertCadMcpPublicationPlan(
  built: BuiltPackage,
  { expectedSha, expectedVersion }: { expectedSha: string; expectedVersion: string },
) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) {
    fail('INVALID_EXPECTED_SHA', 'Expected source SHA must be one exact 40-character lowercase Git SHA.');
  }
  if (built.sourceCommit !== expectedSha) {
    fail('SOURCE_SHA_MISMATCH', `Built package source ${built.sourceCommit} does not match expected ${expectedSha}.`);
  }
  if (built.name !== CAD_MCP_PACKAGE_NAME || built.version !== CAD_MCP_PACKAGE_VERSION) {
    fail('PACKAGE_IDENTITY_MISMATCH', 'Built package identity does not match the canonical V6 package constants.');
  }
  if (expectedVersion !== built.version) {
    fail('VERSION_MISMATCH', `Built package version ${built.version} does not match expected ${expectedVersion}.`);
  }
  if (!built.version.includes('-') || built.distTag !== CAD_MCP_PACKAGE_DIST_TAG || built.distTag !== 'next') {
    fail('STABLE_TAG_FORBIDDEN', 'The V6 alpha publisher may publish only a prerelease under the next dist-tag.');
  }
  return {
    name: built.name,
    version: built.version,
    distTag: built.distTag,
    sourceCommit: built.sourceCommit,
    bytes: built.bytes,
    sha256: built.sha256,
    confirmation: `publish:${built.name}@${built.version}:${built.sourceCommit}`,
  };
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function registryVersionExists(spec: string, npmEnv: NodeJS.ProcessEnv) {
  try {
    const result = await execFile('npm', ['view', spec, 'version', '--json', '--registry', npmRegistry], {
      cwd: engineRoot,
      env: npmEnv,
      maxBuffer: 1024 * 1024,
    });
    return { exists: true, version: JSON.parse(result.stdout) };
  } catch (error: any) {
    const diagnostics = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    if (/\bE404\b|404 Not Found/.test(diagnostics)) return { exists: false, version: null };
    throw error;
  }
}

async function verifyRegistryPackage(
  built: BuiltPackage,
  npmEnv: NodeJS.ProcessEnv,
  { attempts = 1 }: { attempts?: number } = {},
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const verificationRoot = await mkdtemp(resolve(tmpdir(), 'bomwiki-cad-mcp-registry-verify-'));
    try {
      const packed = await execFile('npm', [
        'pack',
        `${built.name}@${built.version}`,
        '--json',
        '--pack-destination', verificationRoot,
        '--registry', npmRegistry,
      ], {
        cwd: engineRoot,
        env: npmEnv,
        maxBuffer: 4 * 1024 * 1024,
      });
      const registryTarball = resolve(verificationRoot, JSON.parse(packed.stdout)[0].filename);
      const registryBytes = await readFile(registryTarball);
      const registrySha256 = createHash('sha256').update(registryBytes).digest('hex');
      if (registrySha256 !== built.sha256) {
        fail('REGISTRY_BYTES_MISMATCH', `Registry tarball ${registrySha256} does not match reviewed tarball ${built.sha256}.`);
      }
      const tagsResult = await execFile('npm', ['view', built.name, 'dist-tags', '--json', '--registry', npmRegistry], {
        cwd: engineRoot,
        env: npmEnv,
        maxBuffer: 1024 * 1024,
      });
      const distTags = JSON.parse(tagsResult.stdout);
      if (distTags.next !== built.version || distTags.latest === built.version) {
        fail('DIST_TAG_MISMATCH', 'Registry dist-tags do not preserve the reviewed prerelease boundary.');
      }
      return {
        registryTarball: basename(registryTarball),
        registrySha256,
        distTags,
      };
    } catch (error: any) {
      lastError = error;
      if (error?.code === 'REGISTRY_BYTES_MISMATCH' || attempt === attempts) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
    } finally {
      await rm(verificationRoot, { recursive: true, force: true });
    }
  }
  throw lastError;
}

async function publish() {
  const publishRequested = process.argv.includes('--publish');
  const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (gitCommit.status !== 0) fail('GIT_STATE_UNAVAILABLE', `Unable to resolve source commit: ${gitCommit.stderr.trim()}`);
  const checkoutSha = gitCommit.stdout.trim();
  const expectedSha = argument('--expected-sha') || checkoutSha;
  if (expectedSha !== checkoutSha) {
    fail('CHECKOUT_SHA_MISMATCH', `Expected source ${expectedSha} does not match checked-out commit ${checkoutSha}.`);
  }
  const expectedVersion = argument('--expected-version') || CAD_MCP_PACKAGE_VERSION;
  const outputRoot = resolve(argument('--output') || await mkdtemp(resolve(tmpdir(), 'bomwiki-cad-mcp-publish-')));
  const ownsOutputRoot = !argument('--output');
  const npmCache = await mkdtemp(resolve(tmpdir(), 'bomwiki-cad-mcp-npm-cache-'));
  const npmEnv = { ...process.env, npm_config_cache: npmCache };
  try {
    await mkdir(outputRoot, { recursive: true });
    const built = await buildCadMcpPackage(outputRoot);
    const plan = assertCadMcpPublicationPlan(built, { expectedSha, expectedVersion });
    if (!publishRequested) {
      console.log(JSON.stringify({
        mode: 'plan-only',
        externalMutation: false,
        ...plan,
        artifactRetained: !ownsOutputRoot,
        ...(!ownsOutputRoot ? { tarball: built.tarball } : {}),
      }, null, 2));
      return;
    }

    const gitStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (gitStatus.status !== 0) fail('GIT_STATE_UNAVAILABLE', `Unable to verify worktree state: ${gitStatus.stderr.trim()}`);
    if (gitStatus.stdout.trim()) fail('DIRTY_WORKTREE', 'Refusing external publication from a dirty worktree.');
    const confirmation = argument('--confirm');
    if (confirmation !== plan.confirmation) {
      fail('CONFIRMATION_REQUIRED', `External publication requires --confirm ${JSON.stringify(plan.confirmation)}.`);
    }
    const identity = await execFile('npm', ['whoami', '--registry', npmRegistry], {
      cwd: engineRoot,
      env: npmEnv,
      maxBuffer: 1024 * 1024,
    }).catch((error: any) => {
      fail('NPM_AUTH_REQUIRED', `npm authentication is required before first publication: ${String(error?.stderr || error?.message || error).trim()}`);
    });
    const existing = await registryVersionExists(`${built.name}@${built.version}`, npmEnv);
    if (existing.exists) {
      const verified = await verifyRegistryPackage(built, npmEnv);
      console.log(JSON.stringify({
        mode: 'already-published-and-verified',
        externalMutation: false,
        npmIdentity: identity.stdout.trim(),
        ...plan,
        ...verified,
      }, null, 2));
      return;
    }

    const publishArgs = [
      'publish',
      built.tarball,
      '--access', 'public',
      '--tag', built.distTag,
      '--registry', npmRegistry,
    ];
    if (process.env.GITHUB_ACTIONS === 'true') publishArgs.push('--provenance');
    externalMutationStarted = true;
    await execFile('npm', publishArgs, {
      cwd: engineRoot,
      env: npmEnv,
      maxBuffer: 4 * 1024 * 1024,
    });

    const verified = await verifyRegistryPackage(built, npmEnv, { attempts: 20 });
    console.log(JSON.stringify({
      mode: 'published-and-verified',
      externalMutation: true,
      npmIdentity: identity.stdout.trim(),
      ...plan,
      ...verified,
    }, null, 2));
  } finally {
    await rm(npmCache, { recursive: true, force: true });
    if (ownsOutputRoot) await rm(outputRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(import.meta.filename)) {
  try {
    await publish();
  } catch (error: any) {
    console.error(JSON.stringify({
      status: 'publication-refused',
      externalMutation: externalMutationStarted ? 'possible-or-complete' : false,
      code: error?.code || 'PUBLICATION_FAILED',
      message: String(error?.message || error),
    }, null, 2));
    process.exitCode = 1;
  }
}
