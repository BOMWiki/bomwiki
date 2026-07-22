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
import { canonicalStudioV5Project, createStudioV5BodyPattern, createStudioV5BooleanSplit, createStudioV5Datum, deleteStudioV5BodyPattern, materializeStudioV5PatternOccurrences, parseOrMigrateStudioV5RuntimeProject, studioV5RootPart, updateStudioV5AdvancedSketch, updateStudioV5BodyPattern, updateStudioV5Datum } from '../static/studio-v5-runtime-document.js';
import { ADVANCED_SHAPE_EDIT, SHAPE_IDS } from './studio-v5-shapes-fixture.ts';
import { createEditablePatternProject, createPatternSourceProject, patternInstanceId, PATTERN_IDS } from './studio-v5-patterns-fixture.ts';
import { createThreeBodyRuntimeProject, RUNTIME_BODY_IDS } from './studio-v5-runtime-fixture.ts';

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

function materializedRecord(patternId: string, index: number, sourceBodyId = SHAPE_IDS.bladeBody): any {
  const prefix = `materialized-test-${index}`;
  return {
    patternId, patternIndex: index, sourceBodyId,
    resource: { id: `${prefix}-resource`, name: `Independent ${index}`, mimeType: 'text/plain', byteLength: 4, encoding: 'base64', data: 'YnJlcA==' },
    feature: { id: `${prefix}-feature`, name: `Independent ${index}`, type: 'imported-step', suppressed: false, inputRefs: [], resultPolicy: { kind: 'new-body', bodyName: `Independent ${index}` }, extensions: { studioImportedStep: { resourceId: `${prefix}-resource`, exactBrep: true, parametricHistory: false } } },
    body: { id: `${prefix}-body`, name: `Independent ${index}`, kind: 'solid', createdByFeatureId: `${prefix}-feature`, featureIds: [`${prefix}-feature`], visible: true, suppressed: false },
  };
}

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

  const independent = materializeStudioV5PatternOccurrences(project, PATTERN_IDS.pattern, [materializedRecord(PATTERN_IDS.pattern, 5)]);
  const independentPart = studioV5RootPart(independent);
  check('document Make independent freezes one occurrence as an exact imported body and skips only its linked ordinal',
    independentPart.bodyPatterns[0].skippedIndices.includes(5) && independentPart.bodies.some((entry: any) => entry.id === 'materialized-test-5-body') &&
    independentPart.features.find((entry: any) => entry.id === 'materialized-test-5-feature')?.extensions?.studioPatternMaterialization?.independent === true);
  const dissolved = materializeStudioV5PatternOccurrences(project, PATTERN_IDS.pattern, [
    materializedRecord(PATTERN_IDS.pattern, 1), materializedRecord(PATTERN_IDS.pattern, 2),
  ], { dissolve: true });
  check('document Dissolve removes the linked pattern while retaining source and independent exact bodies',
    studioV5RootPart(dissolved).bodyPatterns.length === 0 && studioV5RootPart(dissolved).bodies.length === part.bodies.length + 2 &&
    studioV5RootPart(dissolved).bodies.some((entry: any) => entry.id === SHAPE_IDS.bladeBody));

  const fused = createStudioV5BodyPattern(createPatternSourceProject(), {
    id: 'pattern-fused-contract', name: 'Fused contract', kind: 'linear', sourceBodyId: SHAPE_IDS.bladeBody,
    directionDatumIds: [PATTERN_IDS.axis], count: 3, spacing: 10, outputMode: 'union',
  });
  check('document pattern fusion remains one editable source-linked definition rather than copied feature histories',
    studioV5RootPart(fused).bodyPatterns[0].outputMode === 'union' && studioV5RootPart(fused).bodies.length === 3);

  const split = createStudioV5BooleanSplit(createThreeBodyRuntimeProject({ boolean: false }), {
    id: 'split-housing-tool', name: 'Split housing with tool', targetBodyId: RUNTIME_BODY_IDS.housing,
    toolBodyId: RUNTIME_BODY_IDS.tool, keepOriginal: false, keepTools: true,
  });
  const splitPart = studioV5RootPart(split);
  check('document Boolean Split creates two explicit editable side results and retains hidden addressable sources',
    splitPart.features.filter((entry: any) => entry.type === 'boolean-split-side').length === 2 && splitPart.bodies.length === 5 &&
    splitPart.bodies.find((entry: any) => entry.id === RUNTIME_BODY_IDS.housing)?.visible === false && splitPart.bodies.find((entry: any) => entry.id === RUNTIME_BODY_IDS.tool)?.visible === true);
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

  const frozen = await workerRequest(page, {
    kind: 'freeze-pattern-v5', revision: 12, document: project, bodyIds: [patternInstanceId(5)], freezePrefix: 'kernel-independent-five',
  });
  check('kernel Make independent serializes one selected occurrence as an exact standalone B-rep record',
    frozen.errors.length === 0 && frozen.records.length === 1 && frozen.records[0].patternIndex === 5 && frozen.records[0].resource.byteLength > 500,
    { errors: frozen.errors, records: frozen.records?.map((entry: any) => ({ index: entry.patternIndex, bytes: entry.resource.byteLength })) });
  const independentProject = materializeStudioV5PatternOccurrences(project, PATTERN_IDS.pattern, frozen.records);
  const independentBodyId = frozen.records[0].body.id;
  const independentResult = await workerRequest(page, { kind: 'rebuild', revision: 13, document: independentProject });
  check('kernel materialized occurrence is one valid canonical body and its linked ordinal is removed',
    body(independentResult, independentBodyId)?.geometry?.valid && !body(independentResult, patternInstanceId(5)) && instances(independentResult).length === 10);
  const independentSourceEdit = updateStudioV5AdvancedSketch(independentProject, SHAPE_IDS.tipProfile, { points: ADVANCED_SHAPE_EDIT.tipPoints });
  const independentEdited = await workerRequest(page, { kind: 'rebuild', revision: 14, document: independentSourceEdit });
  check('kernel source edit changes linked occurrences but leaves the frozen independent B-rep unchanged',
    !close(body(independentEdited, SHAPE_IDS.bladeBody).geometry.volume, body(independentResult, SHAPE_IDS.bladeBody).geometry.volume) &&
    close(body(independentEdited, independentBodyId).geometry.volume, body(independentResult, independentBodyId).geometry.volume));

  const smallPattern = updateStudioV5BodyPattern(project, PATTERN_IDS.pattern, { count: 4 });
  const dissolvedRecords = await workerRequest(page, {
    kind: 'freeze-pattern-v5', revision: 15, document: smallPattern,
    bodyIds: [patternInstanceId(1), patternInstanceId(2), patternInstanceId(3)], freezePrefix: 'kernel-dissolved',
  });
  const dissolvedProject = materializeStudioV5PatternOccurrences(smallPattern, PATTERN_IDS.pattern, dissolvedRecords.records, { dissolve: true });
  const dissolvedResult = await workerRequest(page, { kind: 'rebuild', revision: 16, document: dissolvedProject });
  check('kernel Dissolve replaces all generated occurrences with independent exact canonical bodies',
    dissolvedRecords.errors.length === 0 && studioV5RootPart(dissolvedProject).bodyPatterns.length === 0 &&
    dissolvedRecords.records.every((record: any) => body(dissolvedResult, record.body.id)?.geometry?.valid) && patternBodies(dissolvedResult, PATTERN_IDS.pattern).length === 0);

  let fusedProject: any = createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-pattern-fusion-kernel' });
  fusedProject = createStudioV5Datum(fusedProject, {
    id: 'datum-fusion-x', name: 'Fusion X direction', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] },
  });
  fusedProject = createStudioV5BodyPattern(fusedProject, {
    id: 'pattern-touching-fusion', name: 'Touching box fusion', kind: 'linear', sourceBodyId: RUNTIME_BODY_IDS.housing,
    directionDatumIds: ['datum-fusion-x'], count: 3, spacing: 40, outputMode: 'union',
  });
  const fusedResult = await workerRequest(page, { kind: 'rebuild', revision: 17, document: fusedProject });
  const fusedBody = body(fusedResult, 'pattern-touching-fusion-fused');
  check('kernel pattern fusion produces one connected exact solid with the combined source-plus-occurrence volume',
    fusedResult.errors.length === 0 && fusedBody?.geometry?.valid && close(fusedBody.geometry.volume, 40 * 40 * 20 * 3) && fusedBody.sharesSourceGeometry === false,
    { errors: fusedResult.errors, geometry: fusedBody?.geometry });

  const splitProject = createStudioV5BooleanSplit(createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-boolean-split-kernel' }), {
    id: 'split-housing-tool', name: 'Split housing with tool', targetBodyId: RUNTIME_BODY_IDS.housing,
    toolBodyId: RUNTIME_BODY_IDS.tool, keepOriginal: false, keepTools: true,
  });
  const splitResult = await workerRequest(page, { kind: 'rebuild', revision: 18, document: splitProject });
  const outside = body(splitResult, 'body-split-housing-tool-outside');
  const inside = body(splitResult, 'body-split-housing-tool-inside');
  check('kernel Boolean Split keeps both exact valid sides and conserves target volume',
    splitResult.errors.length === 0 && outside?.geometry?.valid && inside?.geometry?.valid &&
    close(outside.geometry.volume + inside.geometry.volume, 40 * 40 * 20), { errors: splitResult.errors, outside: outside?.geometry, inside: inside?.geometry });
  await page.close();
}

async function waitForStudio(page: Page, revisionAfter?: number): Promise<void> {
  await page.waitForFunction((after) => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.mode().kind === 'idle' && (after == null || studio.appliedRevision() > after));
  }, { timeout: 60_000, polling: 250 }, revisionAfter ?? null);
}

function installSemanticControlActivation(page: Page): void {
  page.click = (async (selector: string) => {
    await page.evaluate((value) => {
      const element = document.querySelector(value) as HTMLElement | null;
      if (!element) throw new Error(`Slice 5D browser control is missing: ${value}`);
      element.focus(); element.click();
    }, selector);
  }) as Page['click'];
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
  installSemanticControlActivation(page);
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
  // Kernel geometry reports canonical CAD coordinates while Three.js renders
  // the same B-rep in the Studio scene basis (x, z, -y).
  const exactRenderCentre = cadToScene(centre(instancing.exact));
  check('browser shares the source render geometry and applies occurrence transforms at exact placements',
    instancing.geometryCount === 3 && exactRenderCentre.every((value, axis) => close(value, centre(instancing.rendered)[axis], 0.2)) &&
    cadToScene(centre(instancing.sourceExact)).every((value, axis) => close(value, centre(instancing.sourceRendered)[axis], 0.2)), instancing);

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

  const beforeIndependent = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`[data-pattern-instance-id="${browserInstanceId(5)}"] [data-pattern-instance-action="independent"]`);
  await page.waitForFunction((before) => {
    const studio = (window as any).__bwStudio;
    return studio.appliedRevision() > before || /Pattern materialization failed/.test(document.getElementById('bw-studio-msg')?.textContent || '');
  }, { timeout: 90_000, polling: 250 }, beforeIndependent);
  const independentError = await page.$eval('#bw-studio-msg', (element) => /Pattern materialization failed/.test(element.textContent || '') ? element.textContent || '' : '');
  if (independentError) throw new Error(independentError);
  await waitForStudio(page, beforeIndependent);
  const independentState = await page.evaluate(() => ({
    patternIds: (window as any).__bwStudio.patternInstanceIds(),
    bodyIds: (window as any).__bwStudio.bodyIds(),
    project: JSON.parse((window as any).__bwStudio.docJson()),
  }));
  check('browser Make independent freezes one generated occurrence as a canonical exact body',
    independentState.patternIds.length === 12 && !independentState.patternIds.includes(browserInstanceId(5)) && independentState.bodyIds.length === 4 &&
    independentState.project.resources.some((entry: any) => entry.extensions?.studioImportedStep));
  await undo(page);

  const beforeSmallCount = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`#bw-pattern-tree [data-pattern-id="${patternId}"] [data-pattern-action="edit"]`);
  await page.$eval('#bw-v5-command [name="count"]', (element: any) => { element.value = '4'; });
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeSmallCount);
  const beforeDissolve = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`#bw-pattern-tree [data-pattern-id="${patternId}"] [data-pattern-action="dissolve"]`);
  await waitForStudio(page, beforeDissolve);
  check('browser Dissolve replaces every active linked occurrence with an independent selectable exact body',
    (await page.evaluate(() => (window as any).__bwStudio.patternInstanceIds())).length === 0 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyIds())).length === 6 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults())).every((entry: any) => entry.geometry?.valid));

  const brokenPattern = updateStudioV5Datum(createEditablePatternProject(), PATTERN_IDS.axis, { suppressed: true });
  await openProject(page, brokenPattern);
  check('browser broken pattern reference is explicit in the tree with a Repair entry point', Boolean(await page.$('#bw-pattern-tree .pattern-row.is-broken')));
  const beforeRepair = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`#bw-pattern-tree [data-pattern-id="${PATTERN_IDS.pattern}"] [data-pattern-action="edit"]`);
  await page.select('#bw-v5-command [name="axisDatumId"]', PATTERN_IDS.direction2);
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeRepair);
  check('browser pattern Repair replaces the broken axis and restores every exact occurrence transactionally',
    !await page.$('#bw-pattern-tree .pattern-row.is-broken') && (await page.evaluate(() => (window as any).__bwStudio.patternInstanceIds())).length === 11);

  let fusedProject: any = createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-pattern-fusion-browser' });
  fusedProject = createStudioV5Datum(fusedProject, {
    id: 'datum-fusion-x', name: 'Fusion X direction', kind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] },
  });
  fusedProject = createStudioV5BodyPattern(fusedProject, {
    id: 'pattern-touching-fusion', name: 'Touching box fusion', kind: 'linear', sourceBodyId: RUNTIME_BODY_IDS.housing,
    directionDatumIds: ['datum-fusion-x'], count: 3, spacing: 40, outputMode: 'union',
  });
  await openProject(page, fusedProject);
  const fusedBrowserBody = await page.evaluate(() => (window as any).__bwStudio.bodyResults().find((entry: any) => entry.bodyId === 'pattern-touching-fusion-fused'));
  check('browser fused pattern displays one exact selectable result and hides its replaced source mesh',
    fusedBrowserBody?.geometry?.valid && close(fusedBrowserBody.geometry.volume, 40 * 40 * 20 * 3) &&
    (await page.$$('#bw-pattern-tree .pattern-instance-row')).length === 1 &&
    !(await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds())).includes(RUNTIME_BODY_IDS.housing));

  await openProject(page, createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-boolean-split-browser' }));
  await page.evaluate((bodyId) => (window as any).__bwStudio.selectBodyForTest(bodyId), RUNTIME_BODY_IDS.housing);
  check('browser exposes visible Boolean Split with explicit target and tool controls', Boolean(await page.$('[data-v5-command="split"]')));
  const beforeSplit = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click('[data-v5-command="split"]');
  await page.select('#bw-v5-command [name="toolBodyId"]', RUNTIME_BODY_IDS.tool);
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, beforeSplit);
  const splitBrowser = await page.evaluate(() => ({ results: (window as any).__bwStudio.bodyResults(), visible: (window as any).__bwStudio.visibleBodyIds(), bodyIds: (window as any).__bwStudio.bodyIds() }));
  check('browser Boolean Split commits both exact sides while retaining the hidden original and visible tool',
    splitBrowser.bodyIds.length === 5 && splitBrowser.results.filter((entry: any) => /split-/.test(entry.bodyId)).length === 2 &&
    splitBrowser.results.filter((entry: any) => /split-/.test(entry.bodyId)).every((entry: any) => entry.geometry?.valid) &&
    !splitBrowser.visible.includes(RUNTIME_BODY_IDS.housing) && splitBrowser.visible.includes(RUNTIME_BODY_IDS.tool), splitBrowser);

  await openProject(page, createEditablePatternProject());
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
