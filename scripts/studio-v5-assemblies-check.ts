// Slice 5E gate: reusable component definitions, nested occurrence solving,
// explicit mates, linked occurrence rendering, recovery, and exact export.

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
import { prepareStudioV5Project } from '../static/studio-project-v5.js';
// @ts-ignore Browser-native modules intentionally have no TypeScript declarations.
import {
  canonicalStudioV5Project,
  createStudioV5AssemblyMate,
  createStudioV5ComponentOccurrence,
  deleteStudioV5ComponentOccurrence,
  duplicateStudioV5LinkedOccurrence,
  enterStudioV5AssemblyContext,
  exitStudioV5AssemblyContext,
  makeStudioV5OccurrenceIndependent,
  parseOrMigrateStudioV5RuntimeProject,
  replaceStudioV5ComponentOccurrence,
  studioV5RootAssembly,
  studioV5RootPart,
  updateStudioV5AssemblyMate,
  updateStudioV5ComponentOccurrence,
// @ts-ignore Browser-native modules intentionally have no TypeScript declarations.
} from '../static/studio-v5-runtime-document.js';
// @ts-ignore Browser-native module intentionally has no TypeScript declarations.
import { solveStudioV5Assembly, studioV5TranslationMatrix } from '../static/studio-v5-assembly.js';
import { ASSEMBLY_IDS, createSolvedAssemblyProject, sourceIds } from './studio-v5-assemblies-fixture.ts';
import { createThreeBodyRuntimeProject } from './studio-v5-runtime-fixture.ts';

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
const centre = (bounds: number[][]) => bounds[0].map((value, axis) => (value + bounds[1][axis]) / 2);

function datumRef(ownerId: string, occurrenceId: string, role: string) {
  return { ownerKind: 'datum', ownerId, occurrencePath: [occurrenceId], semanticPath: { role }, signature: { role } };
}

function planarFaceRef(ownerId: string, occurrenceId: string, p: number[], n: number[], role: string) {
  return { ownerKind: 'body', ownerId, occurrencePath: [occurrenceId], semanticPath: { role, topologyKind: 'planar-face' }, signature: { topologyKind: 'planar-face', p, n } };
}

async function documentChecks(): Promise<void> {
  console.log('\nSlice 5E assembly documents and solver');
  const project = createSolvedAssemblyProject();
  const assembly = studioV5RootAssembly(project);
  const solved = solveStudioV5Assembly(project, ASSEMBLY_IDS.root);
  check('document stores five reusable parts, one nested subassembly, and one root assembly',
    project.partDefinitions.length === 5 && project.assemblyDefinitions.length === 2 && assembly.occurrences.length === 4);
  check('solver composes nested fan and shaft occurrence paths at the explicit fan station',
    solved.leafOccurrences.find((entry: any) => entry.id.endsWith(ASSEMBLY_IDS.fan))?.occurrencePath.length === 2 &&
    solved.leafOccurrences.filter((entry: any) => entry.id.includes('occurrence-fan-')).every((entry: any) => close(entry.transform[14], -60)));
  check('fixed, concentric, distance, and angle mates fully constrain every explicit root occurrence',
    solved.state === 'fully-constrained' && solved.errors.length === 0 && [...solved.degreesOfFreedom.values()].every((value: number) => value === 0));
  check('component pattern remains one lightweight record with stable derived occurrences',
    assembly.occurrencePatterns.length === 1 && solved.leafOccurrences.filter((entry: any) => entry.patternInstance?.patternId === ASSEMBLY_IDS.compressorPattern).length === 2 &&
    project.partDefinitions.filter((part: any) => part.name === 'Compressor drum').length === 1 &&
    assembly.occurrences.every((entry: any) => !entry.id.startsWith(ASSEMBLY_IDS.compressorPattern + '-instance-')));

  const nestedPatternProject: any = canonicalStudioV5Project(project);
  nestedPatternProject.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.root).occurrencePatterns.push({
    id: 'occurrence-pattern-fan-modules', name: 'Fan module stages', kind: 'linear',
    sourceOccurrenceIds: [ASSEMBLY_IDS.fanModule], generatedCount: 2,
    definition: { direction: [0, 0, 1], spacing: 220 }, suppressed: false,
  });
  const nestedPatternSolved = solveStudioV5Assembly(prepareStudioV5Project(nestedPatternProject), ASSEMBLY_IDS.root);
  const nestedPatternLeaves = nestedPatternSolved.leafOccurrences.filter((entry: any) => entry.patternInstance?.patternId === 'occurrence-pattern-fan-modules');
  check('component pattern repeats every solved leaf of a reusable subassembly with stable nested paths',
    nestedPatternLeaves.length === 4 && nestedPatternLeaves.every((entry: any) => entry.occurrencePath.length === 2) &&
    new Set(nestedPatternLeaves.map((entry: any) => entry.occurrencePath[0])).size === 2,
    nestedPatternLeaves.map((entry: any) => ({ id: entry.id, path: entry.occurrencePath })));

  const linked = duplicateStudioV5LinkedOccurrence(project, ASSEMBLY_IDS.turbine, {
    id: 'occurrence-turbine-linked', name: 'Turbine:2', baseTransform: studioV5TranslationMatrix([0, 0, 140]),
  });
  check('linked duplicate reuses the same part definition without copying feature history',
    studioV5RootAssembly(linked).occurrences.find((entry: any) => entry.id === 'occurrence-turbine-linked').definition.partId ===
      studioV5RootAssembly(linked).occurrences.find((entry: any) => entry.id === ASSEMBLY_IDS.turbine).definition.partId && linked.partDefinitions.length === project.partDefinitions.length);
  const variant = updateStudioV5ComponentOccurrence(project, ASSEMBLY_IDS.compressor, { parameterOverrides: { moduleLength: 30 } });
  const variantOccurrence = studioV5RootAssembly(variant).occurrences.find((entry: any) => entry.id === ASSEMBLY_IDS.compressor);
  const variantSolved = solveStudioV5Assembly(variant, ASSEMBLY_IDS.root);
  check('component variant overrides remain occurrence-local and flow into patterned leaf instances',
    variantOccurrence.parameterOverrides.moduleLength === 30 &&
    variant.partDefinitions.find((entry: any) => entry.id === variantOccurrence.definition.partId).parameters.find((entry: any) => entry.name === 'moduleLength').value === 18 &&
    variantSolved.leafOccurrences.filter((entry: any) => entry.sourceOccurrenceId === ASSEMBLY_IDS.compressor).every((entry: any) => entry.parameterOverrides.moduleLength === 30));
  const independent = makeStudioV5OccurrenceIndependent(linked, 'occurrence-turbine-linked', { partId: 'part-turbine-independent', name: 'Independent turbine' });
  check('Make independent creates one remapped editable definition and retargets only that occurrence',
    independent.partDefinitions.length === project.partDefinitions.length + 1 && studioV5RootAssembly(independent).occurrences.find((entry: any) => entry.id === 'occurrence-turbine-linked').definition.partId === 'part-turbine-independent' &&
    studioV5RootAssembly(independent).occurrences.find((entry: any) => entry.id === ASSEMBLY_IDS.turbine).definition.partId !== 'part-turbine-independent');

  const parts = sourceIds();
  const replaced = replaceStudioV5ComponentOccurrence(project, ASSEMBLY_IDS.turbine, { kind: 'part', partId: parts['Compressor drum'] });
  const repairedTurbineMates = studioV5RootAssembly(replaced).mates.filter((mate: any) => mate.occurrenceIds.includes(ASSEMBLY_IDS.turbine));
  check('Replace retargets one component and repairs compatible datum owners without dropping unrelated mates',
    studioV5RootAssembly(replaced).occurrences.find((entry: any) => entry.id === ASSEMBLY_IDS.turbine).definition.partId === parts['Compressor drum'] &&
    studioV5RootAssembly(replaced).mates.length === assembly.mates.length && studioV5RootAssembly(replaced).mates.some((mate: any) => mate.id === 'mate-compressor-distance') &&
    repairedTurbineMates.length === 3 && repairedTurbineMates.every((mate: any) => mate.references.some((reference: any) =>
      reference.occurrencePath.includes(ASSEMBLY_IDS.turbine) && reference.ownerId.startsWith('datum-compressor-') && reference.signature?.repairedFromOwnerId?.startsWith('datum-turbine-'))));

  const context = enterStudioV5AssemblyContext(project, ASSEMBLY_IDS.compressor);
  check('edit in context activates the linked source part and stores an explicit occurrence breadcrumb',
    context.rootDocument.kind === 'part' && studioV5RootPart(context).name === 'Compressor drum' && context.metadata.editContext.occurrencePath[0] === ASSEMBLY_IDS.compressor);
  const returned = exitStudioV5AssemblyContext(context);
  check('leaving edit in context restores the containing assembly without copying the part',
    returned.rootDocument.kind === 'assembly' && returned.rootDocument.assemblyId === ASSEMBLY_IDS.root && !returned.metadata.editContext && returned.partDefinitions.length === 5);

  const deleted = deleteStudioV5ComponentOccurrence(project, ASSEMBLY_IDS.compressor);
  check('deleting a component removes its dependent mates and occurrence patterns transactionally',
    !studioV5RootAssembly(deleted).occurrences.some((entry: any) => entry.id === ASSEMBLY_IDS.compressor) &&
    !studioV5RootAssembly(deleted).mates.some((mate: any) => mate.occurrenceIds.includes(ASSEMBLY_IDS.compressor)) && studioV5RootAssembly(deleted).occurrencePatterns.length === 0);

  const beforeInvalid = JSON.stringify(project);
  let refused = 0;
  try { createStudioV5ComponentOccurrence(project, { id: 'bad-occurrence', name: 'Bad', definition: { kind: 'part', partId: 'missing' } }); } catch { refused++; }
  try { updateStudioV5ComponentOccurrence(project, ASSEMBLY_IDS.compressor, { baseTransform: Array(16).fill(2) }); } catch { refused++; }
  try { createStudioV5AssemblyMate(project, { id: 'bad-mate', kind: 'distance', occurrenceIds: [ASSEMBLY_IDS.nacelle], references: [] }); } catch { refused++; }
  check('invalid insert, non-rigid transform, and incomplete mate leave the document byte-identical', refused === 3 && JSON.stringify(project) === beforeInvalid);

  const mateKinds = ['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider'];
  const kindResults = mateKinds.map((kind) => {
    const candidate: any = canonicalStudioV5Project(project);
    const root = candidate.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.root);
    root.mates = [];
    root.occurrencePatterns = [];
    const isFixed = kind === 'fixed';
    root.mates.push({
      id: `mate-kind-${kind}`, name: `${kind} proof`, kind,
      occurrenceIds: isFixed ? [ASSEMBLY_IDS.compressor] : [ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor],
      references: isFixed ? [] : [datumRef('datum-nacelle-axis', ASSEMBLY_IDS.nacelle, 'anchor'), datumRef('datum-compressor-axis', ASSEMBLY_IDS.compressor, 'moving')],
      ...(['distance', 'angle'].includes(kind) ? { value: kind === 'angle' ? 30 : 25 } : {}), suppressed: false,
    });
    const prepared = prepareStudioV5Project(candidate);
    return solveStudioV5Assembly(prepared, ASSEMBLY_IDS.root);
  });
  check('solver accepts all ten required rigid mate types with explicit occurrence references', kindResults.every((result: any) => result.errors.length === 0), kindResults.map((result: any) => result.errors));

  const topologyProject: any = canonicalStudioV5Project(project);
  const topologyRoot = topologyProject.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.root);
  topologyRoot.mates = [{
    id: 'mate-topology-coincident', name: 'Direct planar faces', kind: 'coincident',
    occurrenceIds: [ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor],
    references: [
      planarFaceRef('body-nacelle', ASSEMBLY_IDS.nacelle, [0, 0, 12], [0, 0, 1], 'anchor'),
      planarFaceRef('body-compressor', ASSEMBLY_IDS.compressor, [0, 0, 9], [0, 0, 1], 'moving'),
    ],
    value: 0, suppressed: false,
  }];
  topologyRoot.occurrencePatterns = [];
  const topologySolved = solveStudioV5Assembly(prepareStudioV5Project(topologyProject), ASSEMBLY_IDS.root);
  check('solver resolves persistent planar-face topology signatures through component occurrence transforms',
    topologySolved.errors.length === 0 && close(topologySolved.transforms.get(ASSEMBLY_IDS.compressor)[14], 3),
    { errors: topologySolved.errors, transform: topologySolved.transforms.get(ASSEMBLY_IDS.compressor) });

  const closedGraph: any = canonicalStudioV5Project(project);
  const closedRoot = closedGraph.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.root);
  closedRoot.occurrencePatterns = [];
  closedRoot.mates = [
    { id: 'mate-closed-fixed', name: 'Fix anchor', kind: 'fixed', occurrenceIds: [ASSEMBLY_IDS.nacelle], references: [], suppressed: false },
    { id: 'mate-closed-ab', name: 'A to B', kind: 'distance', occurrenceIds: [ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor], references: [datumRef('datum-nacelle-station', ASSEMBLY_IDS.nacelle, 'anchor'), datumRef('datum-compressor-station', ASSEMBLY_IDS.compressor, 'moving')], value: 10, suppressed: false },
    { id: 'mate-closed-bc', name: 'B to C', kind: 'distance', occurrenceIds: [ASSEMBLY_IDS.compressor, ASSEMBLY_IDS.turbine], references: [datumRef('datum-compressor-station', ASSEMBLY_IDS.compressor, 'anchor'), datumRef('datum-turbine-station', ASSEMBLY_IDS.turbine, 'moving')], value: 10, suppressed: false },
    { id: 'mate-closed-ac', name: 'A to C', kind: 'distance', occurrenceIds: [ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.turbine], references: [datumRef('datum-nacelle-station', ASSEMBLY_IDS.nacelle, 'anchor'), datumRef('datum-turbine-station', ASSEMBLY_IDS.turbine, 'moving')], value: 25, suppressed: false },
  ];
  const closedSolved = solveStudioV5Assembly(prepareStudioV5Project(closedGraph), ASSEMBLY_IDS.root);
  check('solver verifies the final closed mate graph and reports the three driving constraints when a later solve invalidates an earlier mate',
    closedSolved.state === 'conflicting' && closedSolved.errors.some((entry: any) => entry.mateId === 'mate-closed-bc' &&
      ['mate-closed-ab', 'mate-closed-bc', 'mate-closed-ac'].every((id) => entry.conflictSet.includes(id))) &&
    closedSolved.residuals.some((entry: any) => entry.mateId === 'mate-closed-bc' && close(entry.residual, 5)),
    { errors: closedSolved.errors, residuals: closedSolved.residuals });

  const conflict = createStudioV5AssemblyMate(project, {
    id: 'mate-compressor-distance-conflict', name: 'Conflicting compressor station', kind: 'distance',
    occurrenceIds: [ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor],
    references: [datumRef('datum-nacelle-station', ASSEMBLY_IDS.nacelle, 'anchor'), datumRef('datum-compressor-station', ASSEMBLY_IDS.compressor, 'moving')],
    value: 45,
  });
  const conflictResult = solveStudioV5Assembly(conflict, ASSEMBLY_IDS.root);
  check('solver identifies a minimal two-mate conflict set instead of accepting contradictory stations',
    conflictResult.state === 'conflicting' && conflictResult.errors.length === 1 && conflictResult.errors[0].conflictSet.join(',') === 'mate-compressor-distance,mate-compressor-distance-conflict', conflictResult.errors);

  const nestedConflict: any = canonicalStudioV5Project(project);
  nestedConflict.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.fanSubassembly).mates.push({
    id: 'mate-shaft-distance-conflict', name: 'Conflicting nested shaft station', kind: 'distance',
    occurrenceIds: [ASSEMBLY_IDS.fan, ASSEMBLY_IDS.shaft],
    references: [datumRef('datum-fan-station', ASSEMBLY_IDS.fan, 'anchor'), datumRef('datum-shaft-station', ASSEMBLY_IDS.shaft, 'moving')],
    value: 12, suppressed: false,
  });
  const nestedConflictResult = solveStudioV5Assembly(prepareStudioV5Project(nestedConflict), ASSEMBLY_IDS.root);
  check('solver propagates nested-subassembly conflicts and DOF into the root assembly evaluation',
    nestedConflictResult.state === 'conflicting' && nestedConflictResult.degreesOfFreedom.has(ASSEMBLY_IDS.shaft) &&
    nestedConflictResult.errors.some((entry: any) => entry.conflictSet?.join(',') === 'mate-shaft-distance,mate-shaft-distance-conflict'),
    { state: nestedConflictResult.state, errors: nestedConflictResult.errors, dof: Object.fromEntries(nestedConflictResult.degreesOfFreedom) });

  const serialized = JSON.stringify(canonicalStudioV5Project(project));
  check('assembly project save/reopen preserves hierarchy, mates, and patterns byte-identically', JSON.stringify(parseOrMigrateStudioV5RuntimeProject(serialized)) === serialized);
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
    state.__assemblyWorker ||= new Worker('/static/studio-kernel.worker.js', { type: 'module' });
    state.__assemblySequence = (state.__assemblySequence || 0) + 1;
    const requestId = `assembly-${state.__assemblySequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Slice 5E worker timeout')), 60_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer); state.__assemblyWorker.removeEventListener('message', listener);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message));
        else resolve({ ...event.data, blobSize: event.data.blob?.size || 0, blobType: event.data.blob?.type || '' });
      };
      state.__assemblyWorker.addEventListener('message', listener);
      state.__assemblyWorker.postMessage({ ...request, requestId, projectId: 'project-slice-5e-worker' });
    });
  }, payload);
}

const occurrenceBodies = (result: any, occurrenceId: string) => result.bodies.filter((entry: any) => entry.occurrenceInstance?.occurrenceId === occurrenceId);
async function kernelChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5E exact assembly worker');
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const project = createSolvedAssemblyProject();
  const baseline = await workerRequest(page, { kind: 'rebuild', revision: 1, document: project });
  check('worker loads a root assembly and returns seven exact occurrence bodies',
    baseline.errors.length === 0 && baseline.bodies.length === 7 && baseline.bodies.every((entry: any) => entry.geometry?.valid && entry.geometry.solidCount === 1), baseline.errors);
  check('worker reports a fully constrained solve with explicit zero remaining degrees of freedom',
    baseline.evaluation.solverState === 'fully-constrained' && Object.values(baseline.evaluation.degreesOfFreedom).every((value) => value === 0), baseline.evaluation);
  check('nested fan disk and shaft retain complete occurrence paths and solved axial placement',
    occurrenceBodies(baseline, `${ASSEMBLY_IDS.fanModule}/${ASSEMBLY_IDS.fan}`)[0]?.occurrenceInstance.occurrencePath.length === 2 &&
    baseline.bodies.filter((entry: any) => entry.occurrenceInstance?.occurrencePath?.[0] === ASSEMBLY_IDS.fanModule).every((entry: any) => close(centre(entry.geometry.bounds)[2], -60)));
  const compressorBodies = baseline.bodies.filter((entry: any) => entry.bodyName.includes('Compressor'));
  check('linked compressor stages share one mesh payload while retaining independent exact placements',
    compressorBodies.length === 3 && compressorBodies.filter((entry: any) => entry.mesh).length === 1 && compressorBodies.filter((entry: any) => entry.renderSourceBodyId).length === 2 &&
    new Set(compressorBodies.map((entry: any) => Math.round(centre(entry.geometry.bounds)[2]))).size === 3, compressorBodies.map((entry: any) => ({ id: entry.bodyId, mesh: Boolean(entry.mesh), source: entry.renderSourceBodyId, bounds: entry.geometry.bounds })));

  const edited: any = canonicalStudioV5Project(project);
  const compressorPart = edited.partDefinitions.find((part: any) => part.name === 'Compressor drum');
  compressorPart.parameters.find((parameter: any) => parameter.name === 'moduleLength').value = 26;
  const editedPrepared = prepareStudioV5Project(edited);
  const sourceEdited = await workerRequest(page, { kind: 'rebuild', revision: 2, document: editedPrepared });
  const editedCompressors = sourceEdited.bodies.filter((entry: any) => entry.bodyName.includes('Compressor'));
  check('editing one source part rebuilds every linked occurrence and keeps unrelated parts cached',
    editedCompressors.every((entry: any) => close(entry.geometry.volume, editedCompressors[0].geometry.volume)) &&
    !close(editedCompressors[0].geometry.volume, compressorBodies[0].geometry.volume) && sourceEdited.evaluation.reusedBodyIds.includes('body-nacelle') && sourceEdited.evaluation.reusedBodyIds.includes('body-turbine'));

  let variantProject = updateStudioV5ComponentOccurrence(project, ASSEMBLY_IDS.compressor, { parameterOverrides: { moduleLength: 30 } });
  variantProject = duplicateStudioV5LinkedOccurrence(variantProject, ASSEMBLY_IDS.compressor, {
    id: 'occurrence-compressor-short', name: 'Compressor short:1', baseTransform: studioV5TranslationMatrix([0, 0, 170]),
  });
  variantProject = updateStudioV5ComponentOccurrence(variantProject, 'occurrence-compressor-short', { parameterOverrides: { moduleLength: 12 } });
  const variantResult = await workerRequest(page, { kind: 'rebuild', revision: 21, document: variantProject });
  const longBodies = variantResult.bodies.filter((entry: any) => entry.occurrenceInstance?.sourceOccurrenceId === ASSEMBLY_IDS.compressor);
  const shortBody = occurrenceBodies(variantResult, 'occurrence-compressor-short')[0];
  check('kernel evaluates distinct exact component variants and shares one mesh only among identical overrides',
    longBodies.length === 3 && new Set(longBodies.map((entry: any) => Math.round(entry.geometry.volume))).size === 1 &&
    longBodies.filter((entry: any) => entry.mesh).length === 1 && shortBody.mesh && !close(shortBody.geometry.volume, longBodies[0].geometry.volume) &&
    variantResult.evaluation.evaluatedVariantKeys.length === 6,
    { long: longBodies.map((entry: any) => ({ mesh: Boolean(entry.mesh), volume: entry.geometry.volume, source: entry.renderSourceBodyId })), short: { mesh: Boolean(shortBody?.mesh), volume: shortBody?.geometry?.volume }, variants: variantResult.evaluation.evaluatedVariantKeys });
  const changedVariant = updateStudioV5ComponentOccurrence(variantProject, 'occurrence-compressor-short', { parameterOverrides: { moduleLength: 14 } });
  const changedVariantResult = await workerRequest(page, { kind: 'rebuild', revision: 22, document: changedVariant });
  const compressorLongKey = changedVariantResult.bodies.find((entry: any) => entry.occurrenceInstance?.sourceOccurrenceId === ASSEMBLY_IDS.compressor)?.occurrenceInstance.variantKey;
  check('editing one variant rebuilds only its variant cache while the other component definitions stay exact and reusable',
    changedVariantResult.evaluation.reusedVariantBodyIds.some((key: string) => key.startsWith(compressorLongKey + ':')) &&
    changedVariantResult.evaluation.evaluatedVariantBodyIds.some((key: string) => key.includes('body-compressor')),
    changedVariantResult.evaluation);

  const moved = updateStudioV5AssemblyMate(editedPrepared, 'mate-compressor-distance', { value: 43 });
  const movedResult = await workerRequest(page, { kind: 'rebuild', revision: 3, document: moved });
  const movedCompressors = movedResult.bodies.filter((entry: any) => entry.bodyName.includes('Compressor'));
  check('editing one Distance mate moves the source stage and its component pattern without moving the turbine',
    // The earlier source-length edit grows about the original -9 mm sketch
    // base, so its solid centre sits 4 mm beyond the datum station.
    close(centre(movedCompressors[0].geometry.bounds)[2], 47) && close(centre(movedCompressors[1].geometry.bounds)[2], 71) &&
    close(centre(occurrenceBodies(movedResult, ASSEMBLY_IDS.turbine)[0].geometry.bounds)[2], 105), {
      compressorCentres: movedCompressors.map((entry: any) => centre(entry.geometry.bounds)),
      turbineCentre: centre(occurrenceBodies(movedResult, ASSEMBLY_IDS.turbine)[0].geometry.bounds),
    });

  const hidden = updateStudioV5ComponentOccurrence(moved, ASSEMBLY_IDS.fanModule, { visible: false });
  const hiddenResult = await workerRequest(page, { kind: 'rebuild', revision: 4, document: hidden });
  check('subassembly visibility propagates to every nested body without suppressing or rebuilding source geometry',
    hiddenResult.bodies.filter((entry: any) => entry.occurrenceInstance?.occurrencePath?.[0] === ASSEMBLY_IDS.fanModule).every((entry: any) => entry.visible === false && entry.suppressed === false) &&
    hiddenResult.evaluation.reusedBodyIds.includes('body-fan') && hiddenResult.evaluation.reusedBodyIds.includes('body-shaft'));

  const conflict = createStudioV5AssemblyMate(moved, {
    id: 'mate-compressor-distance-conflict', name: 'Conflicting compressor station', kind: 'distance',
    occurrenceIds: [ASSEMBLY_IDS.nacelle, ASSEMBLY_IDS.compressor],
    references: [datumRef('datum-nacelle-station', ASSEMBLY_IDS.nacelle, 'anchor'), datumRef('datum-compressor-station', ASSEMBLY_IDS.compressor, 'moving')], value: 55,
  });
  const conflictResult = await workerRequest(page, { kind: 'rebuild', revision: 5, document: conflict });
  check('conflicting mate keeps the complete last-valid solved assembly visible and identifies the two-mate conflict',
    conflictResult.errors.some((entry: any) => entry.conflictSet?.join(',') === 'mate-compressor-distance,mate-compressor-distance-conflict') &&
    conflictResult.evaluation.usedLastValid === true && conflictResult.bodies.every((entry: any) => entry.geometry?.valid) &&
    close(centre(conflictResult.bodies.find((entry: any) => entry.bodyName === 'Compressor:1 / Compressor drum').geometry.bounds)[2], 47), {
      errors: conflictResult.errors,
      usedLastValid: conflictResult.evaluation.usedLastValid,
      compressorCentre: centre(conflictResult.bodies.find((entry: any) => entry.bodyName === 'Compressor:1 / Compressor drum').geometry.bounds),
    });

  const nestedConflict: any = canonicalStudioV5Project(moved);
  nestedConflict.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.fanSubassembly).mates.push({
    id: 'mate-shaft-distance-conflict', name: 'Conflicting nested shaft station', kind: 'distance',
    occurrenceIds: [ASSEMBLY_IDS.fan, ASSEMBLY_IDS.shaft],
    references: [datumRef('datum-fan-station', ASSEMBLY_IDS.fan, 'anchor'), datumRef('datum-shaft-station', ASSEMBLY_IDS.shaft, 'moving')],
    value: 12, suppressed: false,
  });
  const nestedConflictResult = await workerRequest(page, { kind: 'rebuild', revision: 6, document: prepareStudioV5Project(nestedConflict) });
  check('nested mate conflict reaches the root worker trace and preserves every last-valid component body',
    nestedConflictResult.evaluation.solverState === 'conflicting' && nestedConflictResult.evaluation.usedLastValid === true &&
    nestedConflictResult.errors.some((entry: any) => entry.conflictSet?.join(',') === 'mate-shaft-distance,mate-shaft-distance-conflict') &&
    nestedConflictResult.bodies.every((entry: any) => entry.geometry?.valid),
    { evaluation: nestedConflictResult.evaluation, errors: nestedConflictResult.errors });

  const nestedPatternProject: any = canonicalStudioV5Project(moved);
  nestedPatternProject.assemblyDefinitions.find((entry: any) => entry.id === ASSEMBLY_IDS.root).occurrencePatterns.push({
    id: 'occurrence-pattern-fan-modules', name: 'Fan module stages', kind: 'linear',
    sourceOccurrenceIds: [ASSEMBLY_IDS.fanModule], generatedCount: 2,
    definition: { direction: [0, 0, 1], spacing: 220 }, suppressed: false,
  });
  const nestedPatternResult = await workerRequest(page, { kind: 'rebuild', revision: 7, document: prepareStudioV5Project(nestedPatternProject) });
  const nestedPatternBodies = nestedPatternResult.bodies.filter((entry: any) => entry.occurrenceInstance?.patternInstance?.patternId === 'occurrence-pattern-fan-modules');
  check('exact worker patterns all subassembly leaves as placed linked bodies sharing source geometry',
    nestedPatternResult.errors.length === 0 && nestedPatternBodies.length === 4 &&
    nestedPatternBodies.every((entry: any) => entry.geometry?.valid && entry.occurrenceInstance.occurrencePath.length === 2 && entry.renderSourceBodyId),
    nestedPatternBodies.map((entry: any) => ({ id: entry.bodyId, path: entry.occurrenceInstance.occurrencePath, source: entry.renderSourceBodyId })));

  const selectedBodyId = occurrenceBodies(movedResult, ASSEMBLY_IDS.turbine)[0].bodyId;
  const selected = await workerRequest(page, { kind: 'export-step', revision: 8, document: moved, bodyIds: [selectedBodyId] });
  check('selected component body exports as one placed exact STEP solid with its occurrence path',
    selected.errors.length === 0 && selected.blobSize > 500 && selected.manifest.documentKind === 'assembly' && selected.manifest.bodyCount === 1 &&
    selected.manifest.placements[0].occurrencePath[0] === ASSEMBLY_IDS.turbine, { errors: selected.errors, size: selected.blobSize, manifest: selected.manifest });
  const complete = await workerRequest(page, { kind: 'export-step', revision: 9, document: moved });
  check('complete assembly STEP export preserves every visible named component placement in its manifest',
    complete.errors.length === 0 && complete.blobSize > selected.blobSize && complete.manifest.bodyCount === 7 && complete.manifest.componentCount === 7 && complete.manifest.names.some((name: string) => name.includes('Fan rotor:1 / Fan disk:1')),
    { errors: complete.errors, size: complete.blobSize, manifest: complete.manifest });
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
      if (!element) throw new Error(`Slice 5E browser control is missing: ${value}`);
      element.focus(); element.click();
    }, selector);
  }) as Page['click'];
}

async function openProject(page: Page, project: any): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'bomwiki-slice5e-'));
  const filename = join(directory, 'slice5e.bomcad.json');
  writeFileSync(filename, JSON.stringify(project));
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  const input = await page.$('#bw-open-file');
  await (input as any).uploadFile(filename);
  await waitForStudio(page, before);
}

async function submitVisibleCommand(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await waitForStudio(page, before);
}

async function undo(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await waitForStudio(page, before);
}

async function browserChecks(browser: Browser, url: string): Promise<void> {
  console.log('\nSlice 5E visible browser assembly gate');
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
  check('browser exposes a real Assembly workspace, component tree, mate tree, and all ten mate commands',
    Boolean(await page.$('[data-workspace="assembly"]')) && Boolean(await page.$('#bw-assembly-tree')) && Boolean(await page.$('#bw-mate-tree')) &&
    (await page.$$('[data-assembly-mate]')).length === 10);

  const authoringPart: any = createThreeBodyRuntimeProject({ boolean: false, projectId: 'project-visible-assembly-authoring' });
  const authoringDefinition = authoringPart.partDefinitions[0];
  authoringDefinition.parameters.push({ id: 'parameter-variant-height', name: 'variantHeight', value: 20, unit: 'length' });
  authoringDefinition.features.find((entry: any) => entry.id === 'feature-shaft').h = 'variantHeight';
  await openProject(page, prepareStudioV5Project(authoringPart));
  await page.click('[data-workspace="assembly"]');
  await page.click('[data-assembly-command="create"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Visible authored assembly'; });
  await submitVisibleCommand(page);
  check('browser creates an assembly from the active editable part through the visible command',
    await page.evaluate(() => (window as any).__bwStudio.rootKind()) === 'assembly' && (await page.$$('#bw-assembly-tree .assembly-row')).length === 1 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().length)) === 3);

  await page.click('[data-assembly-command="insert"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Inserted module:2'; });
  await page.$eval('#bw-v5-command [name="z"]', (element: any) => { element.value = '35'; });
  await submitVisibleCommand(page);
  const occurrenceIds = await page.evaluate(() => (window as any).__bwStudio.occurrenceIds());
  const firstOccurrence = occurrenceIds[0];
  const secondOccurrence = occurrenceIds[1];
  check('browser inserts a second lightweight occurrence of an existing reusable part definition',
    occurrenceIds.length === 2 && (await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()).partDefinitions.length)) === 1 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().length)) === 6);
  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), secondOccurrence);
  await page.click('[data-assembly-command="variant"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await page.$eval('#bw-v5-command [name="parameterOverrides"]', (element: any) => { element.value = 'variantHeight = 32'; });
  await submitVisibleCommand(page);
  const visibleVariant = await page.evaluate((occurrenceId) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    const root = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId);
    return { occurrence: root.occurrences.find((entry: any) => entry.id === occurrenceId), bodies: (window as any).__bwStudio.bodyResults().filter((entry: any) => entry.occurrenceInstance?.occurrenceId === occurrenceId) };
  }, secondOccurrence);
  check('browser edits occurrence-local variant parameters transactionally and rebuilds the selected exact component',
    visibleVariant.occurrence.parameterOverrides.variantHeight === '32' && visibleVariant.bodies.some((entry: any) => entry.occurrenceInstance?.variantKey));

  const transformBefore = await page.evaluate(() => (window as any).__bwStudio.docJson());
  await page.click('[data-assembly-command="transform"]');
  await page.waitForSelector('#bw-v5-command[open]');
  const transformAttached = await page.evaluate((occurrenceId) => {
    const studio = (window as any).__bwStudio;
    return studio.gizmoState().attached && studio.gizmoState().occurrenceId === occurrenceId && studio.gizmoTranslateForTest([5, 0, 0]);
  }, secondOccurrence);
  const previewMatrix = await page.$eval('#bw-v5-command [name="matrix"]', (element: any) => element.value);
  await page.click('#bw-v5-command-cancel');
  check('browser occurrence gizmo previews a snapped direct transform and Cancel leaves the assembly byte-identical',
    transformAttached && previewMatrix !== '' && await page.evaluate(() => (window as any).__bwStudio.docJson()) === transformBefore);
  await page.click('[data-assembly-command="transform"]');
  await page.waitForSelector('#bw-v5-command[open]');
  await page.evaluate(() => (window as any).__bwStudio.gizmoTranslateForTest([5, 0, 0]));
  await submitVisibleCommand(page);
  const appliedTransform = await page.evaluate((occurrenceId) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId).occurrences.find((entry: any) => entry.id === occurrenceId).baseTransform;
  }, secondOccurrence);
  check('browser Apply commits the direct 3D occurrence transform as one rigid transactional edit', close(appliedTransform[12], 5) && close(appliedTransform[14], 35), appliedTransform);

  await page.click('[data-assembly-mate="coincident"]');
  await page.waitForSelector('#bw-v5-command[open]');
  const topologyOptions = await page.$$eval('#bw-v5-command [name="anchorReference"] option, #bw-v5-command [name="movingReference"] option',
    (elements) => elements.map((element) => element.textContent || '').filter((text) => /planar face/.test(text)));
  await page.click('#bw-v5-command-cancel');
  check('browser mate editor lists direct planar B-rep faces from both selected component occurrences', topologyOptions.length >= 4, topologyOptions);

  const mateKinds = ['fixed', 'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'revolute', 'slider'];
  const authoredKinds: string[] = [];
  let topologyAuthored = false;
  for (const kind of mateKinds) {
    await page.click(`[data-assembly-mate="${kind}"]`);
    await page.waitForSelector('#bw-v5-command[open]');
    await submitVisibleCommand(page);
    const mateState = await page.evaluate(() => ({ ids: (window as any).__bwStudio.mateIds(), json: JSON.parse((window as any).__bwStudio.docJson()) }));
    const root = mateState.json.assemblyDefinitions.find((entry: any) => entry.id === mateState.json.rootDocument.assemblyId);
    if (mateState.ids.length === 1 && root.mates[0]?.kind === kind) authoredKinds.push(kind);
    if (kind === 'coincident') topologyAuthored = root.mates[0]?.references?.every((reference: any) => reference.ownerKind === 'body' && reference.signature?.topologyKind === 'planar-face');
    await undo(page);
  }
  check('browser authors every required mate kind through Apply and one-command undo', authoredKinds.join(',') === mateKinds.join(','), authoredKinds);
  check('browser persists direct topology signatures instead of reducing face mates to component origins', topologyAuthored);

  const beforeInvalid = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  await page.click('[data-assembly-mate="distance"]');
  await page.select('#bw-v5-command [name="anchorOccurrenceId"]', secondOccurrence);
  await page.select('#bw-v5-command [name="movingOccurrenceId"]', secondOccurrence);
  await page.$eval('#bw-v5-command-form', (form: any) => form.requestSubmit());
  await page.waitForFunction(() => /two different occurrences/.test(document.getElementById('bw-v5-command-error')?.textContent || ''), { timeout: 60_000, polling: 250 });
  const afterInvalid = await page.evaluate(() => ({ json: (window as any).__bwStudio.docJson(), undo: (window as any).__bwStudio.undoDepth(), redo: (window as any).__bwStudio.redoDepth() }));
  check('browser invalid mate Apply preserves canonical document and undo/redo byte-identically', JSON.stringify(beforeInvalid) === JSON.stringify(afterInvalid));
  await page.click('#bw-v5-command-cancel');

  await page.click('[data-assembly-mate="fixed"]');
  await submitVisibleCommand(page);
  check('browser tree reports the inserted component fully constrained after a visible Fixed mate',
    (await page.$eval(`[data-occurrence-id="${secondOccurrence}"] small`, (element) => element.textContent)).includes('fully constrained'));

  const fixedMateId = (await page.evaluate(() => (window as any).__bwStudio.mateIds()))[0];
  await page.click(`[data-mate-id="${fixedMateId}"] [data-mate-action="select"]`);
  await page.click('[data-mate-context="edit"]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Edited fixed mate'; });
  await submitVisibleCommand(page);
  const editedMate = await page.evaluate((mateId) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId).mates.find((entry: any) => entry.id === mateId);
  }, fixedMateId);
  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), secondOccurrence);
  const deletionImpact = await page.$eval('#bw-context', (element) => element.textContent || '');
  check('browser edits a mate transactionally without replacing its stable ID and lists dependent records before component deletion',
    editedMate?.id === fixedMateId && editedMate?.name === 'Edited fixed mate' && /Delete affects:\s*1 mate\(s\),\s*0 pattern\(s\)/.test(deletionImpact),
    { editedMate, deletionImpact });

  await page.click('[data-assembly-command="linked"]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Linked module:3'; });
  await page.$eval('#bw-v5-command [name="z"]', (element: any) => { element.value = '70'; });
  await submitVisibleCommand(page);
  const thirdOccurrence = (await page.evaluate(() => (window as any).__bwStudio.occurrenceIds())).at(-1);
  check('browser linked duplicate adds occurrence geometry without copying the source part definition',
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().length)) === 9 &&
    (await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()).partDefinitions.length)) === 1);
  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), thirdOccurrence);
  await page.click('[data-assembly-command="independent"]');
  await page.$eval('#bw-v5-command [name="name"]', (element: any) => { element.value = 'Independent module'; });
  await submitVisibleCommand(page);
  check('browser Make Independent creates a second editable part definition while retaining all placed bodies',
    (await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()).partDefinitions.length)) === 2 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().length)) === 9);

  const originalPartId = await page.evaluate(() => JSON.parse((window as any).__bwStudio.docJson()).partDefinitions[0].id);
  await page.click('[data-assembly-command="replace"]');
  await page.select('#bw-v5-command [name="definition"]', 'part:' + originalPartId);
  await submitVisibleCommand(page);
  const replacement = await page.evaluate((occurrenceId) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId).occurrences.find((entry: any) => entry.id === occurrenceId).definition;
  }, thirdOccurrence);
  check('browser Replace retargets only the selected occurrence to the chosen reusable definition', replacement.kind === 'part' && replacement.partId === originalPartId);

  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), secondOccurrence);
  await page.click('[data-assembly-command="pattern"]');
  await page.$eval('#bw-v5-command [name="generatedCount"]', (element: any) => { element.value = '2'; });
  await submitVisibleCommand(page);
  check('browser component pattern remains one tree record and produces two selectable lightweight occurrences',
    (await page.$$('#bw-assembly-tree .assembly-pattern-row')).length === 1 &&
    (await page.evaluate(() => (window as any).__bwStudio.bodyResults().filter((entry: any) => entry.occurrenceInstance?.patternInstance).length)) === 6);

  const beforeVisibility = await page.evaluate(() => (window as any).__bwStudio.appliedRevision());
  await page.click(`[data-occurrence-id="${secondOccurrence}"] [data-occurrence-action="visibility"]`);
  await waitForStudio(page, beforeVisibility);
  const hiddenOccurrence = await page.evaluate(
    (occurrenceId) => (window as any).__bwStudio.bodyResults()
      .filter((entry: any) => entry.occurrenceInstance?.occurrenceId === occurrenceId)
      .every((entry: any) => entry.visible === false && entry.suppressed === false),
    secondOccurrence,
  );
  check('browser occurrence visibility hides that component without suppressing or deleting its exact bodies', hiddenOccurrence);
  await undo(page);

  await page.$eval(`[data-runtime-occurrence-id="${secondOccurrence}"] [data-occurrence-export]`, (element: any) => element.click());
  const selectedExport = await page.evaluate(async () => (window as any).__bwStudio.exportForTest('step'));
  check('browser selected-component export emits exactly its three placed exact bodies',
    selectedExport.errors.length === 0 && selectedExport.size > 500 && selectedExport.manifest.documentKind === 'assembly' && selectedExport.manifest.bodyCount === 3,
    { errors: selectedExport.errors, manifest: selectedExport.manifest });

  const persisted = await page.evaluate(async () => {
    await (window as any).__bwStudio.flushStorage();
    return { hash: (window as any).__bwStudio.canonicalHash(), occurrences: (window as any).__bwStudio.occurrenceIds(), mates: (window as any).__bwStudio.mateIds(), bodies: (window as any).__bwStudio.bodyResults().length };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction((bodyCount) => (window as any).__bwStudio?.mode().kind === 'idle' && (window as any).__bwStudio.bodyResults().length === bodyCount, { timeout: 60_000, polling: 250 }, persisted.bodies);
  const recovered = await page.evaluate(() => ({ hash: (window as any).__bwStudio.canonicalHash(), occurrences: (window as any).__bwStudio.occurrenceIds(), mates: (window as any).__bwStudio.mateIds(), bodies: (window as any).__bwStudio.bodyResults().length }));
  check('browser persistence/recovery preserves assembly hierarchy, mates, patterns, and solved bodies', JSON.stringify(recovered) === JSON.stringify(persisted), { persisted, recovered });

  await openProject(page, createSolvedAssemblyProject());
  const nestedState = {
    rows: (await page.$$('#bw-assembly-tree .assembly-row')).length,
    leaves: (await page.$$('#bw-assembly-tree .assembly-leaf-row')).length,
    mates: (await page.$$('#bw-mate-tree .mate-row')).length,
    solver: await page.evaluate(() => (window as any).__bwStudio.evaluationTrace().solverState),
  };
  check('browser loads the nested engine-module fixture with explicit component and mate structure',
    nestedState.rows === 4 && nestedState.leaves === 7 && nestedState.mates === 10 && nestedState.solver === 'fully-constrained', nestedState);
  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), ASSEMBLY_IDS.fanModule);
  const nestedInspector = await page.$eval('#bw-context', (element) => element.textContent || '');
  await page.click('[data-occurrence-context="export"]');
  const nestedExport = await page.evaluate(async () => (window as any).__bwStudio.exportForTest('step'));
  check('browser direct subassembly selection counts and exports every nested exact body by occurrence path',
    /Exact bodies:\s*2/.test(nestedInspector) && nestedExport.errors.length === 0 && nestedExport.manifest.bodyCount === 2 &&
    nestedExport.manifest.placements.every((entry: any) => entry.occurrencePath[0] === ASSEMBLY_IDS.fanModule),
    { nestedInspector, errors: nestedExport.errors, manifest: nestedExport.manifest });
  await page.evaluate((occurrenceId) => (window as any).__bwStudio.selectOccurrenceForTest(occurrenceId), ASSEMBLY_IDS.compressor);
  await page.click('[data-assembly-command="edit-context"]');
  await page.waitForSelector('#bw-v5-command[open][data-command="assembly-edit-context"]');
  await submitVisibleCommand(page);
  const entered = await page.evaluate(() => ({ kind: (window as any).__bwStudio.rootKind(), json: JSON.parse((window as any).__bwStudio.docJson()) }));
  await page.click('[data-workspace="assembly"]');
  await page.click('[data-assembly-command="exit-context"]');
  await page.waitForSelector('#bw-v5-command[open][data-command="assembly-exit-context"]');
  await submitVisibleCommand(page);
  check('browser edit-in-context stores the occurrence breadcrumb and returns to the solved containing assembly',
    entered.kind === 'part' && entered.json.metadata.editContext.occurrencePath[0] === ASSEMBLY_IDS.compressor &&
    await page.evaluate(() => (window as any).__bwStudio.rootKind()) === 'assembly' && await page.evaluate(() => (window as any).__bwStudio.evaluationTrace().solverState) === 'fully-constrained');

  await page.setViewport({ width: 375, height: 812 });
  await page.click('#bw-mtab-history');
  const touchTargets = await page.$$eval('#bw-assembly-tree button, #bw-assembly-tree label, #bw-mate-tree button', (elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).minHeight)));
  check('browser mobile assembly inspection keeps tree controls touch-sized while hiding desktop authoring',
    touchTargets.length > 0 && touchTargets.every((height) => height >= 44),
    touchTargets);
  const assemblyTabDisplay = await page.$eval('[data-workspace="assembly"]', (element) => getComputedStyle(element).display);
  check('browser mobile contract hides the desktop-only assembly authoring workspace', assemblyTabDisplay === 'none', assemblyTabDisplay);
  check('browser Slice 5E gate has no page errors or native dialogs', pageErrors.length === 0 && dialogs.length === 0, { pageErrors, dialogs });
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
if (failures) { console.error(`\n${failures}/${checks} Slice 5E checks failed`); process.exit(1); }
console.log(`\n${checks}/${checks} Slice 5E assembly checks passed`);
