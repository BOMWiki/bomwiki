import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { CadCommandService } from '../static/studio-agent-service.js';
import { startStudioLoopbackBridge } from './studio-agent-loopback.ts';

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

async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice('/static/'.length));
      if (existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/cad/studio` };
}

function tx(revision: number) {
  const feature = (id: string, name: string, shape: any) => ({
    kind: 'feature.extrude',
    input: {
      id, name: `${name} extrude`, bodyName: name, height: 20,
      sketch: { shapes: [shape], z: 0 },
      resultPolicy: { kind: 'new-body', bodyName: name },
    },
  });
  return {
    transactionId: 'tx-live-multibody', label: 'Agent builds three-body fixture', expectedRevision: revision, atomic: true,
    operations: [
      feature('feature-live-housing', 'Housing', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
      feature('feature-live-shaft', 'Shaft', { kind: 'rect', x: 60, y: 0, w: 10, h: 10 }),
      feature('feature-live-tool', 'Tool', { kind: 'circle', x: 0, y: 0, r: 5 }),
      { kind: 'boolean.subtract', input: { id: 'feature-live-boolean', targetBodyId: 'body-feature-live-housing', toolBodyId: 'body-feature-live-tool', keepTools: true } },
    ],
    metadata: { actor: 'agent', clientLabel: 'Browser parity check' },
  };
}

let requestSequence = 0;
async function request(page: Page, token: string, payload: any, expectedRevision?: number) {
  return page.evaluate(async ({ token, payload, expectedRevision, requestId }) => {
    return (window as any).__bwStudio.agentRequestForTest(token, {
      protocol: 'bomwiki.cad.agent/v1',
      requestId,
      sessionId: 'browser-check',
      ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}),
      permissionContext: { granted: [] },
      payload,
    });
  }, { token, payload, expectedRevision, requestId: `browser-request-${++requestSequence}` });
}

async function waitForIdle(page: Page, revisionAfter = -1) {
  await page.waitForFunction((revision) => {
    const studio = (window as any).__bwStudio;
    return studio?.mode().kind === 'idle' && (revision < 0 || studio.appliedRevision() > revision);
  }, { timeout: 90_000 }, revisionAfter);
}

async function browserChecks(browser: Browser, url: string) {
  console.log('\nAgent visible Studio parity');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.removeItem('bw-studio-doc-v2');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForIdle(page);

  const connection = await page.evaluate(() => (window as any).__bwStudio.connectAgentForTest({
    clientLabel: 'Parity agent',
    permissionContext: { granted: ['project.read', 'project.edit', 'artifact.export-project', 'artifact.export-step'] },
  }));
  check('browser structured session connects without pointer/keyboard automation', connection.protocol === 'bomwiki.cad.agent/v1' && connection.permissionContext.granted.includes('project.edit'));
  check('browser connection upgrades the current project through normal history', connection.revision === 1);
  const token = connection.connectionToken;
  const baseline = await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()));

  const capabilities = await request(page, token, { kind: 'capabilities' });
  check('browser live manifest matches the shared command service', capabilities.status === 'ok' && capabilities.result.operations.some((entry: any) => entry.kind === 'boolean.subtract' && entry.state === 'available'));

  const preview = await request(page, token, { kind: 'preview', transaction: tx(1) });
  check('browser exact preview returns three valid B-rep body results',
    preview.status === 'ok' && preview.result.evidence.exactGeometry === true && preview.result.evidence.bodyResults.length === 3 &&
    preview.result.evidence.bodyResults.every((entry: any) => entry.valid && entry.solids === 1 && entry.geometryHash.startsWith('fnv1a32:')), preview);
  const preCommitState = await page.evaluate(() => ({ bodies: (window as any).__bwStudio.bodyIds(), undo: (window as any).__bwStudio.undoDepth(), revision: (window as any).__bwStudio.commandRevision() }));
  check('browser exact preview leaves document and undo stack unchanged', preCommitState.bodies.length === 0 && preCommitState.undo === 1 && preCommitState.revision === 1);

  const appliedBefore = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const committed = await request(page, token, { kind: 'commit', previewId: preview.result.previewId }, 1);
  await waitForIdle(page, appliedBefore);
  check('browser agent commit advances one command revision', committed.status === 'ok' && committed.result.revision === 2);
  const visible = await page.evaluate(() => ({
    bodyIds: (window as any).__bwStudio.bodyIds(),
    bodyResults: (window as any).__bwStudio.bodyResults(),
    undo: (window as any).__bwStudio.undoLabels(),
    activity: document.getElementById('bw-agent-activity')?.textContent,
    historyFeatures: document.querySelectorAll('#bw-history .hist-item').length,
    bodyRows: document.querySelectorAll('#bw-bodies [data-body-id]').length,
    hash: (window as any).__bwStudio.canonicalHash(),
  }));
  check('browser agent result appears as normal editable model tree/history', visible.bodyRows === 3 && visible.historyFeatures === 4 && visible.undo.at(-1) === 'Agent builds three-body fixture');
  check('browser renderer owns three exact independently identified results', visible.bodyResults.length === 3 && visible.bodyResults.every((entry: any) => entry.geometry?.solidCount === 1));
  check('browser agent activity is visible to the human', /Parity agent/.test(visible.activity || '') && /Committed/.test(visible.activity || ''), visible.activity);

  const direct = new CadCommandService({ project: baseline, revision: 1 });
  const directPreview = await direct.preview(tx(1), { granted: ['project.read', 'project.edit'], projectIds: [baseline.projectId] });
  await direct.commit(directPreview.previewId, 1, { granted: ['project.read', 'project.edit'], projectIds: [baseline.projectId] });
  check('browser and direct adapters produce the same canonical document hash', direct.inspect().documentHash === visible.hash);

  const pendingRename = await request(page, token, {
    kind: 'preview',
    transaction: {
      transactionId: 'tx-agent-pending-rename', label: 'Agent renames Shaft', expectedRevision: 2, atomic: true,
      operations: [{ kind: 'body.rename', input: { bodyId: 'body-feature-live-shaft', name: 'Agent shaft' } }],
      metadata: { actor: 'agent' },
    },
  });
  await page.$eval('#bw-bodies [data-body-id="body-feature-live-housing"] [data-body-action="visibility"]', (button) => (button as HTMLButtonElement).click());
  await page.waitForFunction(() => (window as any).__bwStudio.commandRevision() === 3);
  const conflicted = await request(page, token, { kind: 'commit', previewId: pendingRename.result.previewId }, 2);
  check('browser human edit rejects stale agent commit instead of overwriting', conflicted.status === 'conflict' && conflicted.diagnostics[0].code === 'REVISION_CONFLICT');

  const changes = await request(page, token, { kind: 'inspect', query: { kind: 'history.changesSince', revision: 2 } });
  check('browser agent can inspect the intervening human command', changes.status === 'ok' && changes.result.items.some((entry: any) => entry.actor === 'human'));

  const refreshed = await request(page, token, {
    kind: 'preview',
    transaction: {
      transactionId: 'tx-agent-refreshed-rename', label: 'Agent renames Shaft', expectedRevision: 3, atomic: true,
      operations: [{ kind: 'body.rename', input: { bodyId: 'body-feature-live-shaft', name: 'Agent shaft' } }],
      metadata: { actor: 'agent' },
    },
  });
  const renamed = await request(page, token, { kind: 'commit', previewId: refreshed.result.previewId }, 3);
  await page.waitForFunction(() => (window as any).__bwStudio.commandRevision() === 4);
  check('browser refreshed agent commit follows the human change', renamed.status === 'ok' && renamed.result.revision === 4);
  const finalTree = await request(page, token, { kind: 'inspect', query: { kind: 'entity.detail', entity: { kind: 'body', id: 'body-feature-live-shaft' } } });
  check('browser final agent result remains human-editable semantic structure', finalTree.result.entity.name === 'Agent shaft');

  const disconnected = await page.evaluate((connectionToken) => (window as any).__bwStudio.disconnectAgentForTest(connectionToken), token);
  check('browser user can revoke the live session immediately', disconnected === true && (await page.evaluate(() => (window as any).bomwikiCadAgent.status().connected)) === false);
  check('browser live protocol produced no page errors', pageErrors.length === 0, pageErrors);

  const loopbackBaseline = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), projectId: (window as any).__bwStudio.projectId() }));
  const loopback = await startStudioLoopbackBridge({
    clientLabel: 'Loopback parity agent',
    permissionContext: { granted: ['project.read', 'project.edit', 'artifact.export-project'] },
  });
  await page.click('#bw-help-open');
  await page.click('#bw-help-agent');
  await page.type('.ws-agent-pair[open] .ws-agent-url input', loopback.pairingUrl);
  const popupPromise = new Promise<Page>((resolve, reject) => page.once('popup', (popup) => popup ? resolve(popup) : reject(new Error('Pairing popup did not open.'))));
  await page.click('.ws-agent-pair[open] button[type="submit"]');
  const pairingPage = await popupPromise;
  await page.waitForFunction(() => [...document.querySelectorAll('.ws-agent-pair[open] h2')].some((heading) => /Loopback parity agent/.test(heading.textContent || '')));
  check('visible Studio shows the loopback client before sharing project data',
    await page.$eval('.ws-agent-pair[open]', (dialog) => /project.read, project.edit/.test(dialog.textContent || '') && /Preview approval required/.test(dialog.textContent || '')));
  await page.click('.ws-agent-pair[open] button[value="approve"]');
  for (let attempt = 0; attempt < 100 && loopback.status().state !== 'connected'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
  check('approved localhost bridge becomes a structured live Studio session', loopback.status().state === 'connected' && loopback.status().projectId === loopbackBaseline.projectId, loopback.status());

  const loopbackSummary: any = await loopback.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('loopback agent inspects the visible project without DOM access', loopbackSummary.result.documentHash === loopbackBaseline.hash && loopbackSummary.revision === 4);
  const loopbackPreview: any = await loopback.request('cad_preview', {
    transaction: {
      transactionId: 'tx-loopback-rename', label: 'Loopback renames project', expectedRevision: 4, atomic: true,
      operations: [{ kind: 'project.rename', input: { name: 'Loopback project' } }],
      metadata: { actor: 'agent', clientLabel: 'Loopback parity agent' },
    },
  });
  check('loopback preview is detached and exact-revision bound', loopbackPreview.baseRevision === 4 && loopbackPreview.changeSet.documentHashBefore === loopbackBaseline.hash);
  const loopbackCommitPromise = loopback.request('cad_commit', { previewId: loopbackPreview.previewId, expectedRevision: 4 });
  await page.waitForSelector('.ws-agent-pair[open] button[value="approve"]');
  check('preview-required loopback commit pauses for visible user approval',
    await page.$eval('.ws-agent-pair[open]', (dialog) => /AGENT PREVIEW/.test(dialog.textContent || '') && /Loopback renames project/.test(dialog.textContent || '')));
  await page.click('.ws-agent-pair[open] button[value="approve"]');
  const loopbackCommit: any = await loopbackCommitPromise;
  await page.waitForFunction(() => (window as any).__bwStudio.commandRevision() === 5);
  check('approved loopback change uses normal revision and project chrome',
    loopbackCommit.revision === 5 && await page.$eval('#bw-project-name', (element) => element.textContent === 'Loopback project'));

  await page.click('#bw-agent-activity');
  await page.click('.ws-agent-pair[open] button[value="pause"]');
  await page.waitForFunction(() => (window as any).bomwikiCadAgent.status().paused === true);
  let pausedCode = '';
  try {
    await loopback.request('cad_inspect', { query: { kind: 'project.summary' } });
  } catch (error: any) {
    pausedCode = error.code;
  }
  check('user pause blocks the external client with a typed error', pausedCode === 'SESSION_PAUSED');
  await page.click('#bw-agent-activity');
  await page.click('.ws-agent-pair[open] button[value="pause"]');
  const resumed: any = await loopback.request('cad_inspect', { query: { kind: 'project.summary' } });
  check('user resume restores the same revision-controlled session', resumed.revision === 5);
  await loopback.close('MCP client closed the session');
  for (let attempt = 0; attempt < 100 && loopback.status().state !== 'closed'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
  await page.waitForFunction(() => !(window as any).bomwikiCadAgent.status().connected);
  check('MCP-side close invalidates the visible Studio session', loopback.status().state === 'closed' && !(await page.evaluate(() => (window as any).bomwikiCadAgent.status().connected)));
  await pairingPage.close();

  const humanContext = await browser.createBrowserContext();
  const humanPage = await humanContext.newPage();
  await humanPage.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
      params: [{ name: 'size', value: 40 }, { name: 'hole', value: 8 }],
      features: [
        { id: 'human-extrude', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 'size', h: 'size' }], z: 0 }, h: 5 },
        { id: 'human-cut', type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 'hole/2' }], z: 5 }, h: 10, through: true },
      ],
    }));
  });
  await humanPage.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForIdle(humanPage);
  const beforeHumanEdit = await humanPage.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await humanPage.click('#bw-param-add');
  await waitForIdle(humanPage, beforeHumanEdit);
  const humanState = await humanPage.evaluate(() => ({
    errors: (window as any).__bwStudio.errors(),
    triangles: (window as any).__bwStudio.triCount(),
    schemaVersion: JSON.parse((window as any).__bwStudio.docJson()).schemaVersion,
  }));
  check('browser human parameter action uses the service without losing geometry', humanState.schemaVersion === 5 && humanState.triangles > 0 && humanState.errors.length === 0, humanState);
  await humanPage.click('[data-workspace="home"]');
  await humanPage.click('[data-command-feat="extrude"]');
  const humanMode = await humanPage.evaluate(() => ({ mode: (window as any).__bwStudio.mode().kind, faceOpen: !(document.getElementById('bw-face') as HTMLElement).hidden }));
  check('browser Home command still opens face selection after typed migration', humanMode.mode === 'choose-face' && humanMode.faceOpen, humanMode);
  if (humanMode.faceOpen) await humanPage.click('#bw-face-cancel');
  await humanContext.close();

  const patternContext = await browser.createBrowserContext();
  const patternPage = await patternContext.newPage();
  await patternPage.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1');
    localStorage.setItem('bw-studio-v2-seeded', '1');
    localStorage.setItem('bw-studio-tour-v1', '1');
    localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
      features: [{
        id: 'pattern-feature', type: 'extrude',
        sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 4 }], z: 0 },
        h: 6, through: false, pattern: { kind: 'linear', n: 3, dx: 15, dy: 0 },
      }],
      params: [{ name: 'wall', value: 3 }],
    }));
  });
  await patternPage.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForIdle(patternPage);
  await patternPage.waitForFunction(() => (window as any).__bwStudio.triCount() > 0 && (window as any).__bwStudio.mode().kind === 'idle', { timeout: 90_000 });
  await patternPage.evaluate(() => (document.querySelector('.hist-item .hi-sel') as HTMLButtonElement).click());
  await patternPage.waitForSelector('#bw-context [data-cxpat="n"]');
  await patternPage.evaluate(() => {
    const count = document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement;
    const spacing = document.querySelector('#bw-context [data-cxpat="a"]') as HTMLInputElement;
    count.value = '4';
    count.dispatchEvent(new Event('change'));
    spacing.value = '22';
    spacing.dispatchEvent(new Event('change'));
  });
  await patternPage.waitForFunction(() => {
    const studio = (window as any).__bwStudio;
    return studio.mode().kind === 'idle' && studio.appliedRevision() === studio.documentRevision();
  }, { timeout: 90_000 });
  const patternBeforeCrash = await patternPage.evaluate(() => ({
    generation: (window as any).__bwStudio.kernelGeneration(),
    revision: (window as any).__bwStudio.appliedRevision(),
  }));
  await patternPage.evaluate(() => (window as any).__bwStudio.failKernelForTest());
  await patternPage.waitForFunction(({ generation, revision }) => {
    const studio = (window as any).__bwStudio;
    return studio.kernelGeneration() > generation && studio.appliedRevision() > revision && studio.appliedRevision() === studio.documentRevision();
  }, { timeout: 90_000 }, patternBeforeCrash);
  const patternAfterCrash = await patternPage.evaluate(() => ({
    errors: (window as any).__bwStudio.errors(),
    triangles: (window as any).__bwStudio.triCount(),
    document: JSON.parse((window as any).__bwStudio.docJson()),
  }));
  check('browser typed pattern edits survive exact-worker restart',
    patternAfterCrash.triangles > 0 && patternAfterCrash.errors.length === 0 &&
    patternAfterCrash.document.features[0].pattern.n === 4 && patternAfterCrash.document.features[0].pattern.dx === 22,
    patternAfterCrash);
  await patternContext.close();
  await context.close();
}

const { server, url } = await startServer();
let browser: Browser | null = null;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  await browserChecks(browser, url);
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log(`\n${passed}/${passed + failed} browser agent checks passed`);
if (failed) process.exitCode = 1;
