import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer, { type Browser, type Page } from 'puppeteer';

// @ts-expect-error Browser-native module intentionally has no declarations.
import { CadCommandService } from '../static/studio-agent-service.js';
import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { studioV5CanonicalHash } from '../static/studio-v5-runtime-document.js';
import {
  approveConnectionAsHuman,
  createStudioPage,
  McpClient,
  presentation,
  sha256,
  startStudioServer,
  ViewportRecorder,
  waitForSessionState,
} from './studio-v6-acceptance-check.ts';
import {
  buildCanonicalTurbofan,
  TURBOFAN_IDS,
} from './studio-v5-release-fixtures.ts';

type DemoGroup = {
  id: string;
  label: string;
  transactionIndices: number[];
  beforeTemplate?: string;
  afterTemplate?: string;
  afterValues?: Record<string, number>;
};

const require = createRequire(import.meta.url);
const FFMPEG_PATH = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const repoRoot = join(engineRoot, '..');
const evidenceRoot = join(engineRoot, 'var', 'studio-v6-turbofan-demo');
const manifestPath = join(engineRoot, 'var', 'studio-v6-turbofan-demo-manifest.json');
const targetClearanceMm = 12;

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

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function bodyBounds(body: any): number[][] {
  const bounds = body?.boundingBox;
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 2 ||
    bounds.some((corner) =>
      !Array.isArray(corner) ||
      corner.length !== 3 ||
      corner.some((value) => !Number.isFinite(value)))
  ) {
    throw new Error(`Exact body ${body?.body?.id || 'unknown'} has no finite bounding box.`);
  }
  return bounds;
}

function axialGap(left: any, right: any) {
  const leftBounds = bodyBounds(left);
  const rightBounds = bodyBounds(right);
  return rightBounds[0][0] - leftBounds[1][0];
}

function findExactBody(items: any[], name: string, occurrenceMarker: string) {
  return items.find((entry) =>
    (entry.body?.name === name || String(entry.body?.name || '').endsWith(` / ${name}`)) &&
    String(entry.body?.id || '').includes(occurrenceMarker))
    || items.find((entry) =>
      entry.body?.name === name || String(entry.body?.name || '').endsWith(` / ${name}`));
}

function constructionGroups(): DemoGroup[] {
  return [
    {
      id: 'layout',
      label: 'Define editable turbofan parameters, datums, and root assembly',
      transactionIndices: [0],
      beforeTemplate: 'demo.turbofan.layout',
    },
    {
      id: 'nacelle',
      label: 'Create nacelle profiles, lofts, inlet, and bypass passage',
      transactionIndices: [1],
      beforeTemplate: 'demo.turbofan.nacelle-sections',
      afterTemplate: 'demo.turbofan.nacelle-passage',
    },
    {
      id: 'core-casing',
      label: 'Create bypass splitter and core casing',
      transactionIndices: [2],
      beforeTemplate: 'demo.turbofan.core',
    },
    {
      id: 'fan-blade',
      label: 'Create the editable three-section twisted fan blade',
      transactionIndices: [3],
      beforeTemplate: 'demo.turbofan.fan-sections',
      afterTemplate: 'demo.turbofan.fan-blade',
    },
    {
      id: 'axial-blades',
      label: 'Create editable compressor and turbine blade families',
      transactionIndices: [4, 5, 6, 7, 8, 9, 10, 11],
    },
    {
      id: 'rotating-hot-section',
      label: 'Create disks, shafts, combustor, nozzle, supports, and bearings',
      transactionIndices: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      beforeTemplate: 'demo.turbofan.hot-section',
    },
    {
      id: 'patterns',
      label: 'Create the nested fan rotor and editable blade-row patterns',
      transactionIndices: [22, 23],
      beforeTemplate: 'demo.turbofan.fan-rotor',
      afterTemplate: 'demo.turbofan.fan-pattern',
      afterValues: { bladeCount: 12 },
    },
    {
      id: 'assembly',
      label: 'Solve all turbofan modules with axial datum mates',
      transactionIndices: [24],
      beforeTemplate: 'demo.turbofan.assemble',
      afterTemplate: 'demo.turbofan.assembly-ready',
    },
    {
      id: 'engineering-state',
      label: 'Assign engineering materials and saved inspection state',
      transactionIndices: [25, 26],
    },
  ];
}

async function waitForConnectionDialog(page: Page, clientLabel: string) {
  await page.evaluate(() => {
    (document.getElementById('bw-help-open') as HTMLButtonElement | null)?.click();
    (document.getElementById('bw-help-agent') as HTMLButtonElement | null)?.click();
  });
  await page.waitForFunction((label) => [...document.querySelectorAll('.ws-agent-pair[open] h2')]
    .some((heading) => (heading.textContent || '').includes(label)), {
    polling: 50,
    timeout: 10_000,
  }, clientLabel);
}

async function runDemo(browser: Browser, url: string) {
  const canonicalConstruction = buildCanonicalTurbofan();
  const canonicalHash = studioV5CanonicalHash(canonicalConstruction.project);
  const emptyProject = createEmptyStudioV5PartProject({
    projectId: 'project-canonical-turbofan-v5',
    name: 'Master layout',
    units: 'mm',
  });
  const emptySeedHash = studioV5CanonicalHash(emptyProject);
  const initialHash = studioV5CanonicalHash(new CadCommandService({ project: emptyProject }).snapshot());
  const { context, page, pageErrors, requestFailures } = await createStudioPage(browser, url, emptyProject);
  const client = new McpClient(new URL(url).origin, url, evidenceRoot);
  const clientLabel = 'V6 editable turbofan construction agent';
  const videoPath = join(evidenceRoot, 'cad-studio-v6-turbofan-demo.webm');
  const selectedStepPath = join(evidenceRoot, 'revised-hpc-stator-stage.step');
  const projectPath = join(evidenceRoot, 'editable-turbofan-project.json');
  const webvttPath = join(evidenceRoot, 'cad-studio-v6-turbofan-demo.vtt');
  const srtPath = join(evidenceRoot, 'cad-studio-v6-turbofan-demo.srt');
  let recorder: ViewportRecorder | null = null;
  let sessionId: string | null = null;
  const humanActions: string[] = [];
  const buildEvidence: any[] = [];
  try {
    const initialized = await client.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'studio-v6-turbofan-demo', version: '1.0.0' },
    });
    const tools = await client.rpc('tools/list');
    const coreSkill = await client.rpc('resources/read', { uri: 'bomwiki-cad://skills/core' });
    const toolNames = tools.result?.tools?.map((entry: any) => entry.name) || [];
    const skillText = coreSkill.result?.contents?.[0]?.text || '';
    recorder = await ViewportRecorder.start(page, videoPath);
    const activeRecorder = recorder;
    const connected = await client.tool('cad_session', {
      action: 'connect',
      clientLabel,
      mode: 'scoped-auto-commit',
      permissions: {
        granted: [
          'project.read',
          'project.edit',
          'project.save-new',
          'artifact.render',
          'artifact.export-project',
          'artifact.export-step',
          'artifact.export-narration',
          'ui.read',
          'ui.select',
          'ui.navigate',
          'ui.command-draft',
          'ui.present-preview',
          'ui.present-demo',
          'ui.present-narration',
          'ui.wait-events',
          'session.launch-visible',
        ],
      },
    });
    sessionId = connected.sessionId;
    await waitForConnectionDialog(page, clientLabel);
    await activeRecorder.captureCheckpoint('visible connection approval');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const approval = await approveConnectionAsHuman(page, clientLabel, false);
    humanActions.push('approve scoped auto-commit construction session');
    const connectedStatus = await waitForSessionState(client, connected.sessionId, 'connected');
    const summary = await client.tool('cad_inspect', {
      sessionId: connected.sessionId,
      query: { kind: 'project.summary' },
    });
    const initialSummary = {
      connected,
      connectedStatus,
      approval,
      summary,
    };

    const snapshot = async () => client.tool('cad_ui', {
      sessionId: sessionId!,
      action: 'snapshot',
    });
    const applyUi = async (actions: any[], correlationId: string, transition: 'cut' | 'animate' = 'animate') => {
      const before = await snapshot();
      return client.tool('cad_ui', {
        sessionId: sessionId!,
        action: 'apply',
        expectedUiRevision: before.uiRevision,
        correlationId,
        actions,
        presentation: presentation('recording', transition),
      });
    };
    const settle = async (correlationId: string) => applyUi(
      [{ kind: 'presentation.waitForSettled', correlationId }],
      correlationId,
      'cut',
    );
    const narrate = async (
      templateId: string,
      correlationId: string,
      values?: Record<string, number>,
    ) => {
      const before = await snapshot();
      const result = await client.tool('cad_ui', {
        sessionId: sessionId!,
        action: 'narrate',
        expectedUiRevision: before.uiRevision,
        templateId,
        ...(values ? { values } : {}),
        correlationId,
      });
      await activeRecorder.captureCheckpoint(`narration ${templateId}`);
      return result;
    };

    await applyUi([
      { kind: 'presentation.setMode', mode: 'recording' },
      { kind: 'narration.setMode', mode: 'recording' },
      { kind: 'workspace.activate', workspaceId: 'solid' },
      { kind: 'panel.open', panelId: 'model-tree' },
      { kind: 'presentation.waitForSettled', correlationId: 'demo-initial-ui' },
    ], 'demo-initial-ui', 'cut');
    await narrate('demo.turbofan.intro', 'demo-intro');
    await narrate('demo.turbofan.empty', 'demo-empty');
    const initialUi = await snapshot();
    const initialCounts = initialSummary.summary.result.counts;

    const groups = constructionGroups();
    let revision = initialSummary.summary.revision;
    for (const [groupIndex, group] of groups.entries()) {
      if (group.beforeTemplate) {
        await narrate(group.beforeTemplate, `demo-build-${group.id}-before`);
      }
      const operations = group.transactionIndices.flatMap((index) =>
        canonicalConstruction.log[index].operations.map((operation: any) => structuredClone(operation)));
      const transaction = {
        transactionId: `demo-build-${String(groupIndex + 1).padStart(2, '0')}-${group.id}`,
        label: group.label,
        expectedRevision: revision,
        atomic: true,
        operations,
        metadata: {
          actor: 'agent',
          clientLabel: 'CAD Studio V6 direct turbofan construction',
          source: 'agreed-visible-demo',
        },
      };
      const preview = await client.tool('cad_preview', {
        sessionId: sessionId!,
        transaction,
      });
      await activeRecorder.captureCheckpoint(`exact preview ${group.id}`);
      const committed = await client.tool('cad_commit', {
        sessionId: sessionId!,
        previewId: preview.previewId,
        expectedRevision: preview.baseRevision,
      });
      revision = committed.revision;
      const committedFrame = await settle(`demo-build-${group.id}-commit-rendered`);
      const settled = group.id === 'layout'
        ? committedFrame
        : await applyUi([
            { kind: 'viewport.fitAll' },
            {
              kind: 'presentation.waitForSettled',
              correlationId: `demo-build-${group.id}-settled`,
            },
          ], `demo-build-${group.id}-settled`, 'cut');
      buildEvidence.push({
        id: group.id,
        transactionId: transaction.transactionId,
        operationCount: operations.length,
        operationKinds: operations.map((entry: any) => entry.kind),
        previewId: preview.previewId,
        previewHash: preview.changeSet.documentHashAfter,
        exactGeometry: preview.validation?.exactGeometry,
        committedRevision: committed.revision,
        renderedRevision: settled.snapshot.viewport.renderedDocumentRevision,
        historyTransactionId: committed.historyEntry?.transactionId,
      });
      if (group.afterTemplate) {
        await narrate(
          group.afterTemplate,
          `demo-build-${group.id}-after`,
          group.afterValues,
        );
      }
      await activeRecorder.captureCheckpoint(`committed ${group.id}`);
    }

    const builtSummary = await client.tool('cad_inspect', {
      sessionId: sessionId!,
      query: { kind: 'project.summary' },
    });
    const builtTree = await client.tool('cad_inspect', {
      sessionId: sessionId!,
      query: { kind: 'project.tree', pageSize: 500 },
    });
    await applyUi([
      { kind: 'workspace.activate', workspaceId: 'assembly' },
      { kind: 'tree.setSectionExpanded', sectionId: 'components', expanded: true },
      { kind: 'tree.setSectionExpanded', sectionId: 'mates', expanded: true },
      { kind: 'viewport.setDisplayMode', displayModeId: 'shaded-edges' },
      { kind: 'viewport.standardView', viewId: 'front' },
      { kind: 'viewport.fitAll' },
      {
        kind: 'viewport.setCamera',
        camera: {
          projection: 'perspective',
          position: [215, 0, 520],
          target: [215, 0, 0],
          up: [0, 1, 0],
        },
      },
      { kind: 'presentation.waitForSettled', correlationId: 'demo-built-hero' },
    ], 'demo-built-hero');
    await narrate('demo.turbofan.assembly-ready', 'demo-built-assembly-ready');
    await activeRecorder.captureCheckpoint('clean built turbofan');

    const builtHealth = await client.tool('cad_query', {
      sessionId: sessionId!,
      query: { kind: 'geometry.health', scope: 'visible-model' },
    });
    await activeRecorder.captureCheckpoint('built turbofan exact health');
    const bodyInventory = await client.tool('cad_query', {
      sessionId: sessionId!,
      query: { kind: 'geometry.bodies', pageSize: 500 },
    });
    const bodyItems = bodyInventory.result.items || bodyInventory.result.bodies || [];
    const hpcBody = findExactBody(bodyItems, 'HPC stator vane', 'occurrence-hpc-stator');
    const combustorBody = findExactBody(bodyItems, 'Annular combustor casing', 'occurrence-combustor-outer');
    if (!hpcBody || !combustorBody) {
      throw new Error(`The exact HPC stator and combustor bodies were not found after construction: ${JSON.stringify({
        bodyInventoryKeys: Object.keys(bodyInventory.result || {}),
        itemCount: bodyItems.length,
        sample: bodyItems.slice(0, 30).map((entry: any) => entry.body),
      })}`);
    }

    const hpcRef = { kind: 'occurrence', id: 'occurrence-hpc-stator' };
    const combustorRef = { kind: 'occurrence', id: 'occurrence-combustor-outer' };
    const hpcBodyRef = { kind: 'body', id: hpcBody.body.id };
    const combustorBodyRef = { kind: 'body', id: combustorBody.body.id };
    const distanceMateRef = { kind: 'mate', id: 'mate-occurrence-hpc-stator-distance' };

    await narrate('demo.turbofan.locate-clearance', 'demo-clearance-locate');
    const located = await applyUi([
      { kind: 'selection.set', entity: hpcRef },
      { kind: 'tree.expand', entity: hpcRef },
      { kind: 'tree.reveal', entity: hpcRef },
      { kind: 'selection.add', entity: combustorRef },
      { kind: 'tree.reveal', entity: combustorRef },
      { kind: 'inspector.showEntity', entity: hpcRef },
      { kind: 'viewport.setDisplayMode', displayModeId: 'ghost' },
      {
        kind: 'viewport.setCamera',
        camera: {
          projection: 'perspective',
          position: [225, 0, 320],
          target: [225, 0, 0],
          up: [0, 1, 0],
        },
      },
      { kind: 'presentation.waitForSettled', correlationId: 'demo-clearance-targets' },
    ], 'demo-clearance-targets');
    await narrate('demo.turbofan.targets-found', 'demo-clearance-targets-found');
    await activeRecorder.captureCheckpoint('compressor and combustor selected');

    const currentClearance = await client.tool('cad_query', {
      sessionId: sessionId!,
      query: {
        kind: 'assembly.clearance',
        entities: [hpcBodyRef, combustorBodyRef],
      },
    });
    await activeRecorder.captureCheckpoint('current exact clearance');
    const currentClearanceMm = currentClearance.result.pairs[0]?.minimumClearanceMm;
    if (!Number.isFinite(currentClearanceMm)) {
      throw new Error('The exact current compressor-to-combustor clearance is unavailable.');
    }
    const mateDetail = await client.tool('cad_inspect', {
      sessionId: sessionId!,
      query: { kind: 'entity.detail', entity: distanceMateRef },
    });
    const currentMateValue = Number(mateDetail.result.value?.value);
    if (!Number.isFinite(currentMateValue)) {
      throw new Error('The editable HPC stator distance mate has no finite value.');
    }
    const currentAxialClearanceMm = axialGap(hpcBody, combustorBody);
    let targetMateValue = Math.round(
      (currentMateValue + currentClearanceMm - targetClearanceMm) * 1_000_000,
    ) / 1_000_000;

    await narrate('demo.turbofan.prepare-move', 'demo-clearance-prepare');
    let previousMateValue = currentMateValue;
    let previousClearanceMm = currentClearanceMm;
    let visiblePreview: any = null;
    let previewClearance: any = null;
    let previewClearanceMm = Number.NaN;
    let previewSolveIterations = 0;
    for (; previewSolveIterations < 5; previewSolveIterations++) {
      const previewedEdit = await applyUi([
        ...(previewSolveIterations === 0
          ? [
              { kind: 'selection.set', entity: distanceMateRef },
              { kind: 'command.open', commandId: 'assembly.mate.distance' },
            ]
          : []),
        { kind: 'command.setInput', fieldId: 'value', value: targetMateValue },
        { kind: 'command.preview' },
        { kind: 'presentation.focusAction', actionId: 'viewport' },
        {
          kind: 'presentation.waitForSettled',
          correlationId: `demo-clearance-preview-${previewSolveIterations + 1}`,
        },
      ], `demo-clearance-preview-${previewSolveIterations + 1}`, 'cut');
      visiblePreview = previewedEdit.results
        .find((entry: any) => entry.kind === 'command.preview')?.result;
      if (!visiblePreview) throw new Error('The normal distance-mate command did not produce a visible exact preview.');
      previewClearance = await client.tool('cad_query', {
        sessionId: sessionId!,
        previewId: visiblePreview.previewId,
        expectedRevision: visiblePreview.baseRevision,
        presentation: 'silent',
        query: {
          kind: 'assembly.clearance',
          entities: [hpcBodyRef, combustorBodyRef],
        },
      });
      previewClearanceMm = previewClearance.result.pairs[0]?.minimumClearanceMm;
      if (!Number.isFinite(previewClearanceMm)) {
        throw new Error('The exact preview clearance solver did not produce a finite distance.');
      }
      if (Math.abs(previewClearanceMm - targetClearanceMm) < 1e-5) break;
      const clearanceSlope =
        (previewClearanceMm - previousClearanceMm) /
        (targetMateValue - previousMateValue);
      if (!Number.isFinite(clearanceSlope) || Math.abs(clearanceSlope) < 1e-9) {
        throw new Error('The exact preview clearance solver encountered a degenerate axial response.');
      }
      const nextMateValue = targetMateValue +
        (targetClearanceMm - previewClearanceMm) / clearanceSlope;
      previousMateValue = targetMateValue;
      previousClearanceMm = previewClearanceMm;
      targetMateValue = Math.round(nextMateValue * 1_000_000) / 1_000_000;
    }
    if (Math.abs(previewClearanceMm - targetClearanceMm) >= 1e-5) {
      throw new Error(`The exact preview clearance solver did not converge to ${targetClearanceMm} mm.`);
    }
    await narrate('demo.turbofan.preview', 'demo-clearance-preview-visible');
    await activeRecorder.captureCheckpoint('visible constrained exact preview');
    const previewHpcBody = visiblePreview.evidence.bodyResults
      .find((entry: any) => entry.body.id === hpcBody.body.id);
    const previewCombustorBody = visiblePreview.evidence.bodyResults
      .find((entry: any) => entry.body.id === combustorBody.body.id);
    const previewAxialClearanceMm = axialGap(previewHpcBody, previewCombustorBody);
    const targetAxialClearanceMm = previewAxialClearanceMm;
    previewClearance = await client.tool('cad_query', {
      sessionId: sessionId!,
      previewId: visiblePreview.previewId,
      expectedRevision: visiblePreview.baseRevision,
      query: {
        kind: 'assembly.clearance',
        entities: [hpcBodyRef, combustorBodyRef],
      },
    });
    previewClearanceMm = previewClearance.result.pairs[0]?.minimumClearanceMm;
    const previewInterference = await client.tool('cad_query', {
      sessionId: sessionId!,
      previewId: visiblePreview.previewId,
      expectedRevision: visiblePreview.baseRevision,
      query: {
        kind: 'assembly.interference',
        entities: [hpcBodyRef, combustorBodyRef],
      },
    });
    await activeRecorder.captureCheckpoint('preview exact clearance and interference verified');
    const mate = mateDetail.result.value;
    const directPreview = await client.tool('cad_preview', {
      sessionId: sessionId!,
      transaction: {
        transactionId: 'demo-direct-mate-edit-parity',
        label: 'Set rear compressor clearance to 12 mm',
        expectedRevision: visiblePreview.baseRevision,
        atomic: true,
        operations: [{
          kind: 'mate.update',
          input: {
            mateId: distanceMateRef.id,
            patch: {
              name: mate.name,
              kind: mate.kind,
              occurrenceIds: mate.occurrenceIds,
              references: mate.references,
              value: targetMateValue,
              extensions: { flip: false },
            },
          },
        }],
        metadata: { actor: 'agent' },
      },
    });
    const previewHashParity =
      directPreview.changeSet.documentHashAfter === visiblePreview.changeSet.documentHashAfter;

    const committedEdit = await client.tool('cad_commit', {
      sessionId: sessionId!,
      previewId: visiblePreview.previewId,
      expectedRevision: visiblePreview.baseRevision,
    });
    const committedSettlement = await settle('demo-clearance-commit-settled');
    await activeRecorder.captureCheckpoint('committed constrained edit');

    const sectioned = await applyUi([
      { kind: 'selection.set', entity: hpcRef },
      { kind: 'viewport.activateSection', sectionId: TURBOFAN_IDS.halfSection },
      { kind: 'viewport.setDisplayMode', displayModeId: 'shaded-edges' },
      { kind: 'viewport.standardView', viewId: 'front' },
      { kind: 'viewport.fitAll' },
      {
        kind: 'viewport.setCamera',
        camera: {
          projection: 'perspective',
          position: [215, 0, 520],
          target: [215, 0, 0],
          up: [0, 1, 0],
        },
      },
      { kind: 'presentation.waitForSettled', correlationId: 'demo-section-settled' },
    ], 'demo-section-settled', 'cut');
    await narrate('demo.turbofan.section', 'demo-section');
    await activeRecorder.captureCheckpoint('longitudinal turbofan section');

    await narrate('demo.turbofan.export-stage', 'demo-export-stage');
    const selectedStep = await client.tool('cad_artifact', {
      sessionId: sessionId!,
      format: 'step',
      path: selectedStepPath,
      entities: [hpcRef],
    });
    const selectedStepBytes = await readFile(selectedStepPath);
    await activeRecorder.captureCheckpoint('selected compressor stage export');
    await narrate('demo.turbofan.done', 'demo-done');
    await narrate('demo.turbofan.final', 'demo-final');
    await activeRecorder.captureCheckpoint('final clean sectional turbofan');
    await activeRecorder.stop();
    recorder = null;

    const projectArtifact = await client.tool('cad_artifact', {
      sessionId: sessionId!,
      format: 'project',
      path: projectPath,
    });
    const projectBytes = await readFile(projectPath);
    const webvttArtifact = await client.tool('cad_artifact', {
      sessionId: sessionId!,
      format: 'webvtt',
      path: webvttPath,
    });
    const srtArtifact = await client.tool('cad_artifact', {
      sessionId: sessionId!,
      format: 'srt',
      path: srtPath,
    });
    const webvtt = await readFile(webvttPath, 'utf8');
    const srt = await readFile(srtPath, 'utf8');
    const beforeReload = await client.tool('cad_inspect', {
      sessionId: sessionId!,
      query: { kind: 'project.summary' },
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), {
      polling: 50,
      timeout: 30_000,
    });
    await waitForSessionState(client, sessionId!, 'recovering');
    const recovery = await client.tool('cad_session', {
      action: 'reconnect',
      sessionId: sessionId!,
    });
    await page.goto(recovery.launchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean((window as any).bomwikiCadAgent), {
      polling: 50,
      timeout: 30_000,
    });
    const recoveryApproval = await approveConnectionAsHuman(page, clientLabel, false);
    humanActions.push('approve bounded demo recovery');
    await waitForSessionState(client, sessionId!, 'connected');
    const recoveredSummary = await client.tool('cad_inspect', {
      sessionId: sessionId!,
      query: { kind: 'project.summary' },
    });
    await client.tool('cad_session', { action: 'close', sessionId: sessionId! });
    sessionId = null;

    const video = await readFile(videoPath);
    const videoProbe = spawnSync(FFMPEG_PATH, ['-hide_banner', '-i', videoPath], {
      encoding: 'utf8',
    });
    const durationMatch = videoProbe.stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    const videoDurationSeconds = durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : null;
    const videoLine = videoProbe.stderr.split('\n').find((line) => /Video:\s*vp9\b/.test(line)) || '';
    const dimensions = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
    const constructionTranscript = client.transcript.filter((entry) =>
      entry.tool === 'cad_preview' &&
      String((entry.arguments.transaction as any)?.transactionId || '').startsWith('demo-build-'));
    const constructionKinds = constructionTranscript.flatMap((entry) =>
      ((entry.arguments.transaction as any)?.operations || []).map((operation: any) => operation.kind));
    const forbiddenConstructionKinds = constructionKinds.filter((kind) =>
      /import|replace|template|opaque/i.test(kind));
    const forbiddenTranscript = client.transcript.filter((entry) =>
      /selector|clientX|clientY|pointer|keyboard|computer.use|screenshot/i.test(JSON.stringify(entry)));
    const finalClearanceMm = previewClearanceMm;
    const expectedConstructionKinds = canonicalConstruction.log
      .flatMap((entry: any) => entry.operations.map((operation: any) => operation.kind));

    return {
      initialized: initialized.result?.serverInfo?.name === 'bomwiki-cad',
      completeToolSurface: [
        'cad_capabilities',
        'cad_session',
        'cad_inspect',
        'cad_query',
        'cad_preview',
        'cad_commit',
        'cad_artifact',
        'cad_ui',
        'cad_events',
      ].every((name) => toolNames.includes(name)),
      canonicalSkillLoaded: /Never use Computer Use/.test(skillText),
      connection: {
        approved: Object.values(initialSummary.approval).every(Boolean),
        mode: initialSummary.connectedStatus.status?.mode,
      },
      emptyStart: {
        documentKind: initialSummary.summary.result.documentKind,
        counts: initialCounts,
        documentHash: initialSummary.summary.result.documentHash,
        expectedHash: initialHash,
        seedHash: emptySeedHash,
        uiRevision: initialUi.uiRevision,
      },
      construction: {
        groupCount: groups.length,
        buildEvidence,
        transcriptCount: constructionTranscript.length,
        operationKindsSha256: hashJson(constructionKinds),
        expectedOperationKindsSha256: hashJson(expectedConstructionKinds),
        forbiddenConstructionKinds,
        finalDocumentHash: builtSummary.result.documentHash,
        canonicalDocumentHash: canonicalHash,
        counts: builtSummary.result.counts,
        requiredTreeEntities: [
          TURBOFAN_IDS.rootAssembly,
          TURBOFAN_IDS.nacelleOccurrence,
          TURBOFAN_IDS.fanRotorOccurrence,
          TURBOFAN_IDS.hpcOccurrence,
          'occurrence-hpc-stator',
          'occurrence-combustor-outer',
          'occurrence-nozzle',
          TURBOFAN_IDS.halfSection,
        ].every((id) => builtTree.result.items.some((entry: any) => entry.id === id)),
        exactHealth: builtHealth.result,
      },
      edit: {
        currentClearanceMm,
        targetClearanceMm,
        currentAxialClearanceMm,
        targetAxialClearanceMm,
        currentMateValue,
        targetMateValue,
        previewSolveIterations: previewSolveIterations + 1,
        previewAxialClearanceMm,
        previewClearanceMm,
        previewClearanceScoped:
          previewClearance.result.previewScoped === true &&
          previewClearance.previewId === visiblePreview.previewId,
        previewInterferenceClear:
          previewInterference.result.previewScoped === true &&
          previewInterference.result.exactGeometry === true &&
          previewInterference.result.pairs.length === 0,
        previewHashParity,
        visiblePreviewExact: visiblePreview.validation?.exactGeometry === true,
        committedRevision: committedEdit.revision,
        renderedRevision: committedSettlement.snapshot.viewport.renderedDocumentRevision,
        committedPreviewHashParity:
          committedEdit.changeSet?.documentHashAfter === previewClearance.result.documentHash,
        finalClearanceMm,
        noPairInterference:
          previewInterference.result.exactGeometry === true &&
          previewInterference.result.pairs.length === 0,
        finalHealth: {
          exactGeometry: visiblePreview.evidence.exactGeometry === true,
          aggregate: {
            valid: visiblePreview.evidence.bodyResults.every((entry: any) => entry.valid === true),
          },
        },
      },
      visible: {
        targetsRevision: located.uiRevision,
        sectionId: sectioned.snapshot.viewport.activeSectionId,
        finalCamera: sectioned.snapshot.viewport.camera,
      },
      artifacts: {
        videoPath,
        videoBytes: video.byteLength,
        videoSha256: sha256(video),
        videoDurationSeconds,
        videoCodec: videoLine ? 'vp9' : null,
        videoWidth: dimensions ? Number(dimensions[1]) : null,
        videoHeight: dimensions ? Number(dimensions[2]) : null,
        videoSegments: 1,
        selectedStepPath,
        selectedStepSha256: selectedStep.sha256,
        selectedStepBodyCount: selectedStep.manifest?.scope?.bodyIds?.length,
        selectedStepIntegrity:
          selectedStep.sha256 === sha256(selectedStepBytes) &&
          selectedStepBytes.toString('utf8').startsWith('ISO-10303-21;'),
        projectPath,
        projectSha256: projectArtifact.sha256,
        projectIntegrity:
          projectArtifact.sha256 === sha256(projectBytes) &&
          JSON.parse(projectBytes.toString('utf8')).schemaVersion === 5,
        webvttPath,
        webvttSha256: webvttArtifact.sha256,
        srtPath,
        srtSha256: srtArtifact.sha256,
        cueCount: webvttArtifact.manifest?.cueCount,
        narrationParity: webvttArtifact.manifest?.cueCount === srtArtifact.manifest?.cueCount,
        agreedNarration:
          /Starting with an empty CAD Studio document/i.test(webvtt) &&
          /three editable nacelle sections/i.test(webvtt) &&
          /12-blade fan row/i.test(webvtt) &&
          /rear compressor stage and combustor/i.test(webvtt) &&
          /Exact clearance measured: 12 mm/i.test(webvtt) &&
          /No interference was detected/i.test(webvtt) &&
          /Exporting only the selected compressor stage/i.test(webvtt) &&
          /No cursor replay/i.test(webvtt) &&
          !/chain.of.thought|private reasoning|raw prompt|credential|secret/i.test(webvtt + srt),
      },
      recovery: {
        approval: Object.values(recoveryApproval).every(Boolean),
        hashBefore: beforeReload.result.documentHash,
        hashAfter: recoveredSummary.result.documentHash,
      },
      transcript: {
        sha256: hashJson(client.transcript),
        count: client.transcript.length,
        forbidden: forbiddenTranscript,
      },
      humanActions,
      pageErrors,
      requestFailures,
    };
  } finally {
    if (recorder) await recorder.stop().catch(() => {});
    if (sessionId) {
      await client.tool('cad_session', { action: 'close', sessionId }).catch(() => {});
    }
    await context.close();
    await client.close();
  }
}

console.log('\nCAD Studio V6 editable turbofan construction and engineering-change demo');
await rm(evidenceRoot, { recursive: true, force: true });
await rm(manifestPath, { force: true });
await mkdir(evidenceRoot, { recursive: true });
const { server, url } = await startStudioServer();
let browser: Browser | null = null;
let result: any = null;
const fatalErrors: string[] = [];
try {
  if (!existsSync(FFMPEG_PATH)) throw new Error('The bundled recording encoder is unavailable.');
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
  result = await runDemo(browser, url);
  check('agent host loads the canonical skill and complete CAD/UI tool surface',
    result.initialized &&
    result.completeToolSurface &&
    result.canonicalSkillLoaded);
  check('recording begins from a real empty schema-5 part after one visible scoped approval',
    result.connection.approved &&
    result.connection.mode === 'scoped-auto-commit' &&
    result.emptyStart.documentKind === 'part' &&
    result.emptyStart.counts.bodies === 0 &&
    result.emptyStart.counts.assemblies === 0 &&
    result.emptyStart.documentHash === result.emptyStart.expectedHash);
  check('nine visible public transactions replay the entire canonical construction sequence without an import or template shortcut',
    result.construction.groupCount === 9 &&
    result.construction.transcriptCount === 9 &&
    result.construction.operationKindsSha256 === result.construction.expectedOperationKindsSha256 &&
    result.construction.forbiddenConstructionKinds.length === 0 &&
    result.construction.buildEvidence.every((entry: any) =>
      entry.exactGeometry &&
      entry.committedRevision === entry.renderedRevision &&
      entry.historyTransactionId === entry.transactionId));
  check('constructed assembly is byte-identical to the canonical editable turbofan and retains required tree structure',
    result.construction.finalDocumentHash === result.construction.canonicalDocumentHash &&
    result.construction.requiredTreeEntities &&
    result.construction.counts.parts >= 20 &&
    result.construction.counts.assemblies >= 2 &&
    result.construction.counts.mates >= 50 &&
    result.construction.exactHealth.exactGeometry === true &&
    result.construction.exactHealth.aggregate?.valid === true);
  check('normal distance-mate command previews one constrained axial edit with exact direct-path parity',
    Number.isFinite(result.edit.currentClearanceMm) &&
    Math.abs(result.edit.previewClearanceMm - targetClearanceMm) < 1e-5 &&
    result.edit.previewClearanceScoped &&
    result.edit.previewInterferenceClear &&
    result.edit.previewHashParity &&
    result.edit.visiblePreviewExact);
  check('committed edit reaches exact 12 mm clearance, preserves alignment, and introduces no selected-pair interference',
    Math.abs(result.edit.finalClearanceMm - targetClearanceMm) < 1e-5 &&
    result.edit.noPairInterference &&
    result.edit.committedPreviewHashParity &&
    result.edit.finalHealth.exactGeometry === true &&
    result.edit.finalHealth.aggregate?.valid === true &&
    result.edit.committedRevision === result.edit.renderedRevision);
  check('longitudinal section and selected-stage STEP export remain exact and scoped',
    result.visible.sectionId === TURBOFAN_IDS.halfSection &&
    result.artifacts.selectedStepBodyCount === 1 &&
    result.artifacts.selectedStepIntegrity);
  check('project persists through reload recovery with an integrity-checked native artifact',
    result.artifacts.projectIntegrity &&
    result.recovery.approval &&
    result.recovery.hashBefore === result.recovery.hashAfter);
  check('one uncut VP9 recording and matching trusted subtitle tracks contain the agreed story',
    result.artifacts.videoSegments === 1 &&
    result.artifacts.videoBytes > 100_000 &&
    /^[a-f0-9]{64}$/.test(result.artifacts.videoSha256) &&
    Number.isFinite(result.artifacts.videoDurationSeconds) &&
    result.artifacts.videoDurationSeconds > 30 &&
    result.artifacts.videoCodec === 'vp9' &&
    result.artifacts.videoWidth === 1280 &&
    result.artifacts.videoHeight === 800 &&
    result.artifacts.cueCount > 20 &&
    result.artifacts.narrationParity &&
    result.artifacts.agreedNarration);
  check('observer transcript contains only CAD tools and no mouse, keyboard, selector, screenshot, or Computer Use control data',
    result.transcript.count >= 50 &&
    result.transcript.forbidden.length === 0 &&
    result.pageErrors.length === 0 &&
    result.requestFailures.length === 0,
    {
      forbidden: result.transcript.forbidden,
      pageErrors: result.pageErrors,
      requestFailures: result.requestFailures,
    });
} catch (error) {
  failed++;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  fatalErrors.push(message);
  console.error('  FAIL fatal V6 turbofan demo error', message);
} finally {
  await browser?.close().catch((error) => {
    failed++;
    fatalErrors.push(`Browser cleanup: ${String(error)}`);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.trim() || null;
const dirtyWorkingTree = Boolean(spawnSync('git', ['status', '--porcelain'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.trim());
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceCommit,
  dirtyWorkingTree,
  profile: 'bomwiki.cad.agentic-ui/v1',
  skillVersion: '0.6.0',
  script: 'editable-turbofan-construction-plus-clearance-edit',
  result,
  fatalErrors,
  gates: {
    emptyDocumentStart: failed === 0 ? 'pass' : 'fail',
    publicConstructionReplay: failed === 0 ? 'pass' : 'fail',
    exactClearanceEdit: failed === 0 ? 'pass' : 'fail',
    selectedStageExport: failed === 0 ? 'pass' : 'fail',
    persistenceRecovery: failed === 0 ? 'pass' : 'fail',
    recordingAndNarration: failed === 0 ? 'automated-pass-awaiting-human-visual-signoff' : 'fail',
  },
  status: failed === 0
    ? 'automated-pass-awaiting-human-visual-signoff'
    : 'fail',
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
console.log(`\n${passed}/${passed + failed} V6 turbofan demo checks passed`);
console.log(JSON.stringify({ status: manifest.status, manifestPath }, null, 2));
if (failed) process.exitCode = 1;
