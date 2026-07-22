import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { applyCadTransaction } from '../static/studio-agent-service.js';
import { buildCanonicalTurbofan, TURBOFAN_IDS } from './studio-v5-release-fixtures.ts';
import {
  closeBrowser, closeStudioServer, ensureEvidenceDirectory, openProjectThroughPublicControl,
  prepareStudioPage, sha256Json, startStudioServer,
} from './studio-v5-evidence-support.ts';

type Result = { name: string; pass: boolean; detail?: unknown };
const results: Result[] = [];
function check(name: string, pass: boolean, detail?: unknown): void {
  results.push({ name, pass, ...(detail == null ? {} : { detail }) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${!pass && detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
}

async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__bwStudio?.mode().kind === 'idle', { timeout: 120_000, polling: 50 });
}

async function clickElement(page: Page, selector: string): Promise<void> {
  await page.evaluate((value) => {
    const element = document.querySelector(value) as HTMLElement | null;
    if (!element) throw new Error(`Accessibility control is missing: ${value}`);
    element.focus(); element.click();
  }, selector);
}

let browser: Browser | null = null;
let server: Awaited<ReturnType<typeof startStudioServer>>['server'] | null = null;
const pageErrors: string[] = [];
const dialogs: string[] = [];
try {
  const started = await startStudioServer(); server = started.server;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await prepareStudioPage(page, started.url, { width: 1600, height: 1000 });
  const construction = buildCanonicalTurbofan();
  const project = construction.project;
  await openProjectThroughPublicControl(page, project, 159, 'turbofan-accessibility');

  const semantics = await page.evaluate(() => {
    const trees = [...document.querySelectorAll('[role="tree"]')];
    const items = [...document.querySelectorAll('[role="treeitem"]')];
    const direct = document.querySelector(`[data-occurrence-id="${(window as any).__bwStudio.occurrenceIds()[1]}"]`);
    const controls = [...document.querySelectorAll('[role="tree"] button, [role="tree"] input')].filter((entry) => !(entry as HTMLButtonElement).disabled && (entry as HTMLElement).offsetParent !== null);
    return {
      trees: trees.length, items: items.length, levels: new Set(items.map((entry) => entry.getAttribute('aria-level'))).size,
      direct: direct ? { selected: direct.getAttribute('aria-selected'), expanded: direct.getAttribute('aria-expanded'), count: direct.getAttribute('aria-setsize'), label: direct.getAttribute('aria-label') } : null,
      unreachable: controls.filter((entry) => (entry as HTMLElement).tabIndex < 0).length,
      unnamed: controls.filter((entry) => !((entry.getAttribute('aria-label') || entry.getAttribute('title') || entry.textContent || '').trim())).length,
    };
  });
  check('V5 model trees expose hierarchy, state, occurrence counts, and keyboard-reachable named controls',
    semantics.trees >= 7 && semantics.items >= 150 && semantics.levels >= 2 && semantics.direct?.expanded === 'true' && Number(semantics.direct?.count) >= 1 &&
    Boolean(semantics.direct?.label?.includes('visible')) && semantics.unreachable === 0 && semantics.unnamed === 0, semantics);

  await page.keyboard.press('F6');
  const filter = await page.evaluate(() => ({ filter: (window as any).__bwStudio.selectionFilter(), announcement: document.querySelector('#bw-studio-msg')?.textContent }));
  check('F6 cycles a textual selection filter and announces it', filter.filter === 'component' && Boolean(filter.announcement?.includes('Selection filter: Components')), filter);

  await clickElement(page, `[data-occurrence-id="${TURBOFAN_IDS.hpcOccurrence}"] [data-occurrence-action="select"]`);
  const selected = await page.$eval(`[data-occurrence-id="${TURBOFAN_IDS.hpcOccurrence}"]`, (entry) => ({ selected: entry.getAttribute('aria-selected'), label: entry.getAttribute('aria-label') }));
  const beforeIsolation = await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds().length);
  await page.keyboard.press('i');
  const isolated = await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds().length);
  await page.keyboard.down('Shift'); await page.keyboard.press('h'); await page.keyboard.up('Shift');
  const restored = await page.evaluate(() => (window as any).__bwStudio.visibleBodyIds().length);
  check('tree selection announces component identity and I/Shift+H isolate then restore without pointer input',
    selected.selected === 'true' && Boolean(selected.label?.includes('visible')) && isolated < beforeIsolation && restored === beforeIsolation,
    { selected, beforeIsolation, isolated, restored });

  await page.keyboard.press('h'); await waitForIdle(page);
  const hidden = await page.evaluate((id) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    const assembly = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId);
    return assembly.occurrences.find((entry: any) => entry.id === id)?.visible;
  }, TURBOFAN_IDS.hpcOccurrence);
  await page.keyboard.down('Shift'); await page.keyboard.press('h'); await page.keyboard.up('Shift'); await waitForIdle(page);
  const shown = await page.evaluate((id) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    const assembly = project.assemblyDefinitions.find((entry: any) => entry.id === project.rootDocument.assemblyId);
    return assembly.occurrences.find((entry: any) => entry.id === id)?.visible;
  }, TURBOFAN_IDS.hpcOccurrence);
  check('H and Shift+H persistently hide and restore selected component visibility', hidden === false && shown === true, { hidden, shown });

  const sectionBefore = await page.evaluate(() => (window as any).__bwStudio.activeSectionViewId());
  await page.keyboard.down('Shift'); await page.keyboard.press('s'); await page.keyboard.up('Shift'); await waitForIdle(page);
  const sectionAfter = await page.evaluate(() => (window as any).__bwStudio.activeSectionViewId());
  check('Shift+S toggles the saved section through the keyboard', Boolean(sectionBefore) !== Boolean(sectionAfter), { sectionBefore, sectionAfter });

  await page.keyboard.down('Shift'); await page.keyboard.press('m'); await page.keyboard.up('Shift');
  await page.waitForSelector('#bw-v5-command[open]');
  const measureForm = await page.$eval('#bw-v5-command', (dialog) => ({ title: dialog.querySelector('#bw-v5-command-title')?.textContent, labels: dialog.querySelectorAll('label').length, inputs: dialog.querySelectorAll('input,select,textarea').length }));
  check('Shift+M opens a labeled exact measurement form', measureForm.title === 'Save measurement' && measureForm.labels >= 2 && measureForm.inputs >= 2, measureForm);
  await clickElement(page, '#bw-v5-command-cancel');

  const activatedPartProject = applyCadTransaction(project, {
    transactionId: 'accessibility-part-context', label: 'Activate public editable fan-blade part', atomic: true,
    operations: [{ kind: 'document.activate', input: { definition: { kind: 'part', partId: 'part-fan-blade' } } }],
  }).project;
  // A distinct id makes the public file-open readiness check wait for this
  // derived active-document state instead of accepting the still-idle source
  // assembly, which intentionally shares all definitions.
  const partProject = { ...activatedPartProject, projectId: `${project.projectId}-fan-blade-context` };
  await openProjectThroughPublicControl(page, partProject, 1, 'fan-blade-accessibility');
  await clickElement(page, '#bw-bodies .body-select');
  await page.keyboard.press('m'); await page.waitForSelector('#bw-v5-command[open]');
  const transformForm = await page.$eval('#bw-v5-command', (dialog) => ({ title: dialog.querySelector('#bw-v5-command-title')?.textContent, numericLabels: [...dialog.querySelectorAll('label')].map((entry) => entry.textContent?.trim()) }));
  check('M opens keyboard-editable transform values with labels and snap control', transformForm.title === 'Move body' && transformForm.numericLabels.some((label) => label?.includes('ΔX')) && transformForm.numericLabels.some((label) => label?.includes('Handle snap')), transformForm);
  await clickElement(page, '#bw-v5-command-cancel');

  await clickElement(page, '#bw-history .hi-sel');
  await page.keyboard.press('e'); await page.waitForSelector('#bw-v5-command[open]');
  const editTitle = await page.$eval('#bw-v5-command-title', (entry) => entry.textContent);
  check('E opens the selected advanced feature editor', Boolean(editTitle?.includes('Edit')), editTitle);
  await clickElement(page, '#bw-v5-command-cancel');
  const featureId = await page.$eval('#bw-history .hist-item', (entry) => (entry as HTMLElement).dataset.sel);
  await page.keyboard.down('Shift'); await page.keyboard.press('e'); await page.keyboard.up('Shift'); await waitForIdle(page);
  const suppressed = await page.evaluate((id) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return project.partDefinitions.find((entry: any) => entry.id === project.rootDocument.partId)?.features.find((entry: any) => entry.id === id)?.suppressed;
  }, featureId);
  await clickElement(page, '#bw-undo'); await waitForIdle(page);
  check('Shift+E suppresses the selected feature transactionally and Undo restores it', suppressed === true && await page.evaluate((id) => {
    const project = JSON.parse((window as any).__bwStudio.docJson());
    return !project.partDefinitions.find((entry: any) => entry.id === project.rootDocument.partId)?.features.find((entry: any) => entry.id === id)?.suppressed;
  }, featureId));

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reducedMotion = await page.evaluate(() => {
    const samples = [...document.querySelectorAll('.cadstudio-app *')].slice(0, 250);
    return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, animated: samples.filter((entry) => {
      const style = getComputedStyle(entry as Element); return style.transitionDuration !== '0s' || style.animationDuration !== '0s';
    }).length };
  });
  check('reduced-motion preference removes Studio transition and animation durations', reducedMotion.matches && reducedMotion.animated === 0, reducedMotion);

  const contrast = await page.evaluate(() => {
    const parse = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => {
      const values = rgb.map((entry) => { const c = entry / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const opaqueBackground = (entry: Element) => {
      let current: Element | null = entry;
      while (current) { const value = getComputedStyle(current).backgroundColor; if (!value.endsWith(', 0)') && value !== 'transparent') return value; current = current.parentElement; }
      return 'rgb(255,255,255)';
    };
    const selectors = ['.ws-workspaces button[aria-selected="true"]', '.wsr-btn:not([disabled])', '#bw-mode', '#bw-status', '#bw-bodies .body-select'];
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter((entry) => (entry as HTMLElement).offsetParent !== null).slice(0, 4).map((entry) => {
      const fg = luminance(parse(getComputedStyle(entry).color)); const bg = luminance(parse(opaqueBackground(entry)));
      return { selector, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
    }));
  });
  check('essential visible Studio text and controls meet WCAG AA contrast', contrast.length >= 5 && contrast.every((entry: any) => entry.ratio >= 4.5), contrast);
  await context.close();

  const mobileContext = await browser.createBrowserContext();
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (error) => pageErrors.push(String(error)));
  mobile.on('dialog', async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await prepareStudioPage(mobile, started.url, { width: 390, height: 844 });
  await openProjectThroughPublicControl(mobile, project, 159, 'turbofan-mobile-accessibility');
  await clickElement(mobile, '#bw-mtab-history');
  const mobileState = await mobile.evaluate(() => {
    const app = document.querySelector('.cadstudio-app') as HTMLElement;
    const inspection = document.querySelector('#bw-assembly-inspection') as HTMLElement;
    const tabs = [...document.querySelectorAll('.ws-mtabs button')];
    const treeButtons = [...document.querySelectorAll('#bw-assembly-inspection button')].filter((entry) => (entry as HTMLElement).offsetParent !== null);
    return {
      width: document.documentElement.scrollWidth, viewport: innerWidth,
      modelOpen: app.classList.contains('m-open-history'), inspectionVisible: inspection.offsetParent !== null,
      tabHeights: tabs.map((entry) => entry.getBoundingClientRect().height),
      treeTargets: treeButtons.map((entry) => entry.getBoundingClientRect().height),
    };
  });
  check('390px mobile inspection has no horizontal overflow and exposes touch-sized model/view controls',
    mobileState.width <= mobileState.viewport + 1 && mobileState.modelOpen && mobileState.inspectionVisible &&
    mobileState.tabHeights.every((height) => height >= 44) && mobileState.treeTargets.length >= 3 && mobileState.treeTargets.every((height) => height >= 44), mobileState);
  await clickElement(mobile, '#bw-mtab-params');
  await mobile.waitForFunction(() => document.querySelector('.cadstudio-app')?.classList.contains('m-open-params'));
  const mobileNumeric = await mobile.$eval('.wsp-params', (entry) => ({
    visible: entry.getBoundingClientRect().width > 0 && entry.getBoundingClientRect().height > 0, inputs: entry.querySelectorAll('input').length,
    display: getComputedStyle(entry).display, appClass: document.querySelector('.cadstudio-app')?.className,
  }));
  check('mobile retains a visible numeric alternative for parameter edits', mobileNumeric.visible && mobileNumeric.inputs >= 5, mobileNumeric);
  await mobileContext.close();

  check('accessibility scenario produced no native dialogs or page errors', dialogs.length === 0 && pageErrors.length === 0, { dialogs, pageErrors });
  const failures = results.filter((entry) => !entry.pass);
  const output = ensureEvidenceDirectory('accessibility');
  const manifest = {
    gate: 'v5-accessibility', status: failures.length ? 'failed' : 'pass', projectId: project.projectId,
    projectHash: sha256Json(project), browser: await browser.version(), viewportEvidence: [[1600, 1000], [390, 844]],
    checks: results, dialogs, pageErrors,
  };
  const path = join(output, 'accessibility-manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${results.length - failures.length}/${results.length} accessibility checks passed`);
  console.log(path);
  if (failures.length) process.exitCode = 1;
} finally {
  await closeBrowser(browser);
  await closeStudioServer(server);
}
