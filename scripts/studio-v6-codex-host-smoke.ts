import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { buildCadMcpPackage } from './studio-v6-package.ts';

const execFile = promisify(execFileCallback);
const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '..');
const repoRoot = resolve(engineRoot, '..');
const evidencePath = join(engineRoot, 'var', 'studio-v6-codex-host-smoke.json');
const clientLabel = 'Codex V6 packaged live-host smoke';
const bridgePort = 49784;
const defaultCodexBin = '/Applications/ChatGPT.app/Contents/Resources/codex';
const codexBin = process.env.BOMWIKI_CODEX_BIN || (existsSync(defaultCodexBin) ? defaultCodexBin : 'codex');
const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

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

async function startStudioServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const staticDir = join(engineRoot, 'static');
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (path.startsWith('/static/')) {
      const file = resolve(staticDir, path.slice('/static/'.length));
      if (file.startsWith(`${staticDir}${sep}`) && existsSync(file)) {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        response.end(readFileSync(file));
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}/cad/studio` };
}

async function createStudioPage(browser: Browser, url: string) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  await page.evaluateOnNewDocument(() => {
    if (window.top !== window) return;
    try {
      localStorage.setItem('bw-studio-welcome-v1', '1');
      localStorage.setItem('bw-studio-v2-seeded', '1');
      localStorage.setItem('bw-studio-tour-v1', '1');
      localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
        title: 'Codex live-host smoke fixture',
        units: 'mm',
        params: [],
        features: [{
          id: 'feature-codex-host',
          name: 'Codex host plate',
          type: 'extrude',
          sketch: { shapes: [{ kind: 'rect', x: -18, y: -12, w: 36, h: 24 }], z: 0 },
          h: 6,
          through: false,
        }],
      }));
    } catch {
      // Opaque subframes cannot read Studio storage and do not need the fixture.
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });
  return { page, pageErrors, requestFailures };
}

async function approveAsHuman(page: Page) {
  await page.waitForFunction(() => Boolean(document.getElementById('bw-help-open')), { polling: 50, timeout: 30_000 });
  let discovered = false;
  for (let attempt = 0; attempt < 240 && !discovered; attempt++) {
    discovered = await fetch(`http://127.0.0.1:${bridgePort}/.well-known/bomwiki-cad`, {
      cache: 'no-store',
    }).then((response) => response.ok, () => false);
    if (!discovered) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  if (!discovered) throw new Error('Codex did not create the fixed local bridge within 60 seconds.');
  await page.evaluate(() => {
    (document.getElementById('bw-help-open') as HTMLButtonElement | null)?.click();
    (document.getElementById('bw-help-agent') as HTMLButtonElement | null)?.click();
  });
  await page.waitForFunction((label) => [...document.querySelectorAll('.ws-agent-pair[open] h2')]
    .some((heading) => (heading.textContent || '').includes(label)), { polling: 50, timeout: 30_000 }, clientLabel);
  const approval = await page.evaluate((label) => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => (candidate.querySelector('h2')?.textContent || '').includes(label));
    const button = dialog?.querySelector<HTMLButtonElement>('button[value="approve"]');
    if (!dialog || !button) throw new Error('Visible Codex connection approval is missing.');
    const result = {
      labelled: Boolean(dialog.getAttribute('aria-labelledby')),
      described: Boolean(dialog.getAttribute('aria-describedby')),
      focused: dialog.contains(document.activeElement),
      approveControlId: button.dataset.v6ControlId,
    };
    dialog.close(button.value);
    dialog.dispatchEvent(new Event('close'));
    return result;
  }, clientLabel);
  return approval;
}

function codexPrompt() {
  return [
    'Use only the bomwiki_cad MCP server for this test. Do not use shell, browser, Computer Use, DOM, selectors, coordinates, keyboard, or screenshots.',
    '1. Call cad_capabilities with default compact discovery and read bomwiki-cad://skills/core.',
    `2. Call cad_session connect with clientLabel "${clientLabel}", mode "read-only", and granted permissions project.read, ui.read, ui.select, ui.navigate, and ui.present-demo.`,
    '3. A human test observer will perform the one visible Studio approval. Do not open the launch URL and do not ask for copy/paste. Poll cad_session status until connected.',
    '4. Call cad_ui capabilities with default summary, then snapshot. If the renderer is not idle, request the schema for presentation.waitForSettled and apply that exact action before continuing.',
    '5. Inspect project.tree, choose the first body, and request schemas only for workspace.activate, selection.set, tree.reveal, inspector.showEntity, and viewport.fitAll.',
    '6. Apply one normal semantic UI batch that activates the view workspace, selects and reveals that body, opens its inspector, and fits the model.',
    '7. Confirm the returned snapshot has a newer UI revision, the selected body, and workspaceId view.',
    'Return exactly one line: CODEX_CAD_LIVE PASS profile=<profile> skill=<skill-version> project=<project-id> body=<body-id> uiRevision=<revision>.',
    'Return CODEX_CAD_LIVE FAIL with the exact structured error if any required step fails.',
  ].join('\n');
}

async function collectCodex(child: ReturnType<typeof spawn>, timeoutMs = 240_000) {
  let stdout = '';
  let stderr = '';
  if (!child.stdout || !child.stderr) throw new Error('Codex smoke requires piped stdout and stderr.');
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Codex live-host smoke exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
  const events: any[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Codex diagnostics are not evidence and remain on stderr or ignored text.
    }
  }
  return { ...exit, stdout, stderr, events };
}

console.log('\nCAD Studio V6 real Codex packaged live-host smoke');
const workingRoot = await mkdtemp(join(tmpdir(), 'bomwiki-v6-codex-live-'));
try {
const packageRoot = join(workingRoot, 'consumer');
const artifactRoot = join(workingRoot, 'artifacts');
await mkdir(packageRoot, { recursive: true });
await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
  name: 'bomwiki-v6-codex-live-smoke',
  private: true,
  version: '0.0.0',
}, null, 2) + '\n');
const npmEnv = { ...process.env, npm_config_cache: join(workingRoot, 'npm-cache') };
const built = await buildCadMcpPackage(artifactRoot);
await execFile('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', built.tarball], {
  cwd: packageRoot,
  env: npmEnv,
  maxBuffer: 4 * 1024 * 1024,
});
const packageJson = JSON.parse(await readFile(join(packageRoot, 'node_modules', '@bomwiki', 'cad-mcp', 'package.json'), 'utf8'));
const packageBin = join(packageRoot, 'node_modules', '.bin', 'bomwiki-cad-mcp');
const codexVersionProbe = spawnSync(codexBin, ['--version'], { encoding: 'utf8' });
check('reviewed package installs into a clean Codex consumer',
  packageJson.name === '@bomwiki/cad-mcp' &&
  packageJson.version === built.version &&
  existsSync(packageBin) &&
  /^[a-f0-9]{64}$/.test(built.sha256),
  { packageJson, packageBin, built });
check('a normal Codex CLI host is available',
  codexVersionProbe.status === 0 && /codex-cli/.test(codexVersionProbe.stdout || ''),
  { status: codexVersionProbe.status, stdout: codexVersionProbe.stdout, stderr: codexVersionProbe.stderr });

const { server, url } = await startStudioServer();
const origin = new URL(url).origin;
let browser: Browser | null = null;
let page: Page | null = null;
let codexResult: Awaited<ReturnType<typeof collectCodex>> | null = null;
let approval: Awaited<ReturnType<typeof approveAsHuman>> | null = null;
let codexChild: ReturnType<typeof spawn> | null = null;
let visible: Record<string, unknown> = {};
let pageErrors: string[] = [];
let requestFailures: string[] = [];
try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const created = await createStudioPage(browser, url);
  page = created.page;
  pageErrors = created.pageErrors;
  requestFailures = created.requestFailures;
  const permissions = 'project.read,ui.read,ui.select,ui.navigate,ui.present-demo';
  const mcpArgs = [
    '--bridge-port', String(bridgePort),
    '--studio-origin', origin,
    '--studio-url', url,
    '--permissions', permissions,
  ];
  codexChild = spawn(codexBin, [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--json',
    '-C', packageRoot,
    '-c', `mcp_servers.bomwiki_cad.command=${JSON.stringify(packageBin)}`,
    '-c', `mcp_servers.bomwiki_cad.args=${JSON.stringify(mcpArgs)}`,
    codexPrompt(),
  ], {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  [codexResult, approval] = await Promise.all([
    collectCodex(codexChild),
    approveAsHuman(page),
  ]);
  visible = await page.evaluate(() => {
    const selected = document.querySelector<HTMLElement>('#bw-bodies [data-body-id].is-selected');
    return {
      workspace: document.querySelector('[data-workspace="view"]')?.getAttribute('aria-selected'),
      selectedBodyId: selected?.dataset.bodyId || null,
      selectedRevealed: selected?.classList.contains('is-agent-revealed') || false,
      inspectorVisible: !(document.getElementById('bw-context-wrap') as HTMLElement | null)?.hidden,
      message: document.getElementById('bw-studio-msg')?.textContent || '',
    };
  });
} finally {
  codexChild?.kill('SIGTERM');
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

const completedItems = codexResult?.events
  .filter((event) => event.type === 'item.completed')
  .map((event) => event.item) || [];
const mcpCalls = completedItems
  .filter((item) => item.type === 'mcp_tool_call')
  .map((item) => ({
    server: item.server,
    tool: item.tool,
    arguments: item.arguments,
    status: item.status,
    error: item.error || null,
  }));
const finalMessage = [...completedItems]
  .reverse()
  .find((item) => item.type === 'agent_message')?.text || '';
const forbiddenOperations = completedItems
  .filter((item) => !['agent_message', 'mcp_tool_call'].includes(item.type))
  .map((item) => item.type);
const usage = codexResult?.events.findLast((event) => event.type === 'turn.completed')?.usage || null;
const requiredCalls = ['cad_capabilities', 'read_mcp_resource', 'cad_session', 'cad_ui', 'cad_inspect'];
check('Codex loads the canonical skill and uses only the packaged CAD MCP surface',
  requiredCalls.every((tool) => mcpCalls.some((entry) => entry.server === 'bomwiki_cad' && entry.tool === tool)) &&
  mcpCalls.every((entry) => entry.server === 'bomwiki_cad' && entry.status === 'completed' && !entry.error) &&
  forbiddenOperations.length === 0,
  { mcpCalls, forbiddenOperations });
check('one accessible visible Studio approval connects Codex',
  approval?.labelled &&
  approval?.described &&
  approval?.focused &&
  approval?.approveControlId === 'app.agent.connection-approve',
  approval);
check('Codex visibly controls the normal workspace, tree, selection, inspector, and camera path',
  visible.workspace === 'true' &&
  typeof visible.selectedBodyId === 'string' &&
  visible.selectedRevealed === true &&
  visible.inspectorVisible === true,
  visible);
check('Codex reports a structured successful live-host result',
  codexResult?.code === 0 &&
  /^CODEX_CAD_LIVE PASS profile=bomwiki\.cad\.agentic-ui\/v1 skill=0\.6\.0 /.test(finalMessage),
  { code: codexResult?.code, signal: codexResult?.signal, finalMessage, stderr: codexResult?.stderr });
const teardownRequestFailures = requestFailures.filter((entry) =>
  /^POST http:\/\/127\.0\.0\.1:49784\/exchange net::ERR_CONNECTION_REFUSED$/.test(entry));
const applicationRequestFailures = requestFailures.filter((entry) => !teardownRequestFailures.includes(entry));
check('the observer records no application page/request failure and performs no agent CAD action',
  pageErrors.length === 0 && applicationRequestFailures.length === 0 && teardownRequestFailures.length <= 1,
  { pageErrors, applicationRequestFailures, teardownRequestFailures });

const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim() || null;
const evidence = {
  generatedAt: new Date().toISOString(),
  environment: 'local-packaged-studio',
  production: false,
  releaseClaim: false,
  sourceCommit,
  dirtyWorkingTree: Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim()),
  codexVersion: (codexVersionProbe.stdout || '').trim(),
  package: {
    name: built.name,
    version: built.version,
    bytes: built.bytes,
    sha256: built.sha256,
  },
  studioUrl: url,
  humanActions: ['approve permission-scoped connection'],
  approval,
  mcpCalls,
  forbiddenOperations,
  visible,
  finalMessage,
  usage,
  pageErrors,
  requestFailures,
  applicationRequestFailures,
  teardownRequestFailures,
  status: failed === 0 ? 'pass-local-repeat-required-on-production' : 'fail',
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });

console.log(`\n${passed}/${passed + failed} V6 real Codex live-host checks passed`);
console.log(JSON.stringify({
  status: evidence.status,
  evidencePath,
  evidenceSha256: createHash('sha256').update(await readFile(evidencePath)).digest('hex'),
  packageTarballSha256: built.sha256,
}, null, 2));
if (failed) process.exitCode = 1;
} finally {
  await rm(workingRoot, { recursive: true, force: true });
}
