import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { buildRobotJointFixture } from './studio-v5-release-fixtures.ts';
// @ts-expect-error Browser-native modules intentionally have no declarations.
import { createStudioV5ExplodedView } from '../static/studio-v5-inspection.js';
// @ts-expect-error Browser-native modules intentionally have no declarations.
import { canonicalStudioV5Project, studioV5CanonicalHash } from '../static/studio-v5-runtime-document.js';
// @ts-expect-error Browser-native modules intentionally have no declarations.
import { cadUiCapabilityManifest } from '../static/studio-v6-interaction.js';

type Mode = 'all' | 'document' | 'kernel';
const mode = (process.argv[2] || 'all') as Mode;
if (!['all', 'document', 'kernel'].includes(mode)) throw new Error(`Unknown V6 I2 check mode: ${mode}`);

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

function robotProject() {
  return createStudioV5ExplodedView(buildRobotJointFixture().project, {
    id: 'explode-robot-joint',
    name: 'Robot joint service view',
    steps: [
      { occurrenceIds: ['occurrence-robot-motor'], translation: [0, 0, -28] },
      { occurrenceIds: ['occurrence-robot-cover'], translation: [0, 0, 22] },
    ],
  });
}

function documentChecks() {
  console.log('\nCAD Studio V6 I2 document boundary');
  const project = robotProject();
  const canonical = canonicalStudioV5Project(project);
  const assembly = canonical.assemblyDefinitions.find((entry: any) => entry.id === canonical.rootDocument.assemblyId);
  const before = JSON.stringify(canonical);
  const hash = studioV5CanonicalHash(canonical);
  const manifest = cadUiCapabilityManifest();
  const i2Actions = [
    'document.activate', 'workspace.activate',
    'selection.set', 'selection.add', 'selection.remove', 'selection.clear',
    'tree.reveal', 'tree.expand', 'tree.collapse',
    'viewport.fitAll', 'viewport.fitSelection', 'viewport.standardView', 'viewport.setCamera',
    'viewport.setDisplayMode', 'viewport.activateSection', 'viewport.activateExplodedView', 'viewport.clearInspectionView',
    'panel.open', 'panel.close', 'inspector.showEntity', 'history.showRevision', 'diagnostics.show',
    'presentation.setMode', 'presentation.focusAction', 'presentation.waitForSettled', 'narration.setMode',
  ];
  check('canonical I2 project is an editable robot-joint assembly with saved section and exploded views',
    canonical.rootDocument.kind === 'assembly' &&
    assembly?.occurrences.some((entry: any) => entry.id === 'occurrence-robot-shaft') &&
    assembly?.sectionViews.some((entry: any) => entry.id === 'section-robot-joint') &&
    assembly?.explodedViews.some((entry: any) => entry.id === 'explode-robot-joint'));
  check('I2 manifest releases the complete navigation action set with closed input schemas',
    manifest.studioVersion === '6.0.0-i4' &&
    i2Actions.every((id) => manifest.actions.some((entry: any) =>
      entry.id === id && entry.state === 'available' && entry.inputSchema?.additionalProperties === false)));
  check('I2 manifest advertises exact subshape kinds, display modes, panels, and animated transitions',
    manifest.subshapeSelection.join(',') === 'face,edge,vertex' &&
    manifest.displayModes.map((entry: any) => entry.id).join(',') === 'shaded,shaded-edges,wireframe,hidden-line,ghost' &&
    ['model-tree', 'inspector', 'project', 'history', 'diagnostics']
      .every((id) => manifest.panels.some((entry: any) => entry.id === id && entry.state === 'available')) &&
    manifest.transitionCapabilities.some((entry: any) => entry.id === 'animate' && entry.state === 'available'));
  check('session-scoped I2 capability discovery cannot mutate the canonical document',
    JSON.stringify(canonical) === before && studioV5CanonicalHash(canonical) === hash);
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
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

async function workerRequest(page: Page, request: Record<string, unknown>): Promise<any> {
  return page.evaluate(async (payload) => {
    const state = window as any;
    state.__v6I2Worker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__v6I2Sequence = (state.__v6I2Sequence || 0) + 1;
    const requestId = `v6-i2-${state.__v6I2Sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('V6 I2 worker timed out.')), 90_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer);
        state.__v6I2Worker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else {
          resolve({
            revision: event.data.revision,
            errors: event.data.errors,
            bodies: (event.data.bodies || []).map((body: any) => ({
              bodyId: body.bodyId,
              occurrencePath: body.occurrenceInstance?.occurrencePath || [],
              geometry: body.geometry,
              renderTransform: body.renderTransform,
              topology: {
                faces: (body.mesh?.topologyFaces || []).map((face: any) => ({ faceId: face.faceId, sig: face.sig, geomType: face.geomType })),
                edges: (body.mesh?.edges || []).map((edge: any) => ({ sig: edge.sig, first: Array.from(edge.points.slice(0, 3)), last: Array.from(edge.points.slice(-3)) })),
                vertices: (body.mesh?.topologyVertices || []).map((vertex: any) => vertex.sig),
              },
            })),
          });
        }
      };
      state.__v6I2Worker.addEventListener('message', listener);
      state.__v6I2Worker.postMessage({ ...payload, requestId, projectId: 'project-v6-i2-kernel' });
    });
  }, request);
}

function topologyKey(body: any) {
  return JSON.stringify(body?.topology || null);
}

async function kernelChecks(browser: Browser, url: string) {
  console.log('\nCAD Studio V6 I2 exact-kernel topology');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const project = robotProject();
  const first = await workerRequest(page, { kind: 'rebuild', revision: 1, document: project });
  await page.evaluate(() => {
    const state = window as any;
    state.__v6I2Worker?.terminate();
    state.__v6I2Worker = null;
  });
  const second = await workerRequest(page, { kind: 'rebuild', revision: 2, document: project });
  const shaft = first.bodies.find((body: any) => body.occurrencePath.includes('occurrence-robot-shaft'));
  const shaftAgain = second.bodies.find((body: any) => body.bodyId === shaft?.bodyId);
  check('exact kernel evaluates the robot-joint assembly with no invalid bodies',
    first.errors.length === 0 &&
    first.bodies.length >= 6 &&
    first.bodies.every((body: any) => body.geometry?.valid && body.geometry.solidCount === 1),
    { errors: first.errors, bodies: first.bodies.length });
  check('shaft result exposes exact face, edge, and kernel-derived vertex topology',
    shaft?.topology.faces.length >= 2 &&
    shaft?.topology.faces.length === shaft?.geometry.faceCount &&
    shaft?.topology.edges.length >= 3 &&
    shaft?.topology.vertices.length >= 2 &&
    shaft.topology.faces.every((entry: any) => entry.sig.p.every(Number.isFinite) && entry.sig.n.every(Number.isFinite)) &&
    shaft.topology.edges.every((entry: any) => entry.sig.p.every(Number.isFinite)) &&
    shaft.topology.vertices.every((entry: any) => entry.p.every(Number.isFinite)),
    shaft?.topology);
  const edgeEndpoints = new Set(shaft?.topology.edges.flatMap((entry: any) => [entry.first, entry.last]).map((point: number[]) => point.map((value) => Math.round(value * 1e4) / 1e4).join(',')));
  check('kernel vertex signatures are exact edge endpoints rather than tessellation-order guesses',
    shaft?.topology.vertices.every((entry: any) => edgeEndpoints.has(entry.p.map((value: number) => Math.round(value * 1e4) / 1e4).join(','))));
  check('face, edge, and vertex topology signatures remain byte-stable across warm rebuild',
    shaftAgain && topologyKey(shaftAgain) === topologyKey(shaft));
  check('kernel preserves solved occurrence identity and finite transform for semantic fit-selection ownership',
    shaft?.bodyId &&
    shaft.occurrencePath.includes('occurrence-robot-shaft') &&
    shaft.renderTransform?.length === 16 &&
    shaft.renderTransform.every(Number.isFinite));
  await page.close();
}

let browser: Browser | null = null;
let server: Server | null = null;
try {
  if (mode === 'all' || mode === 'document') documentChecks();
  if (mode === 'all' || mode === 'kernel') {
    const started = await startServer();
    server = started.server;
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    await kernelChecks(browser, started.url);
  }
} finally {
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
}

console.log(`\n${passed}/${passed + failed} V6 I2 navigation checks passed`);
if (failed) process.exitCode = 1;
