// Slice 5B datum/transform gate. Assertions use canonical document objects,
// exact OpenCascade body geometry, and visible public controls.

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-expect-error Browser-native modules intentionally have no TypeScript declarations.
import { canonicalStudioV5Project, createStudioV5Datum, createStudioV5TransformFeature, deleteStudioV5Body, deleteStudioV5Datum, parseOrMigrateStudioV5RuntimeProject, reorderStudioV5Feature, setStudioV5RollbackMarker, studioV5CanonicalHash, studioV5RootPart, updateStudioV5Datum } from '../static/studio-v5-runtime-document.js';
// @ts-expect-error Browser-native module intentionally has no TypeScript declarations.
import { resolveStudioV5Datums } from '../static/studio-v5-modeling.js';
import { createDatumTransformProject, DATUM_IDS, TRANSFORM_IDS } from './studio-v5-datums-fixture.ts';
import { createThreeBodyRuntimeProject, RUNTIME_BODY_IDS } from './studio-v5-runtime-fixture.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
if (!['all', 'document', 'kernel', 'browser'].includes(mode)) throw new Error(`Unknown Slice 5B check mode: ${mode}`);

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  const suffix = !ok && detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${suffix}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5B document and datum math');
  const project = createDatumTransformProject();
  const part = studioV5RootPart(project);
  const resolution = resolveStudioV5Datums(project, part.id);
  check('document resolves plane, axis, point, and coordinate-system datums',
    ['plane', 'axis', 'point', 'coordinate-system'].every((kind) => [...resolution.frames.values()].some((frame: any) => frame.kind === kind)));
  check('document offset planes resolve exact axial stations',
    close(resolution.frames.get(DATUM_IDS.station165).origin[0], 165) && close(resolution.frames.get(DATUM_IDS.station173).origin[0], 173));
  check('document angled plane resolves an exact 20 degree normal rotation',
    close(resolution.frames.get(DATUM_IDS.angled).normal[0], Math.cos(20 * Math.PI / 180)) &&
    close(Math.abs(resolution.frames.get(DATUM_IDS.angled).normal[1]), Math.sin(20 * Math.PI / 180)));
  check('document angled plane rotates its origin about an offset construction axis',
    close(resolution.frames.get(DATUM_IDS.angledAboutOffsetAxis).origin[0], 10) &&
    close(resolution.frames.get(DATUM_IDS.angledAboutOffsetAxis).origin[1], 10));
  check('document supports three-point, curve-normal, and mid-plane construction',
    resolution.frames.has(DATUM_IDS.threePoint) && resolution.frames.has(DATUM_IDS.curveNormal) && close(resolution.frames.get(DATUM_IDS.mid).origin[0], 169));
  check('document transform history includes move, rotate, align, mirror-copy, and scale',
    ['move', 'rotate', 'align', 'mirror', 'scale'].every((kind) => part.features.some((feature: any) => feature.type === 'transform' && feature.transform.mode === kind)));
  const mirrored = part.bodies.find((body: any) => body.id === 'body-tool-mirror');
  check('document mirror creates one source-linked body with stable ownership',
    mirrored?.createdByFeatureId === TRANSFORM_IDS.mirrorTool &&
    part.features.find((feature: any) => feature.id === TRANSFORM_IDS.mirrorTool)?.sourceBodyId === RUNTIME_BODY_IDS.tool &&
    part.features.find((feature: any) => feature.id === TRANSFORM_IDS.mirrorTool)?.linked === true);

  const beforeReorder = JSON.stringify(project);
  const reordered = reorderStudioV5Feature(project, TRANSFORM_IDS.rotateHousing, TRANSFORM_IDS.moveHousing);
  check('document safe feature reorder is detached and preserves IDs',
    JSON.stringify(project) === beforeReorder &&
    studioV5RootPart(reordered).featureOrder.indexOf(TRANSFORM_IDS.rotateHousing) < studioV5RootPart(reordered).featureOrder.indexOf(TRANSFORM_IDS.moveHousing));
  let unsafeRejected = false;
  try { reorderStudioV5Feature(project, TRANSFORM_IDS.mirrorTool, 'feature-tool'); } catch { unsafeRejected = true; }
  check('document rejects reorder that violates creating-body history', unsafeRejected);

  const rolled = setStudioV5RollbackMarker(project, TRANSFORM_IDS.mirrorTool);
  check('document rollback marker is canonical and non-destructive',
    studioV5RootPart(rolled).metadata.rollbackFeatureId === TRANSFORM_IDS.mirrorTool &&
    studioV5RootPart(rolled).features.some((feature: any) => feature.id === TRANSFORM_IDS.scaleMirror));
  const rollbackDependencyDeleted = deleteStudioV5Body(rolled, RUNTIME_BODY_IDS.tool);
  check('document dependent-history deletion clears an orphaned rollback marker',
    studioV5RootPart(rollbackDependencyDeleted).metadata.rollbackFeatureId == null);

  const beforeDelete = JSON.stringify(project);
  let dependentDeleteRejected = false;
  try { deleteStudioV5Datum(project, DATUM_IDS.yz); } catch { dependentDeleteRejected = true; }
  check('document rejects deleting a datum used by other datums and features',
    dependentDeleteRejected && JSON.stringify(project) === beforeDelete);

  let downstreamBreakRejected = false;
  try {
    updateStudioV5Datum(project, DATUM_IDS.station165, {
      definition: { mode: 'principal', origin: [165, 0, 0], normal: [0, 1, 0], xDirection: [1, 0, 0] },
    });
  } catch { downstreamBreakRejected = true; }
  check('document rejects a valid datum edit that would break a downstream dependent frame', downstreamBreakRejected);

  const cycleStart = updateStudioV5Datum(project, DATUM_IDS.station165, {
    definition: { mode: 'offset', referenceDatumId: DATUM_IDS.station173, offset: -8 },
  });
  let cycleRejected = false;
  try {
    updateStudioV5Datum(cycleStart, DATUM_IDS.station173, {
      definition: { mode: 'offset', referenceDatumId: DATUM_IDS.station165, offset: 8 },
    });
  } catch { cycleRejected = true; }
  check('document rejects cyclic datum dependencies before canonical mutation', cycleRejected);

  const broken = updateStudioV5Datum(project, DATUM_IDS.station165, {
    definition: { mode: 'offset', referenceDatumId: 'datum-missing-plane', offset: 165 },
  }, { allowBroken: true });
  check('document deliberately broken datum remains identifiable for repair',
    resolveStudioV5Datums(broken, studioV5RootPart(broken).id).errors.has(DATUM_IDS.station165));
  const repaired = updateStudioV5Datum(broken, DATUM_IDS.station165, {
    definition: { mode: 'offset', referenceDatumId: DATUM_IDS.yz, offset: 173 },
  });
  check('document repair retains datum/body/feature identities',
    studioV5RootPart(repaired).referenceGeometry.some((datum: any) => datum.id === DATUM_IDS.station165) &&
    studioV5RootPart(repaired).bodies.map((body: any) => body.id).join(',') === part.bodies.map((body: any) => body.id).join(','));
  const serialized = JSON.stringify(canonicalStudioV5Project(repaired));
  check('document save/reopen preserves transformed history and datum IDs byte-identically',
    JSON.stringify(parseOrMigrateStudioV5RuntimeProject(serialized)) === serialized);

  const beforeInvalid = JSON.stringify(project);
  let invalidTransformRejected = false;
  try {
    createStudioV5TransformFeature(project, {
      id: 'transform-invalid-scale', bodyId: RUNTIME_BODY_IDS.housing, mode: 'align',
      transform: { mode: 'align', fromDatumId: DATUM_IDS.xAxis, toDatumId: DATUM_IDS.xy },
    });
  } catch { invalidTransformRejected = true; }
  check('document invalid align fails before canonical mutation', invalidTransformRejected && JSON.stringify(project) === beforeInvalid);
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice('/static/'.length));
      if (existsSync(file)) { res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file)); return; }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio` };
}

async function workerRequest(page: Page, request: Record<string, unknown>): Promise<any> {
  return page.evaluate(async (payload) => {
    const state = window as any;
    state.__slice5bWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__slice5bSeq = (state.__slice5bSeq || 0) + 1;
    const requestId = `slice-5b-${state.__slice5bSeq}`;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5B worker timed out.')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__slice5bWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message)); else resolve(event.data);
      };
      state.__slice5bWorker.addEventListener('message', listener);
      state.__slice5bWorker.postMessage({ ...payload, requestId, projectId: 'project-slice-5b-worker' });
    });
  }, request);
}

const body = (response: any, bodyId: string) => response.bodies.find((entry: any) => entry.bodyId === bodyId);

async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5B exact kernel transforms');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const baselineProject = createDatumTransformProject({ transforms: false });
  const baseline = await workerRequest(page, { kind: 'rebuild', revision: 1, document: baselineProject });
  const transformedProject = createDatumTransformProject();
  const transformed = await workerRequest(page, { kind: 'rebuild', revision: 2, document: transformedProject });
  check('kernel returns four independently valid exact bodies after linked mirror',
    transformed.bodies.length === 4 && transformed.bodies.every((entry: any) => entry.geometry?.solidCount === 1 && entry.geometry.valid));
  check('kernel move and rotate preserve exact Housing volume while changing placement',
    close(body(baseline, RUNTIME_BODY_IDS.housing).geometry.volume, body(transformed, RUNTIME_BODY_IDS.housing).geometry.volume) &&
    !close(body(baseline, RUNTIME_BODY_IDS.housing).geometry.bounds[0][0], body(transformed, RUNTIME_BODY_IDS.housing).geometry.bounds[0][0]));
  check('kernel plane-to-plane align moves Shaft by the exact 165 mm station delta',
    close(body(transformed, RUNTIME_BODY_IDS.shaft).geometry.bounds[0][0] - body(baseline, RUNTIME_BODY_IDS.shaft).geometry.bounds[0][0], 165));
  const frameAlignedProject = createStudioV5TransformFeature(baselineProject, {
    id: 'transform-align-coordinate-frame', name: 'Align Shaft coordinate frame', bodyId: RUNTIME_BODY_IDS.shaft,
    mode: 'align', transform: { mode: 'align', fromDatumId: DATUM_IDS.coordinates, toDatumId: DATUM_IDS.rotatedCoordinates },
    copy: true, linked: true, bodyName: 'Frame-aligned Shaft', createdBodyId: 'body-shaft-frame-aligned',
  });
  const frameAligned = await workerRequest(page, { kind: 'rebuild', revision: 3, document: frameAlignedProject });
  const frameBounds = body(frameAligned, 'body-shaft-frame-aligned').geometry.bounds;
  const sourceBounds = body(baseline, RUNTIME_BODY_IDS.shaft).geometry.bounds;
  check('kernel coordinate-system align preserves full frame orientation including X-axis twist',
    close(frameBounds[0][0], 100 + sourceBounds[0][2]) && close(frameBounds[1][0], 100 + sourceBounds[1][2]) &&
    close(frameBounds[0][1], sourceBounds[0][0]) && close(frameBounds[1][1], sourceBounds[1][0]) &&
    close(frameBounds[0][2], sourceBounds[0][1]) && close(frameBounds[1][2], sourceBounds[1][1]), frameBounds);
  check('kernel linked mirror and scale preserve source while applying exact cubic volume scale',
    close(body(transformed, 'body-tool-mirror').geometry.volume, body(transformed, RUNTIME_BODY_IDS.tool).geometry.volume * 1.2 ** 3));
  check('kernel mirror placement derives from the station plane rather than baked source coordinates',
    body(transformed, 'body-tool-mirror').geometry.bounds[0][0] > 380);

  const rollback = setStudioV5RollbackMarker(transformedProject, TRANSFORM_IDS.mirrorTool);
  const rolled = await workerRequest(page, { kind: 'rebuild', revision: 4, document: rollback });
  check('kernel rollback marker disables later scale without deleting its history',
    close(body(rolled, 'body-tool-mirror').geometry.volume, body(rolled, RUNTIME_BODY_IDS.tool).geometry.volume) &&
    studioV5RootPart(rollback).features.some((feature: any) => feature.id === TRANSFORM_IDS.scaleMirror));

  const validAgain = await workerRequest(page, { kind: 'rebuild', revision: 5, document: transformedProject });
  const brokenProject = updateStudioV5Datum(transformedProject, DATUM_IDS.station165, {
    definition: { mode: 'offset', referenceDatumId: 'datum-missing-plane', offset: 165 },
  }, { allowBroken: true });
  const broken = await workerRequest(page, { kind: 'rebuild', revision: 6, document: brokenProject });
  check('kernel broken datum preserves last-valid dependent bodies and unaffected exact bodies',
    body(broken, RUNTIME_BODY_IDS.shaft).lastValid === true && body(broken, 'body-tool-mirror').lastValid === true &&
    !body(broken, RUNTIME_BODY_IDS.housing).lastValid && close(body(broken, RUNTIME_BODY_IDS.housing).geometry.volume, body(validAgain, RUNTIME_BODY_IDS.housing).geometry.volume));
  check('kernel broken datum rebuilds only its dependent body chains',
    new Set(broken.evaluation.evaluatedBodyIds).has(RUNTIME_BODY_IDS.housing) === false &&
    broken.evaluation.reusedBodyIds.includes(RUNTIME_BODY_IDS.housing) && broken.evaluation.reusedBodyIds.includes(RUNTIME_BODY_IDS.tool));
  const repairedProject = updateStudioV5Datum(brokenProject, DATUM_IDS.station165, {
    definition: { mode: 'offset', referenceDatumId: DATUM_IDS.yz, offset: 173 },
  });
  const repaired = await workerRequest(page, { kind: 'rebuild', revision: 7, document: repairedProject });
  check('kernel datum repair moves every dependent to the edited station and keeps body IDs',
    close(body(repaired, RUNTIME_BODY_IDS.shaft).geometry.bounds[0][0] - body(baseline, RUNTIME_BODY_IDS.shaft).geometry.bounds[0][0], 173) &&
    repaired.bodies.map((entry: any) => entry.bodyId).join(',') === transformed.bodies.map((entry: any) => entry.bodyId).join(','));
  await workerRequest(page, { kind: 'release', revision: 8, document: repairedProject });
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 250 }, revisionAfter ?? null);
}

async function openProject(page: Page, project: any): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-slice5b-'));
  const filename = join(directory, 'slice5b.bomcad.json');
  writeFileSync(filename, JSON.stringify(project));
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const input = await page.$('#bw-open-file') as ElementHandle<HTMLInputElement> | null;
  await input!.uploadFile(filename);
  await waitForStudio(page, before);
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5B visible browser gate');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1'); localStorage.setItem('bw-studio-v2-seeded', '1'); localStorage.setItem('bw-studio-tour-v1', '1'); localStorage.removeItem('bw-studio-doc-v2');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForStudio(page);
  await openProject(page, createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-slice-5b-browser' }));
  await page.$eval(`#bw-bodies [data-body-id="${RUNTIME_BODY_IDS.housing}"] [data-body-action="select"]`, (element: any) => element.click());
  const baseline = await page.evaluate((id) => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === id).geometry.bounds, RUNTIME_BODY_IDS.housing);

  const shaftBaseline = await page.evaluate((id) => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === id).geometry.bounds, RUNTIME_BODY_IDS.shaft);
  await page.$eval(`#bw-bodies [data-body-id="${RUNTIME_BODY_IDS.shaft}"] [data-body-action="select"]`, (element: any) => element.click());
  await page.$eval('[data-v5-command="move"]', (element: any) => element.click());
  await page.waitForSelector('#bw-v5-command.with-gizmo[open]');
  const gizmoState = await page.evaluate(() => (window as any).__bwStudio.gizmoState());
  check('browser Move exposes attached 3D handles with explicit millimetre snapping',
    gizmoState.attached && gizmoState.helperVisible && gizmoState.mode === 'translate' && gizmoState.translationSnap === 1,
    gizmoState);
  await page.evaluate(() => (window as any).__bwStudio.gizmoTranslateForTest([5, 0, 0]));
  check('browser 3D handle preview stays synchronized with exact numeric fields',
    await page.$eval('#bw-v5-command [name="tx"]', (input: any) => Number(input.value) === 5));
  const beforeGizmoApply = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeGizmoApply);
  const movedShaft = await page.evaluate((id) => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === id).geometry.bounds, RUNTIME_BODY_IDS.shaft);
  check('browser 3D handle Apply commits one exact editable transform', close(movedShaft[0][0] - shaftBaseline[0][0], 5));
  await page.$eval(`#bw-bodies [data-body-id="${RUNTIME_BODY_IDS.housing}"] [data-body-action="select"]`, (element: any) => element.click());

  const moveFeatureId = await page.evaluate((shaftId) => {
    const part = JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0];
    return part.features.find((feature: any) => feature.type === 'transform' && feature.sourceBodyId === shaftId && feature.transform?.mode === 'move').id;
  }, RUNTIME_BODY_IDS.shaft);
  const moveRowIsDraggable = await page.$eval(`#bw-history [data-sel="${moveFeatureId}"]`, (row: any) => row.draggable === true);
  const beforeReorder = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval(`#bw-history [data-sel="${moveFeatureId}"] [data-move-feature="up"]`, (element: any) => element.click());
  await waitForStudio(page, beforeReorder);
  const reorderedHistory = await page.evaluate((featureId) => {
    const order = JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0].featureOrder;
    return { order, index: order.indexOf(featureId) };
  }, moveFeatureId);
  check('browser feature history exposes drag plus keyboard-accessible safe reorder',
    moveRowIsDraggable && reorderedHistory.index === reorderedHistory.order.length - 2,
    reorderedHistory);
  const lastHistoryFeatureId = reorderedHistory.order.at(-1)!;
  const beforeRollback = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval(`#bw-history [data-sel="${lastHistoryFeatureId}"] [data-rollback-feature]`, (element: any) => element.click());
  await waitForStudio(page, beforeRollback);
  check('browser rollback marker is visible and preserves canonical history',
    await page.$eval(`#bw-history [data-sel="${lastHistoryFeatureId}"]`, (row) => row.classList.contains('rollback') && row.querySelector('[data-rollback-feature]')?.getAttribute('aria-pressed') === 'true'));
  const beforeClearRollback = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval(`#bw-history [data-sel="${lastHistoryFeatureId}"] [data-rollback-feature]`, (element: any) => element.click());
  await waitForStudio(page, beforeClearRollback);

  await page.$eval('[data-v5-command="plane"]', (element: any) => element.click());
  await page.waitForSelector('#bw-v5-command[open]');
  const modes = await page.$$eval('#bw-v5-command [name="mode"] option', (entries) => entries.map((entry: any) => entry.value));
  check('browser Plane command visibly exposes all required construction modes',
    ['offset', 'angle', 'three-point', 'point-normal', 'midplane', 'curve-normal'].every((entry) => modes.includes(entry)));
  await page.$eval('#bw-v5-command [name="name"]', (input: any) => { input.value = 'Browser station'; });
  await page.$eval('#bw-v5-command [name="offset"]', (input: any) => { input.value = '30'; });
  const beforePlane = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforePlane);
  check('browser creates named datum through transactional Apply', await page.$eval('#bw-datum-tree', (tree) => /Browser station/.test(tree.textContent || '')));

  const browserStationId = await page.evaluate(() => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.partDefinitions[0].referenceGeometry.find((datum: any) => datum.name === 'Browser station').id;
  });
  await page.$eval('[data-v5-command="align"]', (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="fromDatumId"]', (input: any) => { input.value = 'datum-origin-yz'; });
  await page.$eval('#bw-v5-command [name="toDatumId"]', (input: any, id) => { input.value = id; }, browserStationId);
  const beforeAlign = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeAlign);
  const aligned = await page.evaluate((id) => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === id).geometry.bounds, RUNTIME_BODY_IDS.housing);
  check('browser Align moves the selected body by the exact datum offset', close(aligned[0][0] - baseline[0][0], 30));

  await page.$eval(`#bw-datum-tree [data-datum-id="${browserStationId}"] [data-datum-action="edit"]`, (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="offset"]', (input: any) => { input.value = '45'; });
  const beforeEdit = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeEdit);
  const edited = await page.evaluate((id) => ({ body: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === id), trace: (window as any).__bwStudio.evaluationTrace() }), RUNTIME_BODY_IDS.housing);
  check('browser editing the datum rebuilds its dependent body to the exact new station', close(edited.body.geometry.bounds[0][0] - baseline[0][0], 45));
  check('browser datum edit leaves unrelated body chains cached', edited.trace.reusedBodyIds.includes(RUNTIME_BODY_IDS.shaft) && edited.trace.reusedBodyIds.includes(RUNTIME_BODY_IDS.tool));

  await page.$eval(`#bw-bodies [data-body-id="${RUNTIME_BODY_IDS.housing}"] [data-body-action="select"]`, (element: any) => element.click());
  await page.$eval('[data-v5-command="mirror"]', (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="planeDatumId"]', (input: any, id) => { input.value = id; }, browserStationId);
  const beforeMirror = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeMirror);
  const mirrorState = {
    bodyIds: await page.evaluate(() => (window as any).__bwStudio.bodyIds()),
    rows: (await page.$$('#bw-bodies .body-row')).length,
    errors: await page.evaluate(() => (window as any).__bwStudio.errors()),
    dialogError: await page.$eval('#bw-v5-command-error', (element) => element.textContent || ''),
  };
  check('browser Mirror creates an independently selectable linked body',
    mirrorState.bodyIds.length === 4 && mirrorState.rows === 4, mirrorState);

  const beforeCancel = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth() }));
  await page.$eval('[data-v5-command="scale"]', (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="factor"]', (input: any) => { input.value = '2'; });
  await page.$eval('#bw-v5-command-cancel', (element: any) => element.click());
  const afterCancel = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth() }));
  check('browser transform Cancel is byte-identical and stack-identical', JSON.stringify(beforeCancel) === JSON.stringify(afterCancel));

  await page.$eval('[data-v5-command="rotate"]', (element: any) => element.click());
  const rotateGizmo = await page.evaluate(() => (window as any).__bwStudio.gizmoState());
  await page.evaluate(() => (window as any).__bwStudio.gizmoRotateForTest([0, 0, 1], 30));
  const rotateFields = await page.evaluate(() => ({
    axis: (document.querySelector('#bw-v5-command [name="axisDatumId"]') as HTMLSelectElement).value,
    angle: Number((document.querySelector('#bw-v5-command [name="angle"]') as HTMLInputElement).value),
  }));
  check('browser Rotate exposes snapped 3D rings synchronized to the selected canonical axis',
    rotateGizmo.attached && rotateGizmo.mode === 'rotate' && close(rotateGizmo.rotationSnapDegrees, 15) &&
    rotateFields.axis === 'datum-origin-z' && close(rotateFields.angle, 30),
    { rotateGizmo, rotateFields });
  await page.$eval('#bw-v5-command-cancel', (element: any) => element.click());
  const afterRotateCancel = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth() }));
  check('browser 3D rotation preview Cancel restores the exact document and stack', JSON.stringify(beforeCancel) === JSON.stringify(afterRotateCancel));

  await page.$eval(`#bw-datum-tree [data-datum-id="${browserStationId}"] [data-datum-action="edit"]`, (element: any) => element.click());
  await page.select('#bw-v5-command [name="mode"]', 'midplane');
  await page.select('#bw-v5-command [name="firstDatumId"]', 'datum-origin-yz');
  await page.select('#bw-v5-command [name="secondDatumId"]', 'datum-origin-xy');
  const beforeFailure = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await page.waitForFunction(() => /parallel/.test(document.getElementById('bw-v5-command-error')?.textContent || ''), { timeout: 60_000, polling: 250 });
  const afterFailure = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  check('browser invalid datum edit leaves document and undo/redo stacks unchanged', JSON.stringify(beforeFailure) === JSON.stringify(afterFailure));
  await page.$eval('#bw-v5-command-cancel', (element: any) => element.click());

  const hashBefore = await page.evaluate(() => (window as any).__bwStudio.canonicalHash());
  const beforeUndo = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await waitForStudio(page, beforeUndo);
  const beforeRedo = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control'); await waitForStudio(page, beforeRedo);
  check('browser undo/redo reproduces the exact datum/transform document', (await page.evaluate(() => (window as any).__bwStudio.canonicalHash())) === hashBefore);
  const persistedIds = await page.evaluate(() => ({ bodyIds: (window as any).__bwStudio.bodyIds(), datumIds: (window as any).__bwStudio.datumIds() }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expectedBodyIds) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' &&
      JSON.stringify(studio.bodyIds()) === JSON.stringify(expectedBodyIds) &&
      studio.bodyResults().length === expectedBodyIds.length && studio.bodyResults().every((entry: any) => entry.geometry?.valid));
  }, { timeout: 60_000, polling: 250 }, persistedIds.bodyIds);
  const reloaded = await page.evaluate(() => ({
    hash: (window as any).__bwStudio.canonicalHash(),
    bodyIds: (window as any).__bwStudio.bodyIds(),
    datumIds: (window as any).__bwStudio.datumIds(),
  }));
  check('browser recovery reload preserves the exact datum/transform document and stable IDs',
    reloaded.hash === hashBefore && JSON.stringify(reloaded.bodyIds) === JSON.stringify(persistedIds.bodyIds) && JSON.stringify(reloaded.datumIds) === JSON.stringify(persistedIds.datumIds));

  const browserBrokenProject = updateStudioV5Datum(createDatumTransformProject(), DATUM_IDS.station165, {
    definition: { mode: 'offset', referenceDatumId: 'datum-missing-browser-plane', offset: 165 },
  }, { allowBroken: true });
  await openProject(page, browserBrokenProject);
  const repairControl = await page.$eval(`#bw-datum-tree [data-datum-id="${DATUM_IDS.station165}"]`, (row) => ({
    broken: row.getAttribute('data-broken'),
    label: row.querySelector('[data-datum-action="edit"]')?.textContent,
  }));
  check('browser broken-reference tree exposes an explicit Repair control', repairControl.broken === 'true' && repairControl.label === 'Repair', repairControl);
  await page.$eval(`#bw-datum-tree [data-datum-id="${DATUM_IDS.station165}"] [data-datum-action="edit"]`, (element: any) => element.click());
  await page.select('#bw-v5-command [name="referenceDatumId"]', DATUM_IDS.yz);
  const beforeRepair = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeRepair);
  check('browser reference repair keeps the datum identity and clears the broken state transactionally',
    await page.$eval(`#bw-datum-tree [data-datum-id="${DATUM_IDS.station165}"]`, (row) => row.getAttribute('data-broken') === 'false'));
  check('browser 5B gate has no page errors or native dialogs', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs });
  await context.close();
}

let server: Server | null = null;
let browser: Browser | null = null;
try {
  if (mode === 'all' || mode === 'document') await documentChecks();
  if (mode !== 'document') {
    const started = await startServer(); server = started.server;
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    if (mode === 'all' || mode === 'kernel') await kernelChecks(browser, started.url);
    if (mode === 'all' || mode === 'browser') await browserChecks(browser, started.url);
  }
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
}

if (failures) {
  console.error(`\n${failures}/${checks} Slice 5B checks failed`);
  process.exit(1);
}
console.log(`\n${checks}/${checks} Slice 5B datum/transform checks passed`);
