import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';

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

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function startStudioServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice('/static/'.length));
      if (existsSync(file)) {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        response.end(readFileSync(file));
        return;
      }
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio` };
}

async function approveAsHuman(page: Page, clientLabel: string) {
  await page.evaluate(() => {
    (document.getElementById('bw-help-open') as HTMLButtonElement | null)?.click();
    (document.getElementById('bw-help-agent') as HTMLButtonElement | null)?.click();
  });
  await page.waitForFunction((label) => [...document.querySelectorAll('.ws-agent-pair[open] h2')]
    .some((heading) => (heading.textContent || '').includes(label)), { polling: 50, timeout: 10_000 }, clientLabel);
  await page.evaluate((label) => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('.ws-agent-pair[open]')]
      .find((candidate) => (candidate.querySelector('h2')?.textContent || '').includes(label));
    const button = dialog?.querySelector<HTMLButtonElement>('button[value="approve"]');
    if (!dialog || !button) throw new Error('Visible connection approval is missing.');
    dialog.close(button.value);
    dialog.dispatchEvent(new Event('close'));
  }, clientLabel);
}

console.log('\nCAD Studio V6 host-neutral MCP conformance');
const { server, url } = await startStudioServer();
const origin = new URL(url).origin;
const clientLabel = 'Portable MCP conformance host';
const outputRoot = await mkdtemp(join(tmpdir(), 'bomwiki-cad-v6-host-'));
const importPath = join(outputRoot, 'host-import.bomcad.json');
const importBytes = Buffer.from(JSON.stringify({
  title: 'Host imported project',
  units: 'mm',
  params: [],
  features: [{
    id: 'feature-host-import',
    name: 'Imported plate',
    type: 'extrude',
    sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 34, h: 22 }], z: 0 },
    h: 5,
    through: false,
  }],
}, null, 2) + '\n');
await writeFile(importPath, importBytes, { mode: 0o600 });
const child = spawn(process.execPath, [
  '--experimental-strip-types',
  'scripts/studio-agent-mcp.ts',
  '--bridge-port', '49784',
  '--studio-origin', origin,
  '--studio-url', url,
  '--allow-read', outputRoot,
  '--allow-write', outputRoot,
  '--permissions', 'project.read,project.edit,project.replace,project.save-new,artifact.render,ui.read,ui.select,ui.navigate,ui.present-demo,ui.present-narration,ui.wait-events,session.launch-visible',
], { cwd: join(here, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
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
function rpc(method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}. stderr=${stderr}`)), 45_000);
    pending.push((message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method,
      ...(params ? { params } : {}),
    }) + '\n');
  });
}
const toolTranscript: Array<{ name: string; arguments: Record<string, unknown> }> = [];
async function tool(name: string, args: Record<string, unknown>) {
  toolTranscript.push({ name, arguments: structuredClone(args) });
  const response = await rpc('tools/call', { name, arguments: args });
  if (response.result?.isError) throw Object.assign(new Error(response.result.structuredContent?.message), response.result.structuredContent);
  return response.result?.structuredContent;
}

let browser: Browser | null = null;
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
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
      title: 'Host-neutral conformance fixture',
      units: 'mm',
      params: [],
      features: [{
        id: 'feature-v6-host',
        name: 'Conformance shaft',
        type: 'extrude',
        sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 6 }], z: 0 },
        h: 24,
        through: false,
      }],
    }));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), { polling: 50, timeout: 30_000 });

  const initialized = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'host-neutral-mcp-conformance', version: '1.0.0' },
  });
  const coreSkill = await rpc('resources/read', { uri: 'bomwiki-cad://skills/core' });
  const capabilities = await tool('cad_capabilities', {});
  check('second host initializes standard MCP and loads the canonical skill before connecting',
    initialized.result?.serverInfo?.name === 'bomwiki-cad' &&
    /fixed local discovery/.test(coreSkill.result?.contents?.[0]?.text || '') &&
    capabilities.skillCompatibility?.skillVersion === '0.6.0');

  const connected = await tool('cad_session', {
    action: 'connect',
    clientLabel,
    permissions: {
      granted: ['project.read', 'project.replace', 'project.save-new', 'artifact.render', 'ui.read', 'ui.select', 'ui.navigate', 'ui.present-demo', 'ui.present-narration', 'ui.wait-events', 'session.launch-visible'],
    },
  });
  check('second host receives fixed discovery and agent-first launch without a pairing secret',
    connected.status?.state === 'waiting' &&
    /^http:\/\/127\.0\.0\.1:49784\/\.well-known\/bomwiki-cad$/.test(connected.discoveryUrl) &&
    /^http:\/\/127\.0\.0\.1:49784\/launch\//.test(connected.launchUrl) &&
    !('pairingUrl' in connected), connected);

  await approveAsHuman(page, clientLabel);
  let status: any;
  for (let attempt = 0; attempt < 300; attempt++) {
    status = await tool('cad_session', { action: 'status', sessionId: connected.sessionId });
    if (status.status?.state === 'connected') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('one visible approval connects the second host to the intended project',
    status.status?.state === 'connected' &&
    typeof status.status?.projectId === 'string' &&
    status.status?.permissionContext?.granted?.includes('ui.navigate'), status);

  let initial = await tool('cad_ui', { sessionId: connected.sessionId, action: 'snapshot' });
  if (initial.viewport.renderState !== 'idle') {
    const readiness = await tool('cad_ui', {
      sessionId: connected.sessionId,
      action: 'apply',
      expectedUiRevision: initial.uiRevision,
      correlationId: 'host-neutral-render-readiness',
      actions: [{ kind: 'presentation.waitForSettled', correlationId: 'host-neutral-render-readiness' }],
      presentation: { mode: 'instant', transition: 'cut' },
    });
    initial = readiness.snapshot;
  }
  const tree = await tool('cad_inspect', {
    sessionId: connected.sessionId,
    query: { kind: 'project.tree', pageSize: 100 },
  });
  const body = tree.result.items.find((entry: any) => entry.kind === 'body');
  const applied = await tool('cad_ui', {
    sessionId: connected.sessionId,
    action: 'apply',
    expectedUiRevision: initial.uiRevision,
    correlationId: 'host-neutral-visible-navigation',
    actions: [
      { kind: 'workspace.activate', workspaceId: 'view' },
      { kind: 'selection.set', entity: { kind: 'body', id: body.id } },
      { kind: 'tree.reveal', entity: { kind: 'body', id: body.id } },
      { kind: 'inspector.showEntity', entity: { kind: 'body', id: body.id } },
      { kind: 'viewport.fitAll' },
    ],
    presentation: { mode: 'normal' },
  });
  const visible = await page.evaluate((bodyId) => {
    const row = [...document.querySelectorAll<HTMLElement>('#bw-bodies [data-body-id]')]
      .find((candidate) => candidate.dataset.bodyId === bodyId);
    return {
      workspace: document.querySelector('[data-workspace="view"]')?.getAttribute('aria-selected'),
      selected: row?.classList.contains('is-selected'),
      revealed: row?.classList.contains('is-agent-revealed'),
      inspectorVisible: !(document.getElementById('bw-context-wrap') as HTMLElement | null)?.hidden,
    };
  }, body.id);
  check('second host visibly navigates Studio through MCP semantic UI calls only',
    applied.uiRevision === initial.uiRevision + 1 &&
    visible.workspace === 'true' &&
    visible.selected === true &&
    visible.revealed === true &&
    visible.inspectorVisible === true,
    { applied, visible });
  const pngPath = join(outputRoot, 'selected-body.png');
  const artifact = await tool('cad_artifact', {
    sessionId: connected.sessionId,
    format: 'png',
    path: pngPath,
    entities: [{ kind: 'body', id: body.id }],
    width: 320,
    height: 240,
  });
  const png = await readFile(pngPath);
  check('second host writes an exact-scope model-only PNG inside its approved output root',
    artifact.path === pngPath &&
    !('dataBase64' in artifact) &&
    artifact.bytes === png.byteLength &&
    artifact.sha256 === createHash('sha256').update(png).digest('hex') &&
    png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    artifact.manifest?.browserChromeIncluded === false &&
    artifact.manifest?.scope?.bodyIds?.join(',') === body.id,
    { artifact, pngBytes: png.byteLength });
  let outsideReadCode = '';
  try {
    await tool('cad_artifact', {
      sessionId: connected.sessionId,
      action: 'import',
      format: 'project',
      path: join(here, '..', 'package.json'),
    });
  } catch (error: any) {
    outsideReadCode = String(error?.code || '');
  }
  check('second host refuses project import outside its explicitly approved readable root',
    outsideReadCode === 'PATH_OUTSIDE_SCOPE',
    { outsideReadCode });
  const imported = await tool('cad_artifact', {
    sessionId: connected.sessionId,
    action: 'import',
    format: 'project',
    path: importPath,
  });
  const importedSummary = await tool('cad_inspect', {
    sessionId: connected.sessionId,
    query: { kind: 'project.summary' },
  });
  const importedStatus = await tool('cad_session', {
    action: 'status',
    sessionId: connected.sessionId,
  });
  const importedVisible = await page.evaluate(() => ({
    title: document.querySelector('.ws-document .ws-project-name')?.textContent,
    message: document.getElementById('bw-studio-msg')?.textContent,
  }));
  const canonicalImportPath = await realpath(importPath);
  check('second host imports an approved project file through bounded chunks and remains connected to the visible result',
    imported.action === 'import' &&
    imported.direction === 'import' &&
    imported.format === 'project' &&
    imported.path === canonicalImportPath &&
    imported.sourceBytes === importBytes.byteLength &&
    imported.sourceSha256 === createHash('sha256').update(importBytes).digest('hex') &&
    imported.projectId === importedSummary.result.projectId &&
    imported.documentHash === importedSummary.result.documentHash &&
    importedSummary.result.name === 'Host imported project' &&
    importedStatus.status?.state === 'connected' &&
    importedStatus.status?.projectId === imported.projectId &&
    importedStatus.permissions?.projectIds?.join(',') === imported.projectId &&
    importedVisible.title === 'Host imported project' &&
    importedVisible.message === 'Project opened.',
    { imported, importedSummary, importedStatus, importedVisible });
  check('observer remained read-only after approval and the transcript contains only BOMwiki CAD tools',
    pageErrors.length === 0 &&
    toolTranscript.every((entry) => entry.name.startsWith('cad_')) &&
    !JSON.stringify(toolTranscript).match(/selector|clientX|keyboard|pointer/),
    { pageErrors, toolTranscript });

  await tool('cad_session', { action: 'close', sessionId: connected.sessionId });
  await page.close();
} finally {
  child.stdin.end();
  await new Promise<void>((resolve) => {
    if (child.exitCode != null) resolve();
    else child.once('exit', () => resolve());
  });
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(outputRoot, { recursive: true, force: true });
}

check('second host exits cleanly with an auditable JSON-RPC transcript',
  child.exitCode === 0 && stderr === '' && buffer === '' && toolTranscript.length >= 7,
  { exitCode: child.exitCode, stderr, buffer, toolTranscriptLength: toolTranscript.length });

console.log(`\n${passed}/${passed + failed} V6 host-conformance checks passed`);
if (failed) process.exitCode = 1;
