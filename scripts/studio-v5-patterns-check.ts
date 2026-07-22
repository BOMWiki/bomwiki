// Slice 5D gate: linked editable body patterns across document, exact kernel,
// browser tree/edit controls, persistence, recovery, and selected export.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-expect-error Browser-native modules intentionally have no TypeScript declarations.
import { canonicalStudioV5Project, createStudioV5BodyPattern, deleteStudioV5BodyPattern, parseOrMigrateStudioV5RuntimeProject, studioV5RootPart, updateStudioV5AdvancedSketch, updateStudioV5BodyPattern, updateStudioV5Datum } from '../static/studio-v5-runtime-document.js';
import { ADVANCED_SHAPE_EDIT, SHAPE_IDS } from './studio-v5-shapes-fixture.ts';
import { createEditablePatternProject, createPatternSourceProject, patternInstanceId, PATTERN_IDS } from './studio-v5-patterns-fixture.ts';

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
  console.log('\nSlice 5D linked pattern documents');
  const project = createEditablePatternProject();
  const part = studioV5RootPart(project);
  const pattern = part.bodyPatterns[0];
  check('document stores one linked pattern without copied bodies or feature histories',
    part.bodyPatterns.length === 1 && part.bodies.length === 3 && part.features.length === 4 &&
    part.bodies.every((body: any) => !body.id.includes(PATTERN_IDS.pattern)));
  check('document pattern retains stable source identity, axis role, distribution, orientation, and count expression',
    pattern.sourceBodyId === SHAPE_IDS.bladeBody && pattern.references[0].ownerId === PATTERN_IDS.axis &&
    pattern.references[0].semanticPath.role === 'axis' && pattern.definition.count === 12 &&
    pattern.definition.distribution === 'full' && pattern.definition.orientation === 'rotate');
  check('document source remains an ordinary editable Loft plus downstream radial transform',
    part.bodies.find((body: any) => body.id === SHAPE_IDS.bladeBody).featureIds.join(',') ===
      [SHAPE_IDS.bladeLoft, PATTERN_IDS.radialMove].join(','));

  const counted = updateStudioV5BodyPattern(project, PATTERN_IDS.pattern, { count: 14 });
  const countedPart = studioV5RootPart(counted);
  check('document count edit preserves pattern, source body, and source feature identities',
    countedPart.bodyPatterns[0].id === PATTERN_IDS.pattern && countedPart.bodyPatterns[0].sourceBodyId === SHAPE_IDS.bladeBody &&
    countedPart.features.map((feature: any) => feature.id).join(',') === part.features.map((feature: any) => feature.id).join(','));
  const skipped = updateStudioV5BodyPattern(counted, PATTERN_IDS.pattern, { skippedIndices: [3, 9] });
  check('document skip list is an editable property of the one pattern record',
    studioV5RootPart(skipped).bodyPatterns[0].skippedIndices.join(',') === '3,9' && studioV5RootPart(skipped).bodies.length === 3);

  const sourceEdited = updateStudioV5AdvancedSketch(project, SHAPE_IDS.tipProfile, { points: ADVANCED_SHAPE_EDIT.tipPoints });
  check('document source profile edit preserves the pattern reference graph',
    studioV5RootPart(sourceEdited).bodyPatterns[0].sourceBodyId === SHAPE_IDS.bladeBody &&
    studioV5RootPart(sourceEdited).bodyPatterns[0].references[0].ownerId === PATTERN_IDS.axis);
  const linear = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: 'pattern-two-direction-grid', name: 'Two-direction grid', kind: 'linear', sourceBodyId: SHAPE_IDS.bladeBody,
    directionDatumIds: [PATTERN_IDS.axis, PATTERN_IDS.direction2], count: 3, count2: 2, spacing: 80, spacing2: 120,
  });
  const curve = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: 'pattern-curve-spacing', name: 'Curve spacing', kind: 'curve', sourceBodyId: SHAPE_IDS.bladeBody,
    pathSketchId: SHAPE_IDS.sweepPath, count: 3, distribution: 'extent', extent: 50, orientation: 'fixed',
  });
  const mirror = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: 'pattern-mirror', name: 'Mirror body', kind: 'mirror', sourceBodyId: SHAPE_IDS.bladeBody, planeDatumId: SHAPE_IDS.rootPlane,
  });
  check('document supports two-direction linear, curve-length, and mirror body pattern contracts',
    studioV5RootPart(linear).bodyPatterns[0].definition.count2 === 2 && studioV5RootPart(linear).bodyPatterns[0].references.length === 2 &&
    studioV5RootPart(curve).bodyPatterns[0].definition.distribution === 'extent' && studioV5RootPart(mirror).bodyPatterns[0].definition.count === 2);
  const hundredTwenty = updateStudioV5BodyPattern(project, PATTERN_IDS.pattern, { count: 120 });
  check('document memory shape stays source-plus-transform sized as occurrence count grows',
    JSON.stringify(hundredTwenty).length - JSON.stringify(project).length < 8 && studioV5RootPart(hundredTwenty).bodies.length === part.bodies.length);
  const beforeInvalid = JSON.stringify(project);
  let invalid = 0;
  try { updateStudioV5BodyPattern(project, PATTERN_IDS.pattern, { count: 1 }); } catch { invalid++; }
  try { updateStudioV5BodyPattern(project, PATTERN_IDS.pattern, { axisDatumId: 'datum-missing' }); } catch { invalid++; }
  try { updateStudioV5BodyPattern(project, PATTERN_IDS.pattern, { distribution: 'table', angles: [10] }); } catch { invalid++; }
  check('document rejects invalid count, reference, and table length transactionally', invalid === 3 && JSON.stringify(project) === beforeInvalid);

  const without = deleteStudioV5BodyPattern(project, PATTERN_IDS.pattern);
  check('document deleting a pattern leaves its source body and source history intact',
    studioV5RootPart(without).bodyPatterns.length === 0 && studioV5RootPart(without).bodies.some((body: any) => body.id === SHAPE_IDS.bladeBody) &&
    studioV5RootPart(without).features.some((feature: any) => feature.id === SHAPE_IDS.bladeLoft));
  const serialized = JSON.stringify(canonicalStudioV5Project(skipped));
  check('document save/reopen preserves linked pattern history byte-identically',
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
    state.__patternWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__patternSequence = (state.__patternSequence || 0) + 1;
    const requestId = `pattern-${state.__patternSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5D worker timeout')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__patternWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({ ...event.data, blobSize: event.data.blob?.size || 0, blobType: event.data.blob?.type || '' });
      };
      state.__patternWorker.addEventListener('message', listener);
      state.__patternWorker.postMessage({ ...request, requestId, projectId: 'project-slice-5d-worker' });
    });
  }, payload);
}

const body = (result: any, id: string) => result.bodies.find((entry: any) => entry.bodyId === id);
const instances = (result: any) => result.bodies.filter((entry: any) => entry.patternInstance?.patternId === PATTERN_IDS.pattern);
const patternBodies = (result: any, patternId: string) => result.bodies.filter((entry: any) => entry.patternInstance?.patternId === patternId);
const centre = (bounds: number[][]) => bounds[0].map((value, axis) => (value + bounds[1][axis]) / 2);
const cadToScene = ([x, y, z]: number[]) => [x, z, -y];
const applyMatrix = (matrix: number[], [x, y, z]: number[]) => [
  matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
  matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
  matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
];
const renderTransformsMatchExactCentres = (result: any, patternId: string) => {
  const source = body(result, SHAPE_IDS.bladeBody);
  const sourceCentre = cadToScene(centre(source.geometry.bounds));
  return patternBodies(result, patternId).every((entry: any) => {
    const rendered = applyMatrix(entry.renderTransform, sourceCentre);
    const exact = cadToScene(centre(entry.geometry.bounds));
    // OpenCascade's transformed-location bounding box may expand by its
    // shape tolerance; compare centres within that sub-millimetre envelope.
    return exact.every((value, axis) => close(value, rendered[axis], 0.2));
  });
};
async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5D exact linked pattern kernel');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const project = createEditablePatternProject();
  const baseline = await workerRequest(page, { kind: 'rebuild', revision: 1, document: project });
  const generated = instances(baseline);
  check('kernel evaluates three canonical bodies plus eleven linked pattern occurrences',
    baseline.errors.length === 0 && baseline.bodies.length === 14 && generated.length === 11, baseline.errors);
  check('kernel generates every occurrence as one exact BRep-checked solid matching source volume',
    generated.every((entry: any) => entry.geometry?.valid && entry.geometry.solidCount === 1 && close(entry.geometry.volume, body(baseline, SHAPE_IDS.bladeBody).geometry.volume)));
  check('kernel circular placement distributes occurrence centers around the X fan axis',
    new Set(generated.map((entry: any) => Math.round(Math.atan2(centre(entry.geometry.bounds)[2], centre(entry.geometry.bounds)[1]) * 180 / Math.PI))).size >= 10);
  check('kernel occurrence identities are stable pattern/index IDs',
    generated.map((entry: any) => entry.bodyId).join(',') === Array.from({ length: 11 }, (_, index) => patternInstanceId(index + 1)).join(','));
  check('kernel sends one render mesh for the source and lightweight transforms for every occurrence',
    generated.every((entry: any) => entry.mesh == null && entry.renderSourceBodyId === SHAPE_IDS.bladeBody && entry.renderTransform?.length === 16 && entry.sharesSourceGeometry === true) &&
    renderTransformsMatchExactCentres(baseline, PATTERN_IDS.pattern));

  const sourceEditedProject = updateStudioV5AdvancedSketch(project, SHAPE_IDS.tipProfile, { points: ADVANCED_SHAPE_EDIT.tipPoints });
  const sourceEdited = await workerRequest(page, { kind: 'rebuild', revision: 2, document: sourceEditedProject });
  check('kernel source profile edit propagates to all linked exact occurrences',
    sourceEdited.evaluation.evaluatedBodyIds.includes(SHAPE_IDS.bladeBody) && sourceEdited.evaluation.evaluatedPatternInstanceIds.length === 11 &&
    instances(sourceEdited).every((entry: any) => close(entry.geometry.volume, body(sourceEdited, SHAPE_IDS.bladeBody).geometry.volume)));
  check('kernel source edit keeps unrelated canonical bodies cached',
    sourceEdited.evaluation.reusedBodyIds.includes(SHAPE_IDS.inletBody) && sourceEdited.evaluation.reusedBodyIds.includes(SHAPE_IDS.sweepBody));

  const countedProject = updateStudioV5BodyPattern(sourceEditedProject, PATTERN_IDS.pattern, { count: 14 });
  const counted = await workerRequest(page, { kind: 'rebuild', revision: 3, document: countedProject });
  check('kernel count edit produces thirteen exact occurrences while preserving existing stable IDs',
    instances(counted).length === 13 && Array.from({ length: 11 }, (_, index) => patternInstanceId(index + 1)).every((id) => Boolean(body(counted, id))));
  const skippedProject = updateStudioV5BodyPattern(countedProject, PATTERN_IDS.pattern, { skippedIndices: [3] });
  const skipped = await workerRequest(page, { kind: 'rebuild', revision: 4, document: skippedProject });
  check('kernel instance skip removes only the selected stable occurrence',
    instances(skipped).length === 12 && !body(skipped, patternInstanceId(3)) && body(skipped, patternInstanceId(2)) && body(skipped, patternInstanceId(4)) &&
    skipped.evaluation.reusedPatternInstanceIds.length === 12 && skipped.evaluation.evaluatedPatternInstanceIds.length === 0);

  const movedAxisProject = updateStudioV5Datum(skippedProject, PATTERN_IDS.axis, {
    definition: { mode: 'principal', origin: [0, 0, 5], direction: [1, 0, 0] },
  });
  const movedAxis = await workerRequest(page, { kind: 'rebuild', revision: 5, document: movedAxisProject });
  check('kernel axis edit rebuilds generated placements without changing the source exact solid',
    movedAxis.evaluation.evaluatedPatternInstanceIds.length === 12 && movedAxis.evaluation.reusedBodyIds.includes(SHAPE_IDS.bladeBody) &&
    JSON.stringify(body(movedAxis, patternInstanceId(1)).geometry.bounds) !== JSON.stringify(body(skipped, patternInstanceId(1)).geometry.bounds));

  await workerRequest(page, { kind: 'rebuild', revision: 6, document: project });
  const brokenSource = updateStudioV5Datum(project, SHAPE_IDS.rootPlane, { suppressed: true });
  const failed = await workerRequest(page, { kind: 'rebuild', revision: 7, document: brokenSource });
  check('kernel broken source reports its dependency and retains all last-valid pattern solids',
    failed.errors.some((entry: any) => entry.featureId === SHAPE_IDS.bladeLoft) && instances(failed).length === 11 && instances(failed).every((entry: any) => entry.lastValid));

  const selected = await workerRequest(page, { kind: 'export-step', revision: 8, document: project, bodyIds: [patternInstanceId(5)] });
  check('kernel selected-occurrence STEP export contains exactly that valid solid',
    selected.errors.length === 0 && selected.blobSize > 500 && selected.manifest?.bodyCount === 1 &&
    selected.manifest?.placements?.[0]?.bodyId === patternInstanceId(5), {
      errors: selected.errors, size: selected.blobSize, manifest: selected.manifest,
    });

  const linearId = 'pattern-two-direction-grid';
  const linearProject = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: linearId, name: 'Two-direction grid', kind: 'linear', sourceBodyId: SHAPE_IDS.bladeBody,
    directionDatumIds: [PATTERN_IDS.axis, PATTERN_IDS.direction2], count: 3, count2: 2, spacing: 80, spacing2: 120,
  });
  const linearResult = await workerRequest(page, { kind: 'rebuild', revision: 9, document: linearProject });
  check('kernel evaluates a two-direction linear grid as five linked exact occurrences',
    linearResult.errors.length === 0 && patternBodies(linearResult, linearId).length === 5 && patternBodies(linearResult, linearId).every((entry: any) => entry.geometry?.valid && entry.sharesSourceGeometry) &&
    renderTransformsMatchExactCentres(linearResult, linearId), { errors: linearResult.errors, bodies: patternBodies(linearResult, linearId), centresMatch: renderTransformsMatchExactCentres(linearResult, linearId) });

  const curveId = 'pattern-curve-spacing';
  const curveProject = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: curveId, name: 'Curve extent', kind: 'curve', sourceBodyId: SHAPE_IDS.bladeBody,
    pathSketchId: SHAPE_IDS.sweepPath, count: 3, distribution: 'extent', extent: 50, orientation: 'fixed',
  });
  const curveResult = await workerRequest(page, { kind: 'rebuild', revision: 10, document: curveProject });
  check('kernel evaluates total-length curve placement as linked exact occurrences',
    curveResult.errors.length === 0 && patternBodies(curveResult, curveId).length === 2 && patternBodies(curveResult, curveId).every((entry: any) => entry.geometry?.valid && entry.sharesSourceGeometry) &&
    renderTransformsMatchExactCentres(curveResult, curveId), { errors: curveResult.errors, bodies: patternBodies(curveResult, curveId), centresMatch: renderTransformsMatchExactCentres(curveResult, curveId) });

  const mirrorId = 'pattern-mirror';
  const mirrorProject = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: mirrorId, name: 'Mirror body', kind: 'mirror', sourceBodyId: SHAPE_IDS.bladeBody, planeDatumId: SHAPE_IDS.rootPlane,
  });
  const mirrorResult = await workerRequest(page, { kind: 'rebuild', revision: 11, document: mirrorProject });
  check('kernel evaluates mirror as one linked exact occurrence on the selected plane',
    mirrorResult.errors.length === 0 && patternBodies(mirrorResult, mirrorId).length === 1 && patternBodies(mirrorResult, mirrorId)[0].geometry?.valid &&
    renderTransformsMatchExactCentres(mirrorResult, mirrorId));
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 250 }, revisionAfter ?? null);
}

async function openProject(page: Page, project: any): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-slice5d-'));
  const filename = join(directory, 'slice5d.bomcad.json');
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
  console.log('\nSlice 5D visible browser pattern gate');
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
  check('browser exposes the visible Pattern command and linked-pattern tree',
    Boolean(await page.$('[data-v5-command="pattern"]')) && Boolean(await page.$('#bw-pattern-tree')));
  await openProject(page, createPatternSourceProject());
  await page.evaluate((bodyId) => (window as any).__bwStudio.selectBodyForTest(bodyId), SHAPE_IDS.bladeBody);
  const beforeCreate = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-v5-command="pattern"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Visible editable fan pattern'; });
  await page.$eval('#bw-v5-command [name="count"]', (element: any) => { element.value = '12'; });
  await page.select('#bw-v5-command [name="patternKind"]', 'circular');
  await page.select('#bw-v5-command [name="axisDatumId"]', PATTERN_IDS.axis);
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeCreate);
  const patternId = await page.$eval('#bw-pattern-tree [data-pattern-id]', (element: any) => element.dataset.patternId);
  const browserInstanceId = (index: number) => `${patternId}-instance-${index}`;
  check('browser creates and renders eleven linked exact occurrences through the visible command',
    (await page.evaluate(() => (window as any).__bwStudio.patternInstanceIds())).length === 11 &&
    (await page.$$('#bw-pattern-tree .pattern-instance-row')).length === 11);
  const instancing = await page.evaluate((bodyId) => ({
    geometryCount: (window as any).__bwStudio.renderGeometryCount(),
    exact: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === bodyId).geometry.bounds,
    rendered: (window as any).__bwStudio.renderedBodyBounds(bodyId),
    sourceExact: (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === 'body-feature-blade-loft').geometry.bounds,
    sourceRendered: (window as any).__bwStudio.renderedBodyBounds('body-feature-blade-loft'),
  }), browserInstanceId(5));
  const exactSceneCentre = cadToScene(centre(instancing.exact));
  check('browser shares the source render geometry and applies occurrence transforms at exact placements',
    instancing.geometryCount === 3 && exactSceneCentre.every((value, axis) => close(value, centre(instancing.rendered)[axis], 0.01)), instancing);

  await page.click(`[data-pattern-instance-id="${browserInstanceId(5)}"] [data-pattern-instance-action="select"]`);
  const beforeCount = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`#bw-pattern-tree [data-pattern-id="${patternId}"] [data-pattern-action="edit"]`);
  await page.$eval('#bw-v5-command [name="count"]', (element: any) => { element.value = '14'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeCount);
  check('browser count edit grows the same pattern to thirteen stable occurrence rows',
    (await page.evaluate(() => (window as any).__bwStudio.patternInstanceIds())).length === 13 &&
    Boolean(await page.$(`[data-pattern-instance-id="${browserInstanceId(11)}"]`)) &&
    (await page.evaluate(() => (window as any).__bwStudio.selectedBodyId())) === browserInstanceId(5));

  const beforeInvalid = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  await page.click(`#bw-pattern-tree [data-pattern-id="${patternId}"] [data-pattern-action="edit"]`);
  await page.$eval('#bw-v5-command [name="count"]', (element: any) => { element.value = '1'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await page.waitForFunction(() => /integer from 2 to 5,000/.test(document.getElementById('bw-v5-command-error')?.textContent || ''), { timeout: 60_000, polling: 250 });
  const afterInvalid = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  check('browser invalid pattern Apply leaves document and undo/redo byte-identical', JSON.stringify(beforeInvalid) === JSON.stringify(afterInvalid));
  await page.click('#bw-v5-command-cancel');

  const beforeSource = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval(`#bw-sketch-tree [data-sketch-id="${SHAPE_IDS.tipProfile}"] [data-sketch-action="edit"]`, (element: any) => element.click());
  await page.$eval('#bw-v5-command [name="points"]', (element: any) => { element.value = element.value.replace(/^17\.5/, '15.5'); });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeSource);
  const propagation = await page.evaluate(() => ({ trace: (window as any).__bwStudio.evaluationTrace(), count: (window as any).__bwStudio.patternInstanceIds().length }));
  check('browser source profile edit visibly propagates through all linked occurrences',
    propagation.count === 13 && propagation.trace.evaluatedPatternInstanceIds.length === 13 && propagation.trace.reusedBodyIds.includes(SHAPE_IDS.inletBody));

  const beforeSkip = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`[data-pattern-instance-id="${browserInstanceId(3)}"] [data-pattern-instance-action="skip"]`);
  await waitForStudio(page, beforeSkip);
  check('browser occurrence Skip removes only that stable tree result',
    (await page.evaluate(() => (window as any).__bwStudio.patternInstanceIds())).length === 12 && !await page.$(`[data-pattern-instance-id="${browserInstanceId(3)}"]`));
  await undo(page);
  check('browser undo restores the skipped linked occurrence', (await page.evaluate(() => (window as any).__bwStudio.patternInstanceIds())).length === 13);

  const firstVisibility = await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds());
  const beforeVisibility = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`#bw-pattern-tree [data-pattern-id="${patternId}"] [data-pattern-action="visibility"]`);
  await waitForStudio(page, beforeVisibility);
  const hiddenVisibility = await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds());
  const visibilityTrace = await page.evaluate(() => (window as any).__bwStudio.evaluationTrace());
  check('browser pattern visibility hides generated meshes while preserving source visibility',
    firstVisibility.some((id: string) => id.includes(patternId)) && !hiddenVisibility.some((id: string) => id.includes(patternId)) && hiddenVisibility.includes(SHAPE_IDS.bladeBody) &&
    visibilityTrace.reusedPatternInstanceIds.length === 13 && visibilityTrace.evaluatedPatternInstanceIds.length === 0);
  await undo(page);

  await page.click(`[data-pattern-instance-id="${browserInstanceId(5)}"] [data-pattern-instance-action="select"]`);
  await page.$eval(`[data-pattern-instance-id="${browserInstanceId(5)}"] [data-body-export]`, (element: any) => { element.click(); });
  const exported = await page.evaluate(async (bodyId) => (window as any).__bwStudio.exportForTest('step', [bodyId]), browserInstanceId(5));
  check('browser selects and exports one generated occurrence as one exact STEP solid',
    exported.errors.length === 0 && exported.size > 500 && exported.manifest.bodyCount === 1 && exported.manifest.placements[0].bodyId === browserInstanceId(5));

  const persisted = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    return { hash: (window as any).__bwStudio.canonicalHash(), ids: (window as any).__bwStudio.patternInstanceIds() };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction((count) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && studio.patternInstanceIds().length === count);
  }, { timeout: 60_000, polling: 250 }, persisted.ids.length);
  const recovered = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), ids: (window as any).__bwStudio.patternInstanceIds() }));
  check('browser persistence/recovery preserves pattern history and stable occurrence identities', JSON.stringify(recovered) === JSON.stringify(persisted), { persisted, recovered });
  await page.setViewport({ width: 375, height: 812 });
  await page.click('#bw-mtab-history');
  const mobileControls = await page.$$eval('#bw-pattern-tree button, #bw-pattern-tree label', (elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).minHeight)));
  check('browser mobile pattern tree keeps occurrence controls touch-sized', mobileControls.length > 0 && mobileControls.every((height) => height >= 44), mobileControls);
  check('browser Slice 5D gate has no page errors or native dialogs', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs });
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
if (failures) { console.error(`\n${failures}/${checks} Slice 5D checks failed`); process.exit(1); }
console.log(`\n${checks}/${checks} Slice 5D linked pattern checks passed`);
