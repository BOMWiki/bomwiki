import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { applyCadTransaction } from '../static/studio-agent-service.js';
import { buildCanonicalTurbofan, TURBOFAN_IDS } from './studio-v5-release-fixtures.ts';
import {
  closeBrowser, closeStudioServer, ensureEvidenceDirectory, openProjectThroughPublicControl,
  prepareStudioPage, sha256File, sha256Json, startStudioServer, waitForStudio,
} from './studio-v5-evidence-support.ts';

type Capture = { id: string; path: string; sha256: string; viewport: [number, number]; state: Record<string, unknown>; humanReview: 'pending' };
const output = ensureEvidenceDirectory('visual');
const captures: Capture[] = [];
let browser: Browser | null = null;
let server: Awaited<ReturnType<typeof startStudioServer>>['server'] | null = null;
const errors: string[] = [];
const dialogs: string[] = [];

async function setSavedView(page: Page, kind: 'section' | 'explode', active: boolean): Promise<void> {
  console.log(`view ${kind} -> ${active}: read`);
  const isActive = await page.evaluate((viewKind) => viewKind === 'section'
    ? Boolean((window as any).__bwStudio.activeSectionViewId())
    : Boolean((window as any).__bwStudio.activeExplodedViewId()), kind);
  if (isActive === active) { console.log(`view ${kind} already ${active}`); return; }
  console.log(`view ${kind} -> ${active}: toggle`);
  await page.evaluate((selector) => {
    const control = document.querySelector(selector) as HTMLElement | null;
    if (!control) throw new Error(`Saved-view control is missing: ${selector}`);
    control.click();
  }, `[data-inspection-kind="${kind}"] [data-inspection-action="toggle"]`);
  await page.waitForFunction((viewKind, expected) => {
    const studio = (window as any).__bwStudio;
    const current = viewKind === 'section' ? studio.activeSectionViewId() : studio.activeExplodedViewId();
    return studio.mode().kind === 'idle' && Boolean(current) === expected;
  }, { timeout: 120_000, polling: 50 }, kind, active);
  console.log(`view ${kind} -> ${active}: ready`);
}

async function capture(page: Page, id: string, state: Record<string, unknown>): Promise<void> {
  console.log(`capture ${id}: frame`);
  const uiEvidence = id.startsWith('05-') || id.startsWith('06-');
  const canvasPng = await page.evaluate((captureUi) => {
    const frame = (window as any).__bwStudio.captureFrameForTest();
    if (captureUi) return null;
    return frame;
  }, uiEvidence);
  console.log(`capture ${id}: screenshot`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const path = join(output, `${id}.png`);
  if (canvasPng) {
    console.log(`renderer ${canvasPng.width}x${canvasPng.height} · stage ${canvasPng.stageWidth}x${canvasPng.stageHeight}`);
    writeFileSync(path, Buffer.from(canvasPng.dataUrl.split(',')[1], 'base64'));
  }
  else {
    const snapshot = await page.evaluate((captureId) => {
      if (captureId.startsWith('05-')) {
        const selected = document.querySelector('[data-mate-id][aria-selected="true"]');
        const trace = (window as any).__bwStudio.evaluationTrace();
        return {
          title: 'Explicit mate conflict evidence', accent: '#b42318',
          summary: `Solver state: ${trace?.solverState || 'unknown'}`,
          lines: [
            `Selected tree item: ${selected?.getAttribute('aria-label') || 'conflicting mate'}`,
            ...String(document.querySelector('#bw-context-holder')?.textContent || '').split(/\s{2,}|\n/).map((entry) => entry.trim()).filter(Boolean),
            `Announcement: ${document.querySelector('#bw-studio-msg')?.textContent || ''}`,
          ],
        };
      }
      const inspection = document.querySelector('#bw-assembly-inspection') as HTMLElement | null;
      const buttons = [...document.querySelectorAll('#bw-assembly-inspection button')].filter((entry) => (entry as HTMLElement).offsetParent !== null).slice(0, 12);
      return {
        title: '390 px mobile assembly inspection evidence', accent: '#0b7667',
        summary: `Viewport ${innerWidth}px · document ${document.querySelector('.cadstudio-app')?.getAttribute('data-document-kind') || 'unknown'} · sheet ${inspection?.offsetParent ? 'visible' : 'hidden'}`,
        lines: [
          `Horizontal layout: ${document.documentElement.scrollWidth <= innerWidth + 1 ? 'no overflow' : `overflow ${document.documentElement.scrollWidth}px`}`,
          ...buttons.map((entry) => `${entry.getAttribute('aria-label') || entry.getAttribute('title') || entry.textContent?.trim() || 'control'} · ${Math.round(entry.getBoundingClientRect().height)}px target`),
          `Announcement: ${document.querySelector('#bw-studio-msg')?.textContent || ''}`,
        ],
      };
    }, id);
    if (!snapshot) throw new Error(`UI evidence source is missing for ${id}.`);
    const width = page.viewport()?.width || 800; const height = page.viewport()?.height || 700;
    const uiPng = await page.evaluate(({ evidence, width, height }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('2D evidence canvas is unavailable.');
      context.fillStyle = '#f5f7f8'; context.fillRect(0, 0, width, height);
      const margin = Math.max(24, Math.round(width * 0.06)); const cardWidth = width - margin * 2;
      context.fillStyle = '#ffffff'; context.strokeStyle = '#cbd5dc'; context.lineWidth = 2;
      context.beginPath(); context.roundRect(margin, margin, cardWidth, height - margin * 2, 14); context.fill(); context.stroke();
      context.fillStyle = evidence.accent; context.fillRect(margin, margin, 8, height - margin * 2);
      context.fillStyle = '#17242d'; context.font = `700 ${width < 500 ? 24 : 34}px system-ui, sans-serif`;
      context.fillText(evidence.title, margin + 30, margin + 52, cardWidth - 55);
      context.fillStyle = evidence.accent; context.font = `600 ${width < 500 ? 16 : 20}px system-ui, sans-serif`;
      context.fillText(evidence.summary, margin + 30, margin + 88, cardWidth - 55);
      context.fillStyle = '#33434d'; context.font = `${width < 500 ? 14 : 17}px ui-monospace, monospace`;
      let y = margin + 126; const lineHeight = width < 500 ? 23 : 28; const maxCharacters = Math.max(28, Math.floor((cardWidth - 60) / (width < 500 ? 8 : 10)));
      for (const line of evidence.lines) {
        const words = String(line).split(/\s+/); let row = '';
        for (const word of words) {
          if ((row + ' ' + word).trim().length > maxCharacters) { context.fillText(row, margin + 30, y, cardWidth - 55); y += lineHeight; row = word; }
          else row = (row + ' ' + word).trim();
        }
        if (row) { context.fillText(row, margin + 30, y, cardWidth - 55); y += lineHeight; }
        y += Math.round(lineHeight * 0.35); if (y > height - margin - lineHeight) break;
      }
      return canvas.toDataURL('image/png');
    }, { evidence: snapshot, width, height });
    writeFileSync(path, Buffer.from(uiPng.split(',')[1], 'base64'));
  }
  const viewport = page.viewport();
  captures.push({ id, path, sha256: sha256File(path), viewport: [viewport?.width || 0, viewport?.height || 0], state: { ...state, captureMode: uiEvidence ? 'semantic-ui-evidence-card' : 'renderer-canvas' }, humanReview: 'pending' });
  console.log(`captured ${id}`);
}

async function setOccurrenceVisible(page: Page, occurrenceId: string, visible: boolean): Promise<void> {
  const current = await page.evaluate((id) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    const assembly = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId);
    return assembly.occurrences.find((entry: any) => entry.id === id)?.visible;
  }, occurrenceId);
  if (current === visible) return;
  await page.evaluate((id) => (document.querySelector(`[data-occurrence-id="${CSS.escape(id)}"] [data-occurrence-action="visibility"]`) as HTMLElement)?.click(), occurrenceId);
  await page.waitForFunction((id, expected) => {
    const studio = (window as any).__bwStudio;
    const project = JSON.parse(studio.docJson());
    const assembly = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId);
    return studio.mode().kind === 'idle' && assembly.occurrences.find((entry: any) => entry.id === id)?.visible === expected;
  }, { timeout: 120_000, polling: 50 }, occurrenceId, visible);
}

try {
  const started = await startStudioServer(); server = started.server;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await prepareStudioPage(page, started.url, { width: 1600, height: 1000 });
  const construction = buildCanonicalTurbofan();
  const project = construction.project;
  await openProjectThroughPublicControl(page, project, 159, 'turbofan-visual');
  console.log('canonical project ready');

  await setSavedView(page, 'section', false); await setSavedView(page, 'explode', false);
  console.log('camera 01: set');
  await page.evaluate(() => (window as any).__bwStudio.setCameraDirectionForTest([-1, 0.62, 0.82], 1.35));
  console.log('camera 01: ready');
  await capture(page, '01-front-three-quarter-isometric', { section: false, exploded: false, camera: 'front-three-quarter' });

  await setSavedView(page, 'section', true); await setSavedView(page, 'explode', false);
  await page.evaluate(() => (window as any).__bwStudio.setCameraDirectionForTest([0, 0.12, 1], 1.25));
  await capture(page, '02-longitudinal-half-section', { section: TURBOFAN_IDS.halfSection, exploded: false, camera: 'lateral-longitudinal' });

  await setSavedView(page, 'section', false); await setSavedView(page, 'explode', false);
  await page.evaluate(() => (window as any).__bwStudio.setCameraDirectionForTest([1, 0.58, 0.82], 1.35));
  await capture(page, '03-rear-three-quarter-isometric', { section: false, exploded: false, camera: 'rear-three-quarter' });

  await setSavedView(page, 'section', false); await setSavedView(page, 'explode', true);
  await setOccurrenceVisible(page, TURBOFAN_IDS.nacelleOccurrence, false);
  await page.evaluate(() => (window as any).__bwStudio.setCameraDirectionForTest([0.1, 0.72, 1], 1.45));
  await capture(page, '04-axial-exploded-view', { section: false, exploded: 'exploded-turbofan-axial', hiddenForInspection: [TURBOFAN_IDS.nacelleOccurrence], camera: 'axial-exploded' });

  const root = project.assemblyDefinitions.find((entry: any) => entry.id === TURBOFAN_IDS.rootAssembly);
  const sourceMate = root.mates.find((entry: any) => entry.id === TURBOFAN_IDS.hpcDistanceMate);
  const conflict = applyCadTransaction(project, {
    transactionId: 'visual-conflict', label: 'Create explicit mate conflict for accessibility review', atomic: true,
    operations: [{ kind: 'mate.create', input: {
      id: 'mate-hpc-station-visual-conflict', name: 'Conflicting HPC station', mateKind: 'distance',
      occurrenceIds: sourceMate.occurrenceIds, references: sourceMate.references, value: 173,
    } }],
  }).project;
  await openProjectThroughPublicControl(page, conflict, 159, 'turbofan-conflict-visual');
  await page.waitForFunction(() => (window as any).__bwStudio.evaluationTrace()?.solverState === 'conflicting', { timeout: 120_000 });
  await page.evaluate(() => (document.querySelector('[data-mate-id="mate-hpc-station-visual-conflict"] [data-mate-action="select"]') as HTMLElement)?.click());
  await page.evaluate(() => (window as any).__bwStudio.setCameraDirectionForTest([0, 0.12, 1], 1.25));
  await capture(page, '05-explicit-mate-conflict', { solver: 'conflicting', conflictSet: [TURBOFAN_IDS.hpcDistanceMate, 'mate-hpc-station-visual-conflict'] });
  await context.close();

  const mobileContext = await browser.createBrowserContext();
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (error) => errors.push(String(error)));
  mobile.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await prepareStudioPage(mobile, started.url, { width: 390, height: 844 });
  await openProjectThroughPublicControl(mobile, project, 159, 'turbofan-mobile-visual');
  await mobile.evaluate(() => (document.querySelector('#bw-mtab-history') as HTMLElement)?.click());
  await mobile.waitForFunction(() => document.querySelector('.cadstudio-app')?.classList.contains('m-open-history'));
  const mobilePanel = await mobile.evaluate(() => {
    const app = document.querySelector('.cadstudio-app');
    const tree = document.querySelector('#bw-tree');
    const inspection = document.querySelector('#bw-assembly-inspection');
    return { documentKind: (app as HTMLElement)?.dataset.documentKind, tree: tree && getComputedStyle(tree).display, inspection: inspection && getComputedStyle(inspection).display, hidden: (inspection as HTMLElement)?.hidden };
  });
  if (mobilePanel.documentKind !== 'assembly' || mobilePanel.tree === 'contents' || mobilePanel.inspection === 'none' || mobilePanel.hidden) {
    throw new Error(`Mobile assembly inspection sheet is not visible: ${JSON.stringify(mobilePanel)}`);
  }
  await mobile.evaluate(() => document.querySelector('#bw-assembly-inspection')?.scrollIntoView({ block: 'center' }));
  await capture(mobile, '06-mobile-assembly-inspection', { section: TURBOFAN_IDS.halfSection, panel: 'model-tree', width: 390 });
  await mobileContext.close();

  if (errors.length || dialogs.length || captures.length !== 6) throw new Error(`Visual capture failed: ${JSON.stringify({ errors, dialogs, captures: captures.length })}`);
  const manifest = {
    gate: 'v5-visual', status: 'awaiting-human-review', projectId: project.projectId,
    projectHash: sha256Json(project), constructionLogHash: sha256Json(construction.log),
    requiredDesktopCaptures: captures.slice(0, 4).map((entry) => entry.id),
    supplementaryCaptures: captures.slice(4).map((entry) => entry.id), captures,
    reviewerQuestions: [
      'Reads immediately as a small turbofan demonstrator rather than a household fan',
      'Blades visibly taper and twist', 'Credible axial length and multiple internal stages',
      'Stationary, rotating, casing, shaft, combustor, and nozzle structures are distinguishable',
      'Sectioning explains the assembly', 'Exploded view corresponds to the same solved model',
    ],
    humanReview: { status: 'pending', reviewer: null, reviewedAt: null, answers: [] },
  };
  const manifestPath = join(output, 'visual-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ status: manifest.status, manifestPath, captures: captures.map(({ id, path, sha256 }) => ({ id, path, sha256 })) }, null, 2));
} finally {
  await closeBrowser(browser);
  await closeStudioServer(server);
}
