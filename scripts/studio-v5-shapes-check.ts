// Slice 5C document and exact-kernel gate for generic profile, Loft, and Sweep features.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-expect-error Browser-native modules intentionally have no TypeScript declarations.
import { canonicalStudioV5Project, createStudioV5ProfileSketch, createStudioV5TransformFeature, parseOrMigrateStudioV5RuntimeProject, studioV5RootPart, updateStudioV5AdvancedFeature, updateStudioV5AdvancedSketch, updateStudioV5Datum } from '../static/studio-v5-runtime-document.js';
import { ADVANCED_SHAPE_EDIT, createAdvancedShapeProject, SHAPE_IDS } from './studio-v5-shapes-fixture.ts';

type Mode = 'all' | 'document' | 'kernel' | 'browser';
const mode = (process.argv[2] || 'all') as Mode;
let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5C profile and feature documents');
  const project = createAdvancedShapeProject();
  const part = studioV5RootPart(project);
  check('document stores root, mid, and tip as ordinary plane-supported spline profiles',
    [SHAPE_IDS.rootProfile, SHAPE_IDS.midProfile, SHAPE_IDS.tipProfile].every((id) => {
      const sketch = part.sketches.find((entry: any) => entry.id === id);
      return sketch?.extensions?.studioRole === 'profile' && sketch.entities[0].kind === 'spline' && sketch.support.ownerKind === 'datum';
    }));
  const blade = part.features.find((feature: any) => feature.id === SHAPE_IDS.bladeLoft);
  check('document Loft retains explicit ordered section mapping and sketch references',
    blade.sections.map((entry: any) => entry.sketchId).join(',') === [SHAPE_IDS.rootProfile, SHAPE_IDS.midProfile, SHAPE_IDS.tipProfile].join(',') &&
    blade.inputRefs.filter((entry: any) => entry.semanticPath?.role === 'section').length === 3);
  const inlet = part.features.find((feature: any) => feature.id === SHAPE_IDS.inletLoft);
  check('document guided Loft retains guide and centreline source references',
    inlet.guideSketchIds[0] === SHAPE_IDS.inletGuide && inlet.centerlineSketchId === SHAPE_IDS.inletCenterline);
  const sweep = part.features.find((feature: any) => feature.id === SHAPE_IDS.sweepFeature);
  check('document Sweep retains path, controlled twist, scale law, and orientation',
    sweep.pathSketchId === SHAPE_IDS.sweepPath && sweep.orientation === 'controlled-twist' && sweep.twistAngle === 35 && sweep.scaleEnd === 0.65);
  check('document advanced features create three stable independent bodies',
    part.bodies.map((body: any) => body.id).join(',') === [SHAPE_IDS.bladeBody, SHAPE_IDS.inletBody, SHAPE_IDS.sweepBody].join(','));
  const bladeProfiles = [SHAPE_IDS.rootProfile, SHAPE_IDS.midProfile, SHAPE_IDS.tipProfile]
    .map((id) => part.sketches.find((entry: any) => entry.id === id).entities[0].points);
  const chord = (points: number[][]) => Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]));
  const thickness = (points: number[][]) => Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]));
  check('document twisted blade proves three spline stations, 30% chord reduction, valid thickness, and 20 degree twist',
    bladeProfiles.length === 3 && close(chord(bladeProfiles[2]) / chord(bladeProfiles[0]), 0.7) &&
    bladeProfiles.every((points) => thickness(points) / chord(points) >= 0.06 && thickness(points) / chord(points) <= 0.18) &&
    close(Math.acos(part.referenceGeometry.find((entry: any) => entry.id === SHAPE_IDS.rootPlane).definition.xDirection[1] *
      part.referenceGeometry.find((entry: any) => entry.id === SHAPE_IDS.tipPlane).definition.xDirection[1]) * 180 / Math.PI, 20));

  const beforeInvalid = JSON.stringify(project);
  let zeroAreaRejected = false;
  try {
    createStudioV5ProfileSketch(project, { id: 'sketch-invalid-profile', name: 'Invalid profile', planeDatumId: SHAPE_IDS.rootPlane, points: [[0, 0], [1, 0], [2, 0]] });
  } catch { zeroAreaRejected = true; }
  check('document rejects zero-area profile before canonical mutation', zeroAreaRejected && JSON.stringify(project) === beforeInvalid);
  const edited = updateStudioV5AdvancedSketch(project, SHAPE_IDS.tipProfile, { points: ADVANCED_SHAPE_EDIT.tipPoints });
  check('document profile edit preserves sketch, feature, and body identities',
    studioV5RootPart(edited).sketches.some((entry: any) => entry.id === SHAPE_IDS.tipProfile) &&
    studioV5RootPart(edited).features.some((entry: any) => entry.id === SHAPE_IDS.bladeLoft) &&
    studioV5RootPart(edited).bodies.some((entry: any) => entry.id === SHAPE_IDS.bladeBody));
  const downstreamId = 'feature-blade-downstream-scale';
  const withDownstream = createStudioV5TransformFeature(project, {
    id: downstreamId, name: 'Downstream blade scale', bodyId: SHAPE_IDS.bladeBody,
    mode: 'scale', transform: { mode: 'scale', factor: 1.01, center: [0, 0, 0] }, moveOriginal: true,
  });
  const updatedLoft = updateStudioV5AdvancedFeature(withDownstream, SHAPE_IDS.bladeLoft, { name: 'Edited twisted blade' });
  const updatedPart = studioV5RootPart(updatedLoft);
  check('document Loft edit preserves its history position and downstream feature ownership',
    updatedPart.featureOrder.indexOf(SHAPE_IDS.bladeLoft) < updatedPart.featureOrder.indexOf(downstreamId) &&
    updatedPart.bodies.find((entry: any) => entry.id === SHAPE_IDS.bladeBody)?.featureIds.join(',') === [SHAPE_IDS.bladeLoft, downstreamId].join(','));
  let unsupportedRejected = 0;
  try { updateStudioV5AdvancedFeature(project, SHAPE_IDS.bladeLoft, { closed: true }); } catch { unsupportedRejected++; }
  try { updateStudioV5AdvancedFeature(project, SHAPE_IDS.sweepFeature, { orientation: 'fixed', referenceDirection: [0, 0, 0] }); } catch { unsupportedRejected++; }
  check('document refuses unsupported periodic Loft and degenerate Sweep direction before mutation', unsupportedRejected === 2 && JSON.stringify(project) === beforeInvalid);
  const serialized = JSON.stringify(canonicalStudioV5Project(edited));
  check('document save/reopen preserves advanced-shape history byte-identically',
    JSON.stringify(parseOrMigrateStudioV5RuntimeProject(serialized)) === serialized);
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const MIME: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
async function startServer(): Promise<{ server: Server; url: string }> {
  const html = cadStudioPage();
  const server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    if (path.startsWith('/static/')) {
      const file = join(staticDir, path.slice(8));
      if (existsSync(file)) { res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file)); return; }
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/cad/studio` };
}

async function workerRequest(page: Page, payload: any): Promise<any> {
  return page.evaluate(async (request) => {
    const state = window as any;
    state.__shapeWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__shapeSequence = (state.__shapeSequence || 0) + 1;
    const requestId = `shape-${state.__shapeSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5C worker timeout')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__shapeWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message)); else resolve(event.data);
      };
      state.__shapeWorker.addEventListener('message', listener);
      state.__shapeWorker.postMessage({ ...request, requestId, projectId: 'project-slice-5c-worker' });
    });
  }, payload);
}

const body = (result: any, id: string) => result.bodies.find((entry: any) => entry.bodyId === id);
async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5C exact OpenCascade shapes');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const project = createAdvancedShapeProject();
  const baseline = await workerRequest(page, { kind: 'rebuild', revision: 1, document: project });
  check('kernel builds blade, guided inlet, and controlled Sweep as three exact valid solids',
    baseline.errors.length === 0 && baseline.bodies.length === 3 && baseline.bodies.every((entry: any) => entry.geometry?.valid && entry.geometry.solidCount === 1), baseline.errors);
  check('kernel three-section blade is axially extended and nonzero volume',
    body(baseline, SHAPE_IDS.bladeBody).geometry.bounds[1][0] - body(baseline, SHAPE_IDS.bladeBody).geometry.bounds[0][0] > 59 && body(baseline, SHAPE_IDS.bladeBody).geometry.volume > 1000);
  check('kernel guided Loft and scaled controlled-twist Sweep produce distinct placed solids',
    Boolean(body(baseline, SHAPE_IDS.inletBody)?.geometry?.bounds?.[0]?.[1] > 60 && body(baseline, SHAPE_IDS.sweepBody)?.geometry?.bounds?.[1]?.[1] < -50), {
      inlet: body(baseline, SHAPE_IDS.inletBody)?.geometry?.bounds,
      sweep: body(baseline, SHAPE_IDS.sweepBody)?.geometry?.bounds,
    });

  const editedProject = updateStudioV5Datum(project, SHAPE_IDS.tipPlane, {
    definition: { mode: 'principal', origin: [60, 0, 0], normal: [1, 0, 0], xDirection: [0, Math.cos(25 * Math.PI / 180), Math.sin(25 * Math.PI / 180)] },
  });
  const edited = await workerRequest(page, { kind: 'rebuild', revision: 2, document: editedProject });
  check('kernel +5 degree tip twist rebuild changes the blade exact geometry',
    !close(body(edited, SHAPE_IDS.bladeBody).geometry.volume, body(baseline, SHAPE_IDS.bladeBody).geometry.volume));
  check('kernel tip datum edit rebuilds only its dependent blade body',
    edited.evaluation.evaluatedBodyIds.join(',') === SHAPE_IDS.bladeBody &&
    edited.evaluation.reusedBodyIds.includes(SHAPE_IDS.inletBody) && edited.evaluation.reusedBodyIds.includes(SHAPE_IDS.sweepBody));

  const badGuideProject = updateStudioV5AdvancedSketch(project, SHAPE_IDS.inletGuide, { points: [[0, 118, 0], [20, 120, 0], [40, 122, 0]] });
  await workerRequest(page, { kind: 'rebuild', revision: 3, document: project });
  const failed = await workerRequest(page, { kind: 'rebuild', revision: 4, document: badGuideProject });
  check('kernel guide missing sections reports the exact failing Loft and keeps last-valid body',
    body(failed, SHAPE_IDS.inletBody).lastValid === true && failed.errors.some((entry: any) => entry.featureId === SHAPE_IDS.inletLoft && /misses Loft section/.test(entry.message)));
  check('kernel failed guided Loft leaves unrelated blade and Sweep cached',
    failed.evaluation.reusedBodyIds.includes(SHAPE_IDS.bladeBody) && failed.evaluation.reusedBodyIds.includes(SHAPE_IDS.sweepBody));
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 250 }, revisionAfter ?? null);
}

async function openProject(page: Page, project: any): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-slice5c-'));
  const filename = join(directory, 'slice5c.bomcad.json');
  writeFileSync(filename, JSON.stringify(project));
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const input = await page.$('#bw-open-file');
  await (input as any).uploadFile(filename);
  await waitForStudio(page, before);
}

async function undo(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await waitForStudio(page, before);
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5C visible browser gate');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('bw-studio-welcome-v1', '1'); localStorage.setItem('bw-studio-v2-seeded', '1'); localStorage.setItem('bw-studio-tour-v1', '1');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForStudio(page);
  check('browser exposes visible generic Profile, Path, Loft, and Sweep commands',
    (await page.$$('[data-v5-command="profile"], [data-v5-command="path"], [data-v5-command="loft"], [data-v5-command="sweep"]')).length === 4);
  const beforeProfileCreate = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-v5-command="profile"]');
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeProfileCreate);
  check('browser creates an ordinary editable Profile through the visible command',
    (await page.$$('#bw-sketch-tree [data-sketch-id]')).length === 1 && (await page.$eval('#bw-sketch-tree', (element) => element.textContent || '')).includes('Profile'));
  await openProject(page, createAdvancedShapeProject());
  const initial = await page.evaluate(() => ({ bodies: (window as any).__bwStudio.bodyResults(), hash: (window as any).__bwStudio.canonicalHash() }));
  check('browser renders three independently selectable exact advanced-shape bodies',
    initial.bodies.length === 3 && initial.bodies.every((entry: any) => entry.geometry?.valid) && (await page.$$('#bw-bodies .body-row')).length === 3);
  check('browser tree exposes every editable profile and path sketch',
    (await page.$$('#bw-sketch-tree [data-sketch-id]')).length === 10 && /profile/.test((await page.$eval('#bw-sketch-tree', (element) => element.textContent || '')).toLowerCase()));

  const beforeLoftEdit = await page.evaluate((bodyId) => ({
    revision: (window as any).__bwStudio.appliedRevision(),
    volume: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry.volume,
  }), SHAPE_IDS.bladeBody);
  await page.$eval(`[data-sel="${SHAPE_IDS.bladeLoft}"] [data-edit]`, (element: any) => element.click());
  await page.waitForSelector('#bw-v5-command[open]');
  check('browser Loft editor exposes ordered sections, guide, centreline, and continuity',
    Boolean(await page.$('[name="sectionIds"]')) && Boolean(await page.$('[name="guideSketchId"]')) && Boolean(await page.$('[name="centerlineSketchId"]')) && Boolean(await page.$('[name="startContinuity"]')));
  await page.$eval('#bw-v5-command [name="ruled"]', (element: any) => { element.checked = true; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeLoftEdit.revision);
  const afterLoftEdit = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry, SHAPE_IDS.bladeBody);
  check('browser Loft edit rebuilds one exact valid solid transactionally', afterLoftEdit.valid && !close(afterLoftEdit.volume, beforeLoftEdit.volume));

  const beforeLoftCreate = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-v5-command="loft"]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Visible Loft creation'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeLoftCreate);
  check('browser creates a new exact Loft body through the visible editor',
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults())).length === 4 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults())).every((entry: any) => entry.geometry?.valid));
  await undo(page);

  const beforeSweepCreate = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-v5-command="sweep"]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Visible Sweep creation'; });
  await page.select('#bw-v5-command [name="profileSketchId"]', SHAPE_IDS.sweepProfile);
  await page.select('#bw-v5-command [name="pathSketchId"]', SHAPE_IDS.sweepPath);
  await page.select('#bw-v5-command [name="orientation"]', 'controlled-twist');
  await page.$eval('#bw-v5-command [name="twistAngle"]', (element: any) => { element.value = '12'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeSweepCreate);
  check('browser creates a new exact controlled-twist Sweep body through the visible editor',
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults())).length === 4 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults())).every((entry: any) => entry.geometry?.valid));
  await undo(page);

  const beforeTipEdit = await page.evaluate((bodyId) => ({
    revision: (window as any).__bwStudio.appliedRevision(),
    blade: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry,
  }), SHAPE_IDS.bladeBody);
  await page.$eval(`#bw-sketch-tree [data-sketch-id="${SHAPE_IDS.tipProfile}"] [data-sketch-action="edit"]`, (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="points"]', (element: any) => { element.value = element.value.replace(/^17\.5/, '15.5'); });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeTipEdit.revision);
  const afterTipEdit = await page.evaluate((bodyId) => ({
    blade: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry,
    trace: (window as any).__bwStudio.evaluationTrace(),
  }), SHAPE_IDS.bladeBody);
  check('browser profile edit rebuilds its exact Loft while preserving unrelated cached bodies',
    !close(afterTipEdit.blade.volume, beforeTipEdit.blade.volume) && afterTipEdit.trace.reusedBodyIds.includes(SHAPE_IDS.inletBody) && afterTipEdit.trace.reusedBodyIds.includes(SHAPE_IDS.sweepBody));

  const beforeInvalid = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  await page.$eval(`#bw-sketch-tree [data-sketch-id="${SHAPE_IDS.tipProfile}"] [data-sketch-action="edit"]`, (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="points"]', (element: any) => { element.value = '0, 0\n1, 0\n2, 0'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await page.waitForFunction(() => /zero enclosed area/.test(document.getElementById('bw-v5-command-error')?.textContent || ''), { timeout: 60_000, polling: 250 });
  const afterInvalid = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  check('browser invalid profile Apply leaves document and undo/redo stacks byte-identical', JSON.stringify(beforeInvalid) === JSON.stringify(afterInvalid));
  await page.$eval('#bw-v5-command-cancel', (element: any) => element.click());

  const beforeSweep = await page.evaluate((bodyId) => ({
    revision: (window as any).__bwStudio.appliedRevision(),
    bounds: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry.bounds,
  }), SHAPE_IDS.sweepBody);
  await page.$eval(`[data-sel="${SHAPE_IDS.sweepFeature}"] [data-edit]`, (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="twistAngle"]', (element: any) => { element.value = '55'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeSweep.revision);
  const afterSweepBounds = await page.evaluate((bodyId) => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry.bounds, SHAPE_IDS.sweepBody);
  check('browser controlled-twist Sweep edit changes exact placed geometry in one transaction', JSON.stringify(afterSweepBounds) !== JSON.stringify(beforeSweep.bounds));

  const persisted = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), bodyIds: (window as any).__bwStudio.bodyIds(), sketchIds: (window as any).__bwStudio.sketchIds() }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && studio.bodyResults().length === 3 && studio.bodyResults().every((entry: any) => entry.geometry?.valid));
  }, { timeout: 60_000, polling: 250 });
  const recovered = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), bodyIds: (window as any).__bwStudio.bodyIds(), sketchIds: (window as any).__bwStudio.sketchIds() }));
  check('browser recovery reload preserves advanced feature, body, and sketch identities', JSON.stringify(recovered) === JSON.stringify(persisted), { persisted, recovered });
  check('browser Slice 5C gate has no page errors or native dialogs', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs });
  await context.close();
}

let server: Server | null = null;
let browser: Browser | null = null;
try {
  if (mode === 'all' || mode === 'document') await documentChecks();
  if (mode === 'all' || mode === 'kernel' || mode === 'browser') {
    const started = await startServer(); server = started.server;
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    if (mode === 'all' || mode === 'kernel') await kernelChecks(browser, started.url);
    if (mode === 'all' || mode === 'browser') await browserChecks(browser, started.url);
  }
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
}
if (failures) { console.error(`\n${failures}/${checks} Slice 5C checks failed`); process.exit(1); }
console.log(`\n${checks}/${checks} Slice 5C profile/shape checks passed`);
