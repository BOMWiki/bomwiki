// Browser-level checks for the CAD Studio (Slice A contract): transactional
// drafts, undo/redo, document restoration, keyboard focus rules. Runs the
// REAL page markup (rendered through cadStudioPage) and the real static JS
// against headless Chrome — no database needed, so CI can run it.
//
//   npm run studio:check
//
// Exits non-zero on any failure. Requires the puppeteer devDependency.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer';
import { cadStudioPage } from '../src/render/models.ts';
// @ts-expect-error Browser-native module intentionally has no Node typings.
import { PROJECT_LIMITS, parseStudioProject, prepareStudioDocument } from '../static/studio-document.js';
// @ts-expect-error Browser-native module intentionally has no Node typings.
import { STUDIO_TEMPLATES, STUDIO_TEMPLATE_CATEGORIES } from '../static/studio-templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Serve the rendered studio page plus /static — nothing else.
const html = cadStudioPage();
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path.startsWith('/api/')) {
    // The page chrome probes /api/session for signed-in state; answer with
    // an empty JSON object like the real engine does for anonymous users.
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
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const URL_ = `http://127.0.0.1:${port}/cad/studio`;

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: string): void {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// --- document boundary: detached validation and migration input -----------
const legacyFixture = {
  features: [
    { id: 'legacy-extrude', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 20, h: 10 }], z: 0 }, h: 5 },
  ],
  params: [],
  extension: { preserved: true },
};
const preparedFixture = prepareStudioDocument(legacyFixture);
check('unversioned V3 fixture is formalized as schema 3', preparedFixture.schemaVersion === 3);
check('document preparation never mutates its input', !('schemaVersion' in legacyFixture));
check('unknown document fields survive preparation', preparedFixture.extension.preserved === true);
let rejectedNewer = false;
try {
  prepareStudioDocument({ schemaVersion: 99, features: [], params: [] });
} catch (error) {
  rejectedNewer = (error as { code?: string }).code === 'NEWER_SCHEMA';
}
check('newer schema is refused explicitly', rejectedNewer);
let rejectedLimit = false;
try {
  prepareStudioDocument({ features: Array.from({ length: PROJECT_LIMITS.features + 1 }, () => ({})), params: [] });
} catch (error) {
  rejectedLimit = (error as { code?: string }).code === 'LIMIT_FEATURES';
}
check('feature resource limit is enforced before traversal', rejectedLimit);
let rejectedBytes = false;
try {
  parseStudioProject(' '.repeat(PROJECT_LIMITS.bytes + 1));
} catch (error) {
  rejectedBytes = (error as { code?: string }).code === 'LIMIT_BYTES';
}
check('project byte limit is enforced before JSON parsing', rejectedBytes);
for (const [name, candidate, code] of [
  ['string parameter values are refused', { features: [], params: [{ name: 'a', value: '2+2' }] }, 'INVALID_PARAMETER'],
  [
    'polygon expression coordinates are refused',
    { features: [{ id: 'p', type: 'extrude', sketch: { shapes: [{ kind: 'poly', pts: [['a', 0], [1, 0], [0, 1]] }], z: 0 }, h: 5 }], params: [{ name: 'a', value: 2 }] },
    'INVALID_POINT',
  ],
  ['incomplete edge signatures are refused', { features: [{ id: 'f', type: 'fillet', edges: [{}], r: 1 }], params: [] }, 'INVALID_REFERENCE'],
  ['empty feature sketches are refused', { features: [{ id: 'e', type: 'extrude', sketch: { shapes: [] }, h: 5 }], params: [] }, 'INVALID_SKETCH'],
  ['fractional imported patterns are refused', { features: [{ id: 'p', type: 'extrude', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 2 }] }, h: 5, pattern: { kind: 'linear', n: 2.5, dx: 5, dy: 0 } }], params: [] }, 'INVALID_PATTERN'],
  ['string cut flags are refused', { features: [{ id: 'c', type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 2 }] }, h: 5, through: 'false' }], params: [] }, 'INVALID_FEATURE'],
  ['unknown explicit old schemas are refused', { schemaVersion: 1, features: [], params: [] }, 'UNSUPPORTED_SCHEMA'],
] as const) {
  let rejected = false;
  try {
    prepareStudioDocument(candidate);
  } catch (error) {
    rejected = (error as { code?: string }).code === code;
  }
  check(name, rejected);
}
const validExpressionFixture = prepareStudioDocument({
  features: [{ id: 'expression', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 'size*2', h: 'size+1' }] }, h: 'size/2' }],
  params: [{ name: 'size', value: 10 }],
});
check('supported dimension expressions remain valid', validExpressionFixture.features[0].h === 'size/2');
check('template cabinet contains 28 editable starter parts', STUDIO_TEMPLATES.length === 28);
check('template cabinet spans five practical categories', STUDIO_TEMPLATE_CATEGORIES.length === 5);
check('template IDs are stable and unique', new Set(STUDIO_TEMPLATES.map((template: { id: string }) => template.id)).size === STUDIO_TEMPLATES.length);
let allTemplatesValid = true;
for (const template of STUDIO_TEMPLATES) {
  try {
    prepareStudioDocument(template.document);
  } catch (error) {
    allTemplatesValid = false;
    console.error('invalid template', template.id, error);
  }
}
check('every template passes the production project-file boundary', allTemplatesValid);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const newStudioPage = async (showWelcome = false): Promise<Page> => {
  // Each scenario gets a real isolated browser profile. CAD Studio V4 keeps
  // its command journal in IndexedDB, so clearing only localStorage is no
  // longer sufficient isolation and would hide cross-project persistence bugs.
  const context = await browser.createBrowserContext();
  const next = await context.newPage();
  if (!showWelcome) {
    await next.evaluateOnNewDocument(() => localStorage.setItem('bw-studio-welcome-v1', '1'));
  }
  // Chrome 150 can stall Puppeteer's scroll-into-view handshake for controls
  // inside a 100dvh flex/WebGL shell even when elementFromPoint proves the
  // target is visible. Send the same real pointer click at the rendered
  // centre; interception checks still behave exactly like a user's tap.
  Object.defineProperty(next, 'click', {
    configurable: true,
    value: async (selector: string, options: { count?: number; delay?: number } = {}) => {
      // V3 tools are contextual. Exercise the same path as a person: expose
      // the tool's workspace first, then send the real pointer click to the
      // rendered command. Sketch tools are auto-exposed by sketch mode.
      const workspace = await next.$eval(selector, (el) =>
        (el.closest('[data-workspace-panel]') as HTMLElement | null)?.dataset.workspacePanel ?? null,
      );
      if (workspace && !(await next.$eval(selector, (el) => Boolean(el.getClientRects().length)))) {
        await next.$eval(`[data-workspace="${workspace}"]`, (tab) => (tab as HTMLButtonElement).click());
      }
      const point = await next.$eval(selector, (el) => {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) throw new Error(`click target has no rendered area: ${el.tagName}`);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await next.mouse.click(point.x, point.y, { count: options.count ?? 1, delay: options.delay });
    },
  });
  return next;
};
const waitForStudioPage = async (target: Page, options: { solid?: boolean; idle?: boolean; timeout?: number } = {}): Promise<void> => {
  const deadline = Date.now() + (options.timeout ?? 60_000);
  let ready = false;
  while (!ready && Date.now() < deadline) {
    ready = await target.evaluate(
      ({ solid, idle }) => {
        const studio = (window as unknown as {
          __bwStudio?: { triCount(): number; mode(): { kind: string } };
        }).__bwStudio;
        return Boolean(studio && (!solid || studio.triCount() > 0) && (!idle || studio.mode().kind === 'idle'));
      },
      options,
    );
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error('CAD app did not reach the requested ready state');
};

const page: Page = await newStudioPage();
page.on('pageerror', (e) => check('no page errors', false, String(e)));

const S = async <T>(fn: string): Promise<T> =>
  page.evaluate(`(() => { const s = window.__bwStudio; return (${fn})(s); })()`) as Promise<T>;
const waitReady = async () => {
  let ready = false;
  for (let i = 0; i < 180 && !ready; i++) {
    ready = await page.evaluate(() => {
      const studio = (window as unknown as { __bwStudio?: { triCount(): number } }).__bwStudio;
      return Boolean(studio && document.querySelectorAll('.hist-item').length >= 0 && studio.triCount() > 0);
    });
    if (!ready) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error('starter part did not finish rebuilding');
};

// --- boot: starter part seeds and builds ----------------------------------
await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitReady();
check('starter part seeds two features', (await page.$$('.hist-item')).length === 2);
check('starter part builds without errors', ((await S<string[]>('(s) => s.errors()')) as string[]).length === 0);
check('boot leaves undo empty', (await S<number>('(s) => s.undoDepth()')) === 0);
check('successful journal boot reports Saved locally', await page.$eval('#bw-storage-state', (el) => /Saved locally/.test(el.textContent || '')));
const templateGeometry = await page.evaluate(async () => {
  // @ts-expect-error This import resolves inside the served browser page.
  const { STUDIO_TEMPLATES } = await import('/static/studio-templates.js');
  const worker = new Worker('/static/studio-kernel.worker.js', { type: 'module' });
  const failures: string[] = [];
  let revision = 0;
  for (const template of STUDIO_TEMPLATES) {
    revision++;
    const response = await new Promise<any>((resolve, reject) => {
      const requestId = 'template-' + revision;
      const timeout = setTimeout(() => reject(new Error(template.id + ' timed out in the CAD kernel')), 60_000);
      const onMessage = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        if (event.data.kind === 'kernel-error') reject(new Error(event.data.message || template.id + ' kernel error'));
        else resolve(event.data);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        kind: 'rebuild',
        requestId,
        projectId: 'template-geometry-gate',
        revision,
        document: template.document,
      });
    });
    if (response.errors?.length || !response.mesh?.vertices?.byteLength) {
      failures.push(template.id + ': ' + (response.errors?.map((error: { message: string }) => error.message).join('; ') || 'empty solid'));
    }
  }
  worker.terminate();
  return { count: STUDIO_TEMPLATES.length, failures };
});
check('all 28 templates rebuild through OpenCascade', templateGeometry.count === 28);
check('every template produces a nonempty solid with zero feature errors', templateGeometry.failures.length === 0, templateGeometry.failures.join(' | '));
const stepExport = await S<{ size: number; errors: unknown[] }>('async (s) => s.exportForTest("step")');
const stlExport = await S<{ size: number; errors: unknown[] }>('async (s) => s.exportForTest("stl")');
check('worker STEP export returns a non-empty clean blob', stepExport.size > 100 && stepExport.errors.length === 0, `size ${stepExport.size}`);
check('worker STL export returns a non-empty clean blob', stlExport.size > 100 && stlExport.errors.length === 0, `size ${stlExport.size}`);

// --- ribbon icon system: complete, semantic, and state-stable ------------
const iconAudit = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ws-ribbon .wsr-btn'));
  const icons = buttons.map((button) => button.querySelector<SVGElement>(':scope > .wsr-i > svg.ws-icon'));
  const appIcons = Array.from(document.querySelectorAll<SVGElement>('.ws-app-actions svg.ws-icon'));
  const iconNames = [...icons, ...appIcons].map((icon) => icon?.dataset.icon ?? '');
  const views = Array.from(document.querySelectorAll<SVGElement>('[data-view] svg.ws-icon')).map(
    (icon) => icon.dataset.icon,
  );
  const canonicalIcons = Array.from(document.querySelectorAll<SVGElement>('[data-feat] svg.ws-icon, [data-sktool] svg.ws-icon, [data-view] svg.ws-icon'))
    .map((icon) => icon.dataset.icon ?? '');
  const extrudeIcon = document.querySelector('[data-feat="extrude"] .wsr-i')!;
  return {
    buttonCount: buttons.length,
    complete: icons.every(Boolean),
    noGlyphFallbacks: buttons.every((button) => button.querySelector('.wsr-i')?.textContent === ''),
    named: iconNames.every(Boolean),
    canonicalUnique: new Set(canonicalIcons).size === canonicalIcons.length,
    views,
    step: document.querySelector<SVGElement>('#bw-export-step svg')?.dataset.icon,
    stl: document.querySelector<SVGElement>('#bw-export-stl svg')?.dataset.icon,
    appComplete: appIcons.length === 11 && appIcons.every((icon) => icon.closest('[aria-hidden="true"]') && icon.getAttribute('focusable') === 'false'),
    pressedDecoration: getComputedStyle(extrudeIcon, '::after').content,
  };
});
check('every contextual ribbon command has one inline SVG icon', iconAudit.buttonCount >= 35 && iconAudit.complete, JSON.stringify(iconAudit));
check('ribbon has no operating-system glyph fallbacks', iconAudit.noGlyphFallbacks);
check('canonical ribbon commands retain unique semantic identities', iconAudit.named && iconAudit.canonicalUnique);
check('all five View commands have orientation icons', iconAudit.views.join(',') === 'top,front,right,iso,fit', iconAudit.views.join(','));
check('STEP solid and STL mesh exports have distinct icons', iconAudit.step === 'step' && iconAudit.stl === 'stl');
check('all document, export, Help and Full screen controls use hidden SVG icons', iconAudit.appComplete);
check('pressed tools do not gain a fake dropdown marker', iconAudit.pressedDecoration === 'none', iconAudit.pressedDecoration);

// --- transactional drafts: edit + cancel is byte-identical ---------------
const docBefore = await S<string>('(s) => s.docJson()');
const trisBefore = await S<number>('(s) => s.triCount()');
await page.click('.hist-item [data-edit]'); // edit feature 1 (extrude)
await page.waitForSelector('#bw-sketch:not([hidden])');
// mutate several fields in the open editor
await page.evaluate(() => {
  const h = document.getElementById('bw-sk-op-h') as HTMLInputElement;
  h.value = '99';
  const canvas = document.getElementById('bw-sketch-canvas')!;
  const r = canvas.getBoundingClientRect();
  const ev = (t: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
  ev('pointerup', r.left + 50, r.top + 50);
  ev('pointermove', r.left + 90, r.top + 90);
  ev('pointerup', r.left + 90, r.top + 90); // adds a rect to the DRAFT
});
await page.click('#bw-sk-cancel');
check('cancel: document byte-identical', (await S<string>('(s) => s.docJson()')) === docBefore);
check('cancel: solid unchanged', (await S<number>('(s) => s.triCount()')) === trisBefore);
check('cancel: no undo entry', (await S<number>('(s) => s.undoDepth()')) === 0);

// --- P1 regression: dims-panel edits stay in the draft --------------------
await page.click('.hist-item [data-edit]');
await page.waitForSelector('#bw-sketch:not([hidden])');
await page.evaluate(() => {
  // The last shape is auto-selected; type an exact width via the panel.
  const w = document.querySelector('[data-dim="w"]') as HTMLInputElement;
  w.value = '77';
  w.dispatchEvent(new Event('change'));
});
await page.click('#bw-sk-cancel');
check('dims-panel edit + cancel: document byte-identical', (await S<string>('(s) => s.docJson()')) === docBefore);
check('dims-panel edit + cancel: no undo entry', (await S<number>('(s) => s.undoDepth()')) === 0);

// --- P1 regression: delete-shape works on the draft's own selection -------
await page.click('.hist-item [data-edit]');
await page.waitForSelector('#bw-sketch:not([hidden])');
const shapeDeleted = await page.evaluate(() => {
  (document.getElementById('bw-sk-delshape') as HTMLButtonElement)?.click();
  return document.getElementById('bw-sk-dims')!.textContent!.includes('Nothing selected');
});
check('delete shape acts on the draft selection', shapeDeleted);
await page.click('#bw-sk-cancel');
check('delete shape + cancel: document byte-identical', (await S<string>('(s) => s.docJson()')) === docBefore);

// --- one commit per apply -------------------------------------------------
await page.click('.hist-item [data-edit]');
await page.waitForSelector('#bw-sketch:not([hidden])');
await page.evaluate(() => {
  (document.getElementById('bw-sk-op-h') as HTMLInputElement).value = '9';
});
await page.click('#bw-sk-apply');
await page.waitForFunction(`document.getElementById('bw-sketch').hidden`);
await new Promise((r) => setTimeout(r, 1500)); // rebuild
check('apply: exactly one undo entry', (await S<number>('(s) => s.undoDepth()')) === 1);
check('apply: height changed in doc', (await S<string>('(s) => s.docJson()')).includes('"h":9'));

// --- undo / redo ----------------------------------------------------------
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 1200));
check('undo restores the document', (await S<string>('(s) => s.docJson()')) === docBefore);
check('undo moves entry to redo', (await S<number>('(s) => s.redoDepth()')) === 1);
await page.keyboard.down('Control');
await page.keyboard.press('y');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 1200));
check('redo re-applies', (await S<string>('(s) => s.docJson()')).includes('"h":9'));

// --- new commit clears redo ----------------------------------------------
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 1200));
await page.click('#bw-param-add');
await new Promise((r) => setTimeout(r, 800));
check('new commit clears redo', (await S<number>('(s) => s.redoDepth()')) === 0);

// --- shortcuts suppressed while a field is focused ------------------------
const depth = await S<number>('(s) => s.undoDepth()');
await page.focus('[data-pval="0"]');
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 300));
check('ctrl+z ignored in input field', (await S<number>('(s) => s.undoDepth()')) === depth);

// --- param change commits + undoes ---------------------------------------
await page.evaluate(() => {
  const inp = document.querySelector('[data-pval="0"]') as HTMLInputElement;
  inp.value = '55';
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1500));
check('param change commits', ((await S<string[]>('(s) => s.undoLabels()')) as string[]).some((l) => /Set /.test(l)));

// --- invalid project open leaves doc AND undo history unchanged -----------
const beforeBad = await S<string>('(s) => s.docJson()');
const openBad = (payload: string) =>
  page.evaluate((json: string) => {
    const dt = new DataTransfer();
    dt.items.add(new File([json], 'bad.json', { type: 'application/json' }));
    const inp = document.getElementById('bw-open-file') as HTMLInputElement;
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, payload);
for (const payload of [
  '{"nope": true}',
  '{"features":[null]}',
  '{"schemaVersion":99,"features":[],"params":[]}',
  'not json at all',
]) {
  const undoBefore = await S<number>('(s) => s.undoDepth()');
  const redoBefore = await S<number>('(s) => s.redoDepth()');
  await openBad(payload);
  await new Promise((r) => setTimeout(r, 600));
  check(`malformed project ${JSON.stringify(payload).slice(0, 24)}…: doc unchanged`, (await S<string>('(s) => s.docJson()')) === beforeBad);
  check('  …and undo/redo stacks untouched', (await S<number>('(s) => s.undoDepth()')) === undoBefore && (await S<number>('(s) => s.redoDepth()')) === redoBefore);
}

// --- clear -> reload stays empty ------------------------------------------
await page.click('#bw-clear');
check('Clear requires an explicit in-app destructive action', await page.$eval('#bw-clear-decision', (el) => (el as HTMLDialogElement).open));
await page.click('#bw-clear-confirm');
await new Promise((r) => setTimeout(r, 1200));
check('clear empties the document', (await S<string>('(s) => s.docJson()')).includes('"features":[]'));
const projectBeforeReload = await S<string>('(s) => s.projectId()');
const undoBeforeReload = await S<number>('(s) => s.undoDepth()');
await S<null>('async (s) => { await s.flushStorage(); return null; }');
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForStudioPage(page, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));
check('reload after clear stays empty (no starter resurrection)', (await S<string>('(s) => s.docJson()')).includes('"features":[]'));
check('reload restores the active project identity', (await S<string>('(s) => s.projectId()')) === projectBeforeReload);
check('reload restores the undo cursor', (await S<number>('(s) => s.undoDepth()')) === undoBeforeReload);
const compactJournal = await S<Record<string, unknown>>('async (s) => s.journalState()');
check('journal persists compact commands with a cursor', Boolean(compactJournal.history) && !('undoStack' in compactJournal) && !('redoStack' in compactJournal));
const recovery = await S<Array<{ label: string }>>('async (s) => s.recovery()');
check('committed states appear in local recovery', recovery.some((entry) => entry.label === 'Clear part'));
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await waitForStudioPage(page, { solid: true, idle: true, timeout: 30_000 });
check('undo remains functional after reload', (await page.$$('.hist-item')).length > 0);
await page.click('#bw-recover-open');
await page.waitForSelector('#bw-recover[open]');
check('Project > Recover lists committed local states', (await page.$$('#bw-recovery-list [data-recover]')).length > 0);
check('recovery groups identify the active project', (await page.$$('#bw-recovery-list .ws-recovery-project h3 span')).length === 1);
await page.click('#bw-recovery-list [data-recover]');
await waitForStudioPage(page, { idle: true, timeout: 30_000 });
check('restoring an active-project snapshot is one undoable command', ((await S<string[]>('(s) => s.undoLabels()')) as string[]).at(-1) === 'Restore recovered state');
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await waitForStudioPage(page, { solid: true, idle: true, timeout: 30_000 });
check('recovery restore can be undone', (await page.$$('.hist-item')).length > 0);

// --- cross-project recovery keeps the target project's command journal ----
const pageR = await newStudioPage();
await pageR.evaluateOnNewDocument(() => {
  localStorage.setItem('bw-studio-v2-seeded', '1');
  localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
    title: 'Recovery A',
    features: [{ id: 'ra', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 20, h: 20 }] }, h: 5, through: false }],
    params: [],
  }));
});
await pageR.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageR, { solid: true, idle: true });
const SR = async <T>(fn: string): Promise<T> => pageR.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
await pageR.click('#bw-param-add');
await SR<null>('async (s) => { await s.flushStorage(); return null; }');
const recoveryProjectA = await SR<string>('(s) => s.projectId()');
await pageR.evaluate(() => {
  const project = {
    title: 'Recovery B',
    features: [{ id: 'rb', type: 'extrude', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 8 }] }, h: 4, through: false }],
    params: [],
  };
  const transfer = new DataTransfer();
  transfer.items.add(new File([JSON.stringify(project)], 'recovery-b.bomcad.json', { type: 'application/json' }));
  const input = document.getElementById('bw-open-file') as HTMLInputElement;
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await pageR.waitForFunction((projectA) => (window as any).__bwStudio?.projectId() !== projectA, {}, recoveryProjectA);
await pageR.click('#bw-param-add');
await SR<null>('async (s) => { await s.flushStorage(); return null; }');
const recoverySnapshotA = (await SR<Array<{ projectId: string; snapshotId: string }>>('async (s) => s.recovery()'))
  .find((snapshot) => snapshot.projectId === recoveryProjectA);
if (!recoverySnapshotA) throw new Error('Cross-project recovery fixture was not persisted.');
await pageR.click('#bw-recover-open');
await pageR.waitForSelector(`[data-recover="${recoverySnapshotA.snapshotId}"]`);
await pageR.click(`[data-recover="${recoverySnapshotA.snapshotId}"]`);
let recoveredProjectA = false;
for (let attempt = 0; attempt < 120 && !recoveredProjectA; attempt++) {
  recoveredProjectA = (await SR<string>('(s) => s.projectId()')) === recoveryProjectA;
  if (!recoveredProjectA) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!recoveredProjectA) throw new Error('Cross-project recovery did not switch to the target journal.');
check('cross-project recovery restores the target journal', (await SR<number>('(s) => s.undoDepth()')) === 2);
check('cross-project recovery is itself undoable', ((await SR<string[]>('(s) => s.undoLabels()')).at(-1)) === 'Restore recovered state');
await SR<null>('async (s) => { await s.flushStorage(); return null; }');
await pageR.reload({ waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageR, { solid: true, idle: true });
check('cross-project journal survives reload', (await SR<string>('(s) => s.projectId()')) === recoveryProjectA && (await SR<number>('(s) => s.undoDepth()')) === 2);
await pageR.close();

// --- PR-2: mode coordinator, views, context panel, keyboard ---------------
// Fresh page with the starter part.
const pageB = await newStudioPage();
await pageB.evaluateOnNewDocument(() => {
  localStorage.removeItem('bw-studio-doc-v2');
  localStorage.removeItem('bw-studio-v2-seeded');
});
await pageB.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageB, { solid: true });
const SB = async <T>(fn: string): Promise<T> => pageB.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;

// mode starts idle and label matches
check('mode starts idle', (await SB<string>('(s) => s.mode().kind')) === 'idle');

// exclusive ownership: opening a feature flow from a pick mode cancels it
await pageB.click('[data-feat="fillet"]');
check('fillet opens picking-edges', (await SB<string>('(s) => s.mode().kind')) === 'picking-edges');
await pageB.click('[data-feat="extrude"]');
const modeAfter = await SB<{ kind: string }>('(s) => s.mode()');
check('starting extrude cancels the pick mode (single owner)', modeAfter.kind === 'choose-face');
check('pick bar actually closed', await pageB.$eval('#bw-pick', (el) => (el as HTMLElement).hidden));

// escape steps back toward idle
await pageB.keyboard.press('Escape');
check('escape returns to idle', (await SB<string>('(s) => s.mode().kind')) === 'idle');

// sketching mode label + escape-cancel keeps doc identical
const docB = await SB<string>('(s) => s.docJson()');
await pageB.click('[data-feat="extrude"]');
await pageB.click('#bw-face-base');
const sketchModeB = await SB<{ kind: string }>('(s) => s.mode()');
check('sketch mode announced', sketchModeB.kind === 'sketching', JSON.stringify(sketchModeB));
const label = await pageB.$eval('#bw-mode', (el) => el.textContent || '');
check('mode label describes the sketch state', /Sketch/.test(label));
await pageB.keyboard.press('Escape');
check('escape cancels the sketch', (await SB<string>('(s) => s.mode().kind')) === 'idle');
check('escape-cancel left the document unchanged', (await SB<string>('(s) => s.docJson()')) === docB);

// view presets: camera direction within tolerance
const viewOk = async (name: string, expect: [number, number, number]) => {
  await pageB.click(`[data-view="${name}"]`);
  await new Promise((r) => setTimeout(r, 200));
  const v = await SB<[number, number, number]>('(s) => s.cameraDir()');
  const len = Math.hypot(...expect);
  const dot = (v[0] * expect[0] + v[1] * expect[1] + v[2] * expect[2]) / len;
  return dot > 0.99;
};
check('top view direction', await viewOk('top', [0, 1, 0]));
check('front view direction', await viewOk('front', [0, 0, 1]));
check('right view direction', await viewOk('right', [1, 0, 0]));
check('iso view direction', await viewOk('iso', [1, 0.8, 1]));

// context panel: select a fillet-less feature, check field parity
await pageB.evaluate(() => (document.querySelectorAll('.hist-item')[0] as HTMLElement).click());
check('selecting history opens the context panel', await pageB.$eval('#bw-context-wrap', (el) => !(el as HTMLElement).hidden));
check('extrude context exposes height field', Boolean(await pageB.$('#bw-context [data-cx="h"]')));
// context edit commits one undo entry
const depthB = await SB<number>('(s) => s.undoDepth()');
await pageB.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cx="h"]') as HTMLInputElement;
  inp.value = '7';
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1500));
check('context edit commits exactly one entry', (await SB<number>('(s) => s.undoDepth()')) === depthB + 1);
check('context edit applied', (await SB<string>('(s) => s.docJson()')).includes('"h":7'));

// delete key removes the selected feature
await pageB.evaluate(() => (document.querySelectorAll('.hist-item')[1] as HTMLElement).click());
const featCount = await pageB.$$eval('.hist-item', (els) => els.length);
await pageB.keyboard.press('Delete');
await new Promise((r) => setTimeout(r, 1200));
check('delete key removes the selected feature', (await pageB.$$eval('.hist-item', (els) => els.length)) === featCount - 1);

// 375px: context panel becomes a reachable bottom sheet
await pageB.setViewport({ width: 375, height: 700 });
await pageB.evaluate(() => (document.querySelectorAll('.hist-item')[0] as HTMLElement).click());
const sheet = await pageB.$eval('#bw-context-wrap', (el) => {
  const r = el.getBoundingClientRect();
  return { visible: !(el as HTMLElement).hidden, within: r.left >= 0 && r.right <= 376 && r.height > 40 };
});
check('375px: context panel is a visible bottom sheet', sheet.visible && sheet.within);
await pageB.close();

// --- PR #100 review set: workspace, coordinator guard, cleanup, a11y ------
const pageC = await newStudioPage();
pageC.on('pageerror', (e) => check('no page errors (workspace pass)', false, String(e)));
await pageC.evaluateOnNewDocument(() => {
  localStorage.removeItem('bw-studio-doc-v2');
  localStorage.removeItem('bw-studio-v2-seeded');
  // Any native confirmation is a regression: project decisions belong to
  // the branded in-app panels below.
  (window as unknown as { __confirmCalls: number }).__confirmCalls = 0;
  window.confirm = () => {
    (window as unknown as { __confirmCalls: number }).__confirmCalls++;
    return false;
  };
});
await pageC.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageC, { solid: true });
const SC = async <T>(fn: string): Promise<T> => pageC.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
const confirmCalls = () => pageC.evaluate(() => (window as unknown as { __confirmCalls: number }).__confirmCalls);

// (15) command strip mirrors the mode and its buttons work
await pageC.click('[data-feat="extrude"]');
const cmdText = await pageC.$eval('#bw-cmd-mode', (el) => el.textContent || '');
const modeText = await pageC.$eval('#bw-mode', (el) => el.textContent || '');
check('cmd strip mirrors the mode text', cmdText.length > 0 && cmdText === modeText);
await pageC.click('#bw-face-base');
check('cmd actions visible while sketching', await pageC.$eval('#bw-cmd-actions', (el) => !(el as HTMLElement).hidden));

// (13) ribbon sketch group + programmatic pressed states
check('ribbon sketch group appears while sketching', await pageC.$eval('#rib-sketch', (el) => !(el as HTMLElement).hidden));
await pageC.click('[data-sktool="circle"]');
const pressed = await pageC.evaluate(() => ({
  circle: document.querySelector('[data-sktool="circle"]')?.getAttribute('aria-pressed'),
  rect: document.querySelector('[data-sktool="rect"]')?.getAttribute('aria-pressed'),
}));
check('sketch tool aria-pressed follows selection', pressed.circle === 'true' && pressed.rect === 'false');
await pageC.click('#bw-cmd-cancel');
check('cmd Cancel returns to idle', (await SC<string>('(s) => s.mode().kind')) === 'idle');
check('ribbon sketch group hides again', await pageC.$eval('#rib-sketch', (el) => (el as HTMLElement).hidden));

// (2) clean draft: switching operations never prompts
const callsBefore = await confirmCalls();
await pageC.click('[data-feat="fillet"]');
check('fillet enters picking-edges', (await SC<string>('(s) => s.mode().kind')) === 'picking-edges');
await pageC.click('[data-feat="extrude"]');
check('clean pick -> extrude switches silently', (await confirmCalls()) === callsBefore && !(await pageC.$eval('#bw-draft-decision', (el) => (el as HTMLDialogElement).open)) && (await SC<string>('(s) => s.mode().kind')) === 'choose-face');
await pageC.keyboard.press('Escape');

// (1) history Edit during a pick mode: single owner, no stray commit
const undoC0 = await SC<number>('(s) => s.undoDepth()');
await pageC.click('[data-feat="fillet"]');
await pageC.evaluate(() => (document.querySelector('.hist-item [data-edit]') as HTMLElement).click());
check('history Edit during pick: pick bar closed', await pageC.$eval('#bw-pick', (el) => (el as HTMLElement).hidden));
check('history Edit during pick: sketch editor owns the mode', (await SC<string>('(s) => s.mode().kind')) === 'sketching');
check('history Edit during pick: no stray commit', (await SC<number>('(s) => s.undoDepth()')) === undoC0);

// (2b) dirty draft asks before being discarded; declining keeps it
await pageC.evaluate(() => {
  const canvas = document.getElementById('bw-sketch-canvas')!;
  const r = canvas.getBoundingClientRect();
  const ev = (t: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
  ev('pointerup', r.left + 40, r.top + 40);
  ev('pointermove', r.left + 80, r.top + 80);
  ev('pointerup', r.left + 80, r.top + 80); // dirty: a drawn rect in the draft
});
const callsBeforeDirty = await confirmCalls();
await pageC.click('[data-feat="fillet"]');
check('dirty draft: switching opens the in-app decision panel', await pageC.$eval('#bw-draft-decision', (el) => (el as HTMLDialogElement).open));
check('dirty draft: never invokes a browser confirmation', (await confirmCalls()) === callsBeforeDirty);
await pageC.click('#bw-draft-keep');
check('dirty draft: Keep editing preserves the sketch', (await SC<string>('(s) => s.mode().kind')) === 'sketching');
const undoBeforeApply = await SC<number>('(s) => s.undoDepth()');
await pageC.click('[data-feat="fillet"]');
await pageC.click('#bw-draft-apply');
check('dirty draft: Apply and continue commits then switches', (await SC<string>('(s) => s.mode().kind')) === 'picking-edges' && (await SC<number>('(s) => s.undoDepth()')) === undoBeforeApply + 1);
await pageC.keyboard.press('Escape');
await pageC.waitForFunction(() => {
  const studio = (window as any).__bwStudio;
  return studio.mode().kind === 'idle' && studio.appliedRevision() === studio.documentRevision();
});

// (11) per-type context properties: cut exposes through-all + shape stats
await pageC.evaluate(() => (document.querySelectorAll('.hist-item')[1] as HTMLElement).click());
check('cut context exposes through-all toggle', Boolean(await pageC.$('#bw-context [data-cxthrough]')));
check('cut context lists its shapes', await pageC.$eval('#bw-context', (el) => /Shapes:/.test(el.textContent || '')));
const undoC1 = await SC<number>('(s) => s.undoDepth()');
await pageC.evaluate(() => {
  const cb = document.querySelector('#bw-context [data-cxthrough]') as HTMLInputElement;
  cb.checked = false;
  cb.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1500));
check('through-all off commits once and reveals a depth field', (await SC<number>('(s) => s.undoDepth()')) === undoC1 + 1 && Boolean(await pageC.$('#bw-context [data-cx="h"]')));

// (6) Enter commits the focused numeric field (no editor Apply side effect)
const undoC2 = await SC<number>('(s) => s.undoDepth()');
await pageC.click('#bw-context [data-cx="h"]', { count: 3 }); // select-all
await pageC.keyboard.type('12');
await pageC.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 1500));
check('Enter commits the field', (await SC<number>('(s) => s.undoDepth()')) === undoC2 + 1 && (await SC<string>('(s) => s.docJson()')).includes('"h":12'));
check('Enter blurs the field', await pageC.evaluate(() => !(document.activeElement instanceof HTMLInputElement)));
check('Enter in a field stays idle (no Apply)', (await SC<string>('(s) => s.mode().kind')) === 'idle');

// (12) invalid expression: inline error, value kept, no commit
const undoC3 = await SC<number>('(s) => s.undoDepth()');
await pageC.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cx="h"]') as HTMLInputElement;
  inp.value = 'no_such_param';
  inp.dispatchEvent(new Event('change'));
});
const inline = await pageC.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cx="h"]') as HTMLInputElement;
  const err = inp.parentElement!.querySelector('.err-msg') as HTMLElement;
  return { marked: inp.classList.contains('field-err'), shown: !err.hidden && (err.textContent || '').length > 0, kept: inp.value === 'no_such_param' };
});
check('invalid expression: field marked inline', inline.marked && inline.shown);
check('invalid expression: typed value stays visible', inline.kept);
check('invalid expression: nothing committed', (await SC<number>('(s) => s.undoDepth()')) === undoC3);

// (3) deleting the selected feature leaves no ghost panel
await pageC.evaluate(() => {
  const li = document.querySelectorAll('.hist-item')[1] as HTMLElement;
  (li.querySelector('[data-del]') as HTMLElement).click();
});
await new Promise((r) => setTimeout(r, 1200));
check('delete selected: context panel hides', await pageC.$eval('#bw-context-wrap', (el) => (el as HTMLElement).hidden));
check('delete selected: no row still marked selected', (await pageC.$$('.hist-item.sel')).length === 0);

// (7) focus restoration: Escape from an editor returns focus to its opener
await pageC.evaluate(() => {
  const btn = document.querySelector('.hist-item [data-edit]') as HTMLElement;
  btn.focus();
  btn.click();
});
await pageC.waitForSelector('#bw-sketch:not([hidden])');
await pageC.keyboard.press('Escape');
check('focus returns to the opening control', await pageC.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.dataset.edit !== undefined));

// (4) Clear with an active selection: no ghost panel, empty doc
await pageC.evaluate(() => (document.querySelectorAll('.hist-item')[0] as HTMLElement).click());
await pageC.click('#bw-clear');
check('Clear uses the branded destructive decision panel', await pageC.$eval('#bw-clear-decision', (el) => (el as HTMLDialogElement).open));
await pageC.click('#bw-clear-confirm');
await new Promise((r) => setTimeout(r, 1200));
check('clear with selection empties the doc', (await SC<string>('(s) => s.docJson()')).includes('"features":[]'));
check('clear with selection hides the context panel', await pageC.$eval('#bw-context-wrap', (el) => (el as HTMLElement).hidden));
check('Clear never invokes a browser confirmation', (await confirmCalls()) === callsBeforeDirty);

// (14) build a fresh part; the Rebuilding state must be externally
// observable between Apply and the finished rebuild
await pageC.click('[data-feat="extrude"]'); // empty doc -> straight to sketch
await pageC.waitForSelector('#bw-sketch:not([hidden])');
await pageC.evaluate(() => {
  const canvas = document.getElementById('bw-sketch-canvas')!;
  const r = canvas.getBoundingClientRect();
  const ev = (t: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
  ev('pointerup', r.left + r.width / 2 - 30, r.top + r.height / 2 - 30);
  ev('pointermove', r.left + r.width / 2 + 30, r.top + r.height / 2 + 30);
  ev('pointerup', r.left + r.width / 2 + 30, r.top + r.height / 2 + 30);
});
const logBefore = ((await SC<string[]>('(s) => s.modeLog()')) as string[]).length;
await pageC.click('#bw-sk-apply');
await new Promise((r) => setTimeout(r, 500));
const logAfter = (await SC<string[]>('(s) => s.modeLog()')) as string[];
check('rebuild announces a visible Rebuilding mode', logAfter.slice(logBefore).includes('rebuilding'), logAfter.slice(logBefore).join('>'));
await waitForStudioPage(pageC, { solid: true, idle: true, timeout: 30_000 });
check('fresh part builds clean', ((await SC<string[]>('(s) => s.errors()')) as string[]).length === 0);

// (5) stale build-error cleanup: make the feature fail by deleting the
// parameter its height references, then delete the feature itself
await pageC.click('#bw-param-add'); // p1 = 10
await new Promise((r) => setTimeout(r, 1200));
await pageC.evaluate(() => (document.querySelectorAll('.hist-item')[0] as HTMLElement).click());
await pageC.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cx="h"]') as HTMLInputElement;
  inp.value = 'p1*2';
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1500));
check('parametric height builds clean', ((await SC<string[]>('(s) => s.errors()')) as string[]).length === 0);
await pageC.evaluate(() => (document.querySelector('[data-pdel="0"]') as HTMLElement).click());
await new Promise((r) => setTimeout(r, 1500));
check('deleting the referenced parameter fails the feature', ((await SC<string[]>('(s) => s.errors()')) as string[]).length === 1);
check('failure surfaces in the command strip', await pageC.$eval('#bw-cmd-err', (el) => (el.textContent || '').length > 0));
check('failing row is marked in history', (await pageC.$$('.hist-item.err')).length === 1);
await pageC.evaluate(() => (document.querySelector('.hist-item [data-del]') as HTMLElement).click());
await new Promise((r) => setTimeout(r, 1500));
check('deleting the failing feature clears its error', ((await SC<string[]>('(s) => s.errors()')) as string[]).length === 0);
check('command strip error clears with it', await pageC.$eval('#bw-cmd-err', (el) => (el.textContent || '').length === 0));

// (8+9) 375px: no horizontal page overflow, 44px touch targets
await pageC.setViewport({ width: 375, height: 700 });
await new Promise((r) => setTimeout(r, 400));
const overflow = await pageC.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  app: (document.querySelector('.cadstudio-app') as HTMLElement).getBoundingClientRect().width,
}));
check('375px: no horizontal overflow', overflow.doc <= 376 && overflow.app <= 376, `scrollWidth ${overflow.doc}, app ${overflow.app}`);
const targets = await pageC.evaluate(() =>
  [...document.querySelectorAll('.wsr-btn')]
    .map((b) => (b as HTMLElement).getBoundingClientRect())
    .filter((r) => r.width > 0) // skip buttons in hidden groups (sketch tools)
    .map((r) => Math.min(r.width, r.height)),
);
check('375px: contextual ribbon buttons are 44px touch targets', targets.length >= 3 && targets.every((t) => t >= 43.5), targets.join(','));
await pageC.close();

// --- re-review set: field dirty, Clear/Open coordination, ribbon state ----
const pageE = await newStudioPage();
pageE.on('pageerror', (e) => check('no page errors (re-review pass)', false, String(e)));
await pageE.evaluateOnNewDocument(() => {
  localStorage.removeItem('bw-studio-doc-v2');
  localStorage.removeItem('bw-studio-v2-seeded');
  (window as unknown as { __confirmCalls: number }).__confirmCalls = 0;
  window.confirm = () => {
    (window as unknown as { __confirmCalls: number }).__confirmCalls++;
    return false;
  };
});
await pageE.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageE, { solid: true });
const SE = async <T>(fn: string): Promise<T> => pageE.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
const confirmCallsE = () => pageE.evaluate(() => (window as unknown as { __confirmCalls: number }).__confirmCalls);

// P1-1: a typed radius alone makes the draft dirty
await pageE.click('[data-feat="fillet"]');
await pageE.click('#bw-pick-r', { count: 3 });
await pageE.keyboard.type('7');
let calls = await confirmCallsE();
await pageE.click('[data-feat="chamfer"]');
check('typed radius: switching opens the draft panel', await pageE.$eval('#bw-draft-decision', (el) => (el as HTMLDialogElement).open));
check('typed radius: native confirmation stays unused', (await confirmCallsE()) === calls);
await pageE.click('#bw-draft-keep');
check('typed radius: Keep editing keeps the picker', (await SE<{ kind: string; feat?: string }>('(s) => s.mode()')).feat === 'fillet');
check('typed radius: value survives Keep editing', await pageE.$eval('#bw-pick-r', (el) => (el as HTMLInputElement).value === '7'));
await pageE.click('#bw-pick-cancel');

// P1-1: a typed sketch height alone makes the draft dirty
await pageE.click('[data-feat="extrude"]');
await pageE.click('#bw-face-base');
await pageE.click('#bw-sk-op-h', { count: 3 });
await pageE.keyboard.type('44');
calls = await confirmCallsE();
await pageE.click('[data-feat="fillet"]');
check('typed height: switching opens the draft panel', await pageE.$eval('#bw-draft-decision', (el) => (el as HTMLDialogElement).open));
check('typed height: native confirmation stays unused', (await confirmCallsE()) === calls);
await pageE.click('#bw-draft-keep');
check('typed height: Keep editing keeps the sketch', (await SE<string>('(s) => s.mode().kind')) === 'sketching');

// P1-2: Clear during a dirty sketch asks, declining preserves everything
const docE = await SE<string>('(s) => s.docJson()');
calls = await confirmCallsE();
await pageE.click('#bw-clear');
check('Clear during dirty sketch: opens the draft decision first', await pageE.$eval('#bw-draft-decision', (el) => (el as HTMLDialogElement).open));
await pageE.click('#bw-draft-keep');
check('Clear during dirty sketch: Keep editing preserves the sketch', (await SE<string>('(s) => s.mode().kind')) === 'sketching');
check('Clear during dirty sketch: document untouched', (await SE<string>('(s) => s.docJson()')) === docE);
check('Clear kept: typed value survives', await pageE.$eval('#bw-sk-op-h', (el) => (el as HTMLInputElement).value === '44'));
// Discard closes only the draft, then the separate destructive panel owns Clear.
await pageE.click('#bw-clear');
await pageE.click('#bw-draft-discard');
check('Clear after Discard draft opens its destructive panel', await pageE.$eval('#bw-clear-decision', (el) => (el as HTMLDialogElement).open));
check('Discard draft leaves the committed document intact', (await SE<string>('(s) => s.docJson()')) === docE);
await pageE.click('#bw-clear-confirm');
await new Promise((r) => setTimeout(r, 1200));
check('Clear flow never invokes a native confirmation', (await confirmCallsE()) === calls);
check('Clear accepted: editor closed', (await SE<string>('(s) => s.mode().kind')) === 'idle' && (await pageE.$eval('#bw-sketch', (el) => (el as HTMLElement).hidden)));
check('Clear accepted: document empty', (await SE<string>('(s) => s.docJson()')).includes('"features":[]'));

// P1-2: Open during a clean editor cancels it and loads the project
await pageE.click('[data-feat="extrude"]'); // empty doc -> sketch directly
await pageE.waitForSelector('#bw-sketch:not([hidden])');
calls = await confirmCallsE();
const projectBeforeOpen = await SE<string>('(s) => s.projectId()');
await pageE.evaluate(() => {
  const json = JSON.stringify({
    features: [{ id: 'op1', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 20, h: 20 }], z: 0 }, h: 5, through: false }],
    params: [],
  });
  const dt = new DataTransfer();
  dt.items.add(new File([json], 'part.bomcad.json', { type: 'application/json' }));
  const inp = document.getElementById('bw-open-file') as HTMLInputElement;
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1500));
check('Open during clean editor: no prompt', (await confirmCallsE()) === calls);
check('Open during clean editor: editor cancelled', (await SE<string>('(s) => s.mode().kind')) === 'idle' && (await pageE.$eval('#bw-sketch', (el) => (el as HTMLElement).hidden)));
check('Open during clean editor: project loaded', (await SE<string>('(s) => s.docJson()')).includes('"op1"'));
check('Open switches to a new project journal', (await SE<string>('(s) => s.projectId()')) !== projectBeforeOpen && (await SE<number>('(s) => s.undoDepth()')) === 0);

// P2-5: feature buttons carry programmatic active state
await waitForStudioPage(pageE, { solid: true, timeout: 30_000 });
await pageE.click('[data-feat="fillet"]');
check('fillet button pressed while active', await pageE.$eval('[data-feat="fillet"]', (el) => el.getAttribute('aria-pressed') === 'true'));
check('other feature buttons stay unpressed', await pageE.$eval('[data-feat="extrude"]', (el) => el.getAttribute('aria-pressed') === 'false'));
await pageE.keyboard.press('Escape');
check('cancel clears the pressed state', await pageE.$eval('[data-feat="fillet"]', (el) => el.getAttribute('aria-pressed') === 'false'));

// P2-5: view buttons carry programmatic active state
await pageE.click('[data-view="top"]');
check('top view pressed', await pageE.$eval('[data-view="top"]', (el) => el.getAttribute('aria-pressed') === 'true'));
await pageE.click('[data-view="front"]');
check('front view replaces top', (await pageE.$eval('[data-view="front"]', (el) => el.getAttribute('aria-pressed') === 'true')) && (await pageE.$eval('[data-view="top"]', (el) => el.getAttribute('aria-pressed') === 'false')));

// P1-4: sketch workspace is the dark CAD surface, not a white widget
await pageE.click('[data-feat="extrude"]');
await pageE.click('#bw-face-base');
const skTheme = await pageE.evaluate(() => {
  const bg = getComputedStyle(document.getElementById('bw-sketch')!).backgroundColor;
  const bar = getComputedStyle(document.querySelector('.sk-top')!).backgroundColor;
  const lum = (c: string) => {
    const m = c.match(/\d+/g)!.map(Number);
    return (m[0] + m[1] + m[2]) / 3;
  };
  return { canvas: lum(bg), bar: lum(bar) };
});
check('sketch surface is dark', skTheme.canvas < 80, `avg ${skTheme.canvas}`);
check('sketch input bar is dark', skTheme.bar < 80, `avg ${skTheme.bar}`);
await pageE.keyboard.press('Escape');

// P2-7: cancelling Choose Face returns focus to the opener
await pageE.evaluate(() => {
  const btn = document.querySelector('[data-feat="extrude"]') as HTMLElement;
  btn.focus();
  btn.click(); // part exists -> choose-face
});
check('choose-face entered', (await SE<string>('(s) => s.mode().kind')) === 'choose-face');
await pageE.click('#bw-face-cancel');
check('choose-face cancel restores focus to the opener', await pageE.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.feat === 'extrude'));
// F2: a face -> sketch hand-off, then Cancel, restores focus to the ribbon opener
await pageE.evaluate(() => {
  const btn = document.querySelector('[data-feat="cut"]') as HTMLElement;
  btn.focus();
  btn.click(); // part exists -> choose-face
});
check('face->sketch handoff entered choose-face', (await SE<string>('(s) => s.mode().kind')) === 'choose-face');
await pageE.click('#bw-face-base'); // hand off to the sketcher
check('handoff opened the sketcher', (await SE<string>('(s) => s.mode().kind')) === 'sketching');
await pageE.keyboard.press('Escape'); // cancel the sketch
check('face->sketch cancel restores focus to the ribbon opener', await pageE.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.feat === 'cut'));

// P2-7: Open is a real keyboard-operable button; history select is a button
check('Open control is a focusable button', await pageE.$eval('#bw-open-btn', (el) => el.tagName === 'BUTTON'));
const histA11y = await pageE.evaluate(() => {
  const li = document.querySelector('.hist-item')!;
  const sel = li.querySelector('.hi-sel')!;
  return { liRole: li.getAttribute('role'), selIsButton: sel.tagName === 'BUTTON', pressed: sel.getAttribute('aria-pressed') };
});
check('history row is not a nested-button hierarchy', histA11y.liRole === null && histA11y.selIsButton && histA11y.pressed === 'false');
// keyboard select through the button
await pageE.evaluate(() => (document.querySelector('.hi-sel') as HTMLElement).focus());
await pageE.keyboard.press('Enter');
check('keyboard Enter on the row button selects', await pageE.$eval('#bw-context-wrap', (el) => !(el as HTMLElement).hidden));
check('focus stays on the row button after re-render', await pageE.evaluate(() => (document.activeElement as HTMLElement)?.classList?.contains('hi-sel')));
await pageE.close();

// --- P1-3: mobile panels reachable through visible controls only ----------
const pageM = await newStudioPage();
await pageM.setViewport({ width: 375, height: 700 });
await pageM.evaluateOnNewDocument(() => {
  localStorage.removeItem('bw-studio-doc-v2');
  localStorage.removeItem('bw-studio-v2-seeded');
});
await pageM.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageM, { solid: true });
const visibleIn = (sel: string) =>
  pageM.$eval(
    sel,
    (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1;
    },
  );
await pageM.evaluate(() => {
  (document.querySelector('[data-feat="fillet"]') as HTMLButtonElement).click();
  (document.getElementById('bw-pick-r') as HTMLInputElement).value = '7';
  (document.querySelector('[data-feat="chamfer"]') as HTMLButtonElement).click();
});
await pageM.waitForSelector('#bw-draft-decision[open]');
const mobileDecision = await pageM.evaluate(() => {
  const card = document.querySelector('#bw-draft-decision .ws-decision-card')!.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('#bw-draft-decision button')].map((button) => button.getBoundingClientRect());
  return {
    within: card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom <= innerHeight,
    touchSized: buttons.every((button) => button.height >= 43.5),
  };
});
check('mobile: draft decision fits entirely inside the viewport', mobileDecision.within);
check('mobile: draft decision actions are 44px touch targets', mobileDecision.touchSized);
await pageM.click('#bw-draft-keep');
await pageM.evaluate(() => (document.getElementById('bw-pick-cancel') as HTMLButtonElement).click());
check('mobile: tab bar visible', await visibleIn('#bw-mtab-history'));
const tabRect = await pageM.$eval('#bw-mtab-history', (el) => el.getBoundingClientRect().height);
check('mobile: tabs are 44px targets', tabRect >= 43.5, `h ${tabRect}`);
await pageM.click('#bw-mtab-history'); // real click on a visible control
check('mobile: history sheet opens', await visibleIn('.wsp-history'));
check('mobile: history rows visible in the sheet', await visibleIn('.hist-item .hi-sel'));
await pageM.click('.hist-item .hi-sel'); // real click on a visible row
check('mobile: selecting a row opens the properties sheet', await visibleIn('#bw-context-wrap'));
check('mobile: properties sheet replaces the history sheet', await pageM.$eval('.wsp-history', (el) => el.getBoundingClientRect().height === 0 || getComputedStyle(el).display === 'none'));
await pageM.click('#bw-mtab-params');
check('mobile: parameters sheet opens', await visibleIn('.wsp-params'));
check('mobile: parameter inputs usable', await visibleIn('[data-pval="0"]'));
await pageM.click('#bw-mtab-params');
check('mobile: tapping the tab again closes the sheet', await pageM.$eval('.wsp-params', (el) => getComputedStyle(el).display === 'none'));
await pageM.close();

// --- P2-6: pattern is editable from the context panel ---------------------
const pageP = await newStudioPage();
await pageP.evaluateOnNewDocument(() => {
  localStorage.setItem('bw-studio-v2-seeded', '1');
  localStorage.setItem(
    'bw-studio-doc-v2',
    JSON.stringify({
      features: [
        {
          id: 'pat1',
          type: 'extrude',
          sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 4 }], z: 0 },
          h: 6,
          through: false,
          pattern: { kind: 'linear', n: 3, dx: 15, dy: 0 },
        },
      ],
      params: [{ name: 'wall', value: 3 }],
    }),
  );
});
await pageP.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageP, { solid: true });
const SP = async <T>(fn: string): Promise<T> => pageP.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
await pageP.evaluate(() => (document.querySelector('.hist-item .hi-sel') as HTMLElement).click());
check('pattern count is editable in context', Boolean(await pageP.$('#bw-context [data-cxpat="n"]')));
const undoP = await SP<number>('(s) => s.undoDepth()');
await pageP.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement;
  inp.value = '5';
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1800));
check('pattern edit commits once and applies', (await SP<number>('(s) => s.undoDepth()')) === undoP + 1 && (await SP<string>('(s) => s.docJson()')).includes('"n":5'));
// F3: two pattern fields edited back-to-back both persist (no stale-copy revert)
await pageP.evaluate(() => {
  const n = document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement;
  const a = document.querySelector('#bw-context [data-cxpat="a"]') as HTMLInputElement;
  n.value = '4';
  n.dispatchEvent(new Event('change'));
  a.value = '22'; // fires before the n-edit rebuild re-renders the panel
  a.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 2000));
check('rapid pattern edits both persist', (await SP<string>('(s) => s.docJson()')).includes('"n":4') && (await SP<string>('(s) => s.docJson()')).includes('"dx":22'));
check('kernel runs in a worker', await SP<boolean>('(s) => s.kernelWorkerActive()'));
const staleProbe = await pageP.evaluate(async () => {
  const studio = (window as any).__bwStudio;
  const logStart = studio.appliedRevisionLog().length;
  studio.delayNextKernelReply(900);
  const older = studio.rebuildForTest();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const newer = studio.rebuildForTest();
  await Promise.all([older, newer]);
  return {
    applied: studio.appliedRevisionLog().slice(logStart),
    latest: studio.documentRevision(),
  };
});
check('delayed stale rebuild never reaches the display', staleProbe.applied.length === 1 && staleProbe.applied[0] === staleProbe.latest, JSON.stringify(staleProbe));
const generationBeforeCrash = await SP<number>('(s) => s.kernelGeneration()');
const revisionBeforeCrash = await SP<number>('(s) => s.appliedRevision()');
await pageP.evaluate(() => (window as any).__bwStudio.failKernelForTest());
let workerReplayed = false;
for (let attempt = 0; attempt < 120 && !workerReplayed; attempt++) {
  workerReplayed = await SP<boolean>(`(s) => s.kernelGeneration() > ${generationBeforeCrash} && s.appliedRevision() > ${revisionBeforeCrash} && s.appliedRevision() === s.documentRevision()`);
  if (!workerReplayed) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!workerReplayed) throw new Error('Restarted worker did not replay the committed document.');
check('worker crash restarts a fresh kernel generation', (await SP<number>('(s) => s.kernelGeneration()')) === generationBeforeCrash + 1);
check('worker restart replays the committed document', (await SP<number>('(s) => s.triCount()')) > 0 && (await SP<string[]>('(s) => s.errors()')).length === 0);
// invalid count: inline error, no commit
const undoBeforeInvalid = await SP<number>('(s) => s.undoDepth()');
await pageP.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement;
  inp.value = '1';
  inp.dispatchEvent(new Event('change'));
});
check('invalid pattern count: inline error, nothing committed', (await pageP.evaluate(() => document.querySelector('#bw-context [data-cxpat="n"]')!.classList.contains('field-err'))) && (await SP<number>('(s) => s.undoDepth()')) === undoBeforeInvalid);
// Fractional counts are invalid; they must not be rounded and committed.
await pageP.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cxpat="n"]') as HTMLInputElement;
  inp.value = '2.4';
  inp.dispatchEvent(new Event('change'));
});
check('fractional pattern count: inline error, nothing committed', (await pageP.evaluate(() => document.querySelector('#bw-context [data-cxpat="n"]')!.classList.contains('field-err'))) && (await SP<number>('(s) => s.undoDepth()')) === undoBeforeInvalid);
// parameter dependency line: set height to an expression, check the stat
await pageP.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cx="h"]') as HTMLInputElement;
  inp.value = 'wall*2';
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1800));
check('context lists parameter dependencies', await pageP.$eval('#bw-context', (el) => /Uses parameters: wall/.test(el.textContent || '')));
// F1: a parameter named like a structural enum must not false-match
await pageP.evaluate(() => {
  const inp = document.querySelector('#bw-context [data-cx="h"]') as HTMLInputElement;
  inp.value = '6'; // plain number — references no parameter now
  inp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1800));
// add a parameter named 'circle' (matches the shape kind) via the params UI
await pageP.evaluate(() => (document.getElementById('bw-param-add') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 800));
await pageP.evaluate(() => {
  const nameInp = document.querySelector('[data-pname]') as HTMLInputElement;
  nameInp.value = 'circle';
  nameInp.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 800));
await pageP.evaluate(() => (document.querySelector('.hist-item .hi-sel') as HTMLElement).click());
check('enum-named parameter does not false-match', await pageP.$eval('#bw-context', (el) => !/Uses parameters:[^<]*circle/.test(el.textContent || '')));
await pageP.close();

// (10) Fit and view presets centre on a part far from the origin
const pageD = await newStudioPage();
await pageD.evaluateOnNewDocument(() => {
  localStorage.setItem('bw-studio-v2-seeded', '1');
  localStorage.setItem(
    'bw-studio-doc-v2',
    JSON.stringify({
      features: [{ id: 'off1', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 120, y: 80, w: 30, h: 20 }], z: 0 }, h: 15, through: false }],
      params: [],
    }),
  );
});
await pageD.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageD, { solid: true });
const SD = async <T>(fn: string): Promise<T> => pageD.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
await pageD.click('[data-view="fit"]');
await new Promise((r) => setTimeout(r, 300));
const ndcFit = await SD<[number, number]>('(s) => s.ndcOfPartCenter()');
check('Fit centres an off-origin part', Math.abs(ndcFit[0]) < 0.15 && Math.abs(ndcFit[1]) < 0.15, ndcFit.join(','));
await pageD.click('[data-view="front"]');
await new Promise((r) => setTimeout(r, 300));
const ndcFront = await SD<[number, number]>('(s) => s.ndcOfPartCenter()');
check('view presets target the part centre', Math.abs(ndcFront[0]) < 0.15 && Math.abs(ndcFront[1]) < 0.15, ndcFront.join(','));
await pageD.close();

// --- v1-scene notice: survives status messages, seen only on dismissal ----
const page2 = await newStudioPage();
await page2.evaluateOnNewDocument(() => {
  localStorage.setItem('bw-studio-scene-v1', '[]');
  localStorage.removeItem('bw-studio-v1-notice');
  localStorage.removeItem('bw-studio-doc-v2');
  localStorage.removeItem('bw-studio-v2-seeded');
});
await page2.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(page2, { solid: true });
check('v1 notice still visible after kernel messages', Boolean(await page2.$('#bw-v1-notice')));
check(
  'v1 seen-flag not set before dismissal',
  (await page2.evaluate(() => localStorage.getItem('bw-studio-v1-notice'))) === null,
);
await page2.click('#bw-v1-notice button');
check('dismissal stores the seen-flag', (await page2.evaluate(() => localStorage.getItem('bw-studio-v1-notice'))) === '1');
check('old v1 key untouched', (await page2.evaluate(() => localStorage.getItem('bw-studio-scene-v1'))) === '[]');
await page2.close();

// --- storage disabled: boot must still produce the starter part -----------
const page3 = await newStudioPage();
await page3.evaluateOnNewDocument(() => {
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
});
await page3.goto(URL_, { waitUntil: 'domcontentloaded' });
const bootOk = await waitForStudioPage(page3, { solid: true })
  .then(() => true)
  .catch(() => false);
check('boot survives disabled localStorage (starter part builds)', bootOk);
await page3.close();

// --- complete storage failure is visible but modeling remains available ---
const page4 = await newStudioPage();
await page4.evaluateOnNewDocument(() => {
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  Object.defineProperty(window, 'indexedDB', {
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
});
await page4.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(page4, { solid: true });
check('complete storage failure is reported in the document bar', await page4.$eval('#bw-storage-state', (el) => /Storage unavailable/.test(el.textContent || '')));
const storageFailureUndo = await page4.evaluate(() => (window as any).__bwStudio.undoDepth());
await page4.click('#bw-param-add');
check('storage failure does not block modeling', (await page4.evaluate(() => (window as any).__bwStudio.undoDepth())) === storageFailureUndo + 1);
await page4.close();

// --- invalid feature order reports an isolated kernel error ---------------
const pageK = await newStudioPage();
await pageK.evaluateOnNewDocument(() => {
  localStorage.setItem('bw-studio-v2-seeded', '1');
  localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
    title: 'Cut first',
    features: [{ id: 'cut-first', type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 5 }] }, h: 5, through: false }],
    params: [],
  }));
});
await pageK.goto(URL_, { waitUntil: 'domcontentloaded' });
let cutFirstBuilt = false;
for (let attempt = 0; attempt < 120 && !cutFirstBuilt; attempt++) {
  cutFirstBuilt = await pageK.evaluate(() => {
    const studio = (window as any).__bwStudio;
    return Boolean(studio && studio.documentRevision() > 0 && studio.appliedRevision() === studio.documentRevision());
  });
  if (!cutFirstBuilt) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!cutFirstBuilt) throw new Error('Cut-first fixture did not finish rebuilding.');
const cutFirstResult = await pageK.evaluate(() => ({ triangles: (window as any).__bwStudio.triCount(), errors: (window as any).__bwStudio.errors() }));
check('cut-first remains blank instead of inventing a base solid', cutFirstResult.triangles === 0);
check('cut-first reports the missing upstream solid', cutFirstResult.errors.some((error: string) => /nothing to cut yet/.test(error)), JSON.stringify(cutFirstResult));
await pageK.close();

// --- desktop-CAD application chrome ---------------------------------------
// The canvas is flanked by a model tree and inspector. Above it, the tutorial
// video's hierarchy is explicit: title bar, tab rail, grouped ribbon, document
// tabs, then the uninterrupted viewport.
const pageV = await newStudioPage();
await pageV.evaluateOnNewDocument(() => {
  localStorage.setItem('bw-studio-doc-v2', JSON.stringify({
    params: [{ name: 'size', value: 40 }, { name: 'hole', value: 8 }],
    features: [
      { id: 'v3-extrude', type: 'extrude', sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 'size', h: 'size' }], z: 0 }, h: 5 },
      { id: 'v3-cut', type: 'cut', sketch: { shapes: [{ kind: 'circle', x: 0, y: 0, r: 'hole/2' }], z: 5 }, h: 10, through: true },
    ],
  }));
  localStorage.setItem('bw-studio-v2-seeded', '1');
});
await pageV.setViewport({ width: 1440, height: 900 });
await pageV.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageV, { solid: true, idle: true });

const v3Shell = await pageV.evaluate(() => {
  const tree = document.getElementById('bw-tree')!.getBoundingClientRect();
  const stage = document.getElementById('bw-studio')!.getBoundingClientRect();
  const side = document.getElementById('bw-side')!.getBoundingClientRect();
  const panels = [...document.querySelectorAll<HTMLElement>('[data-workspace-panel]')];
  const appbar = document.querySelector<HTMLElement>('.ws-appbar')!.getBoundingClientRect();
  const brand = document.querySelector<HTMLElement>('.ws-brand')!.getBoundingClientRect();
  const documentTitle = document.querySelector<HTMLElement>('.ws-document')!.getBoundingClientRect();
  const actions = document.querySelector<HTMLElement>('.ws-app-actions')!.getBoundingClientRect();
  const titlePieces = [...document.querySelectorAll<HTMLElement>('.ws-document-kind, .ws-document-separator, .ws-document .ws-project-name, .ws-document-suffix')]
    .map((piece) => ({ rect: piece.getBoundingClientRect(), whiteSpace: getComputedStyle(piece).whiteSpace }));
  const documentTab = document.querySelector<HTMLElement>('.ws-doc-tab')!.getBoundingClientRect();
  const documentTabs = document.querySelector<HTMLElement>('.ws-document-tabs')!.getBoundingClientRect();
  return {
    tabs: document.querySelectorAll('[data-workspace]').length,
    tabLabels: [...document.querySelectorAll<HTMLElement>('[data-workspace]')].map((tab) => tab.textContent?.trim()).join(','),
    selected: document.querySelector('[data-workspace][aria-selected="true"]')?.getAttribute('data-workspace'),
    visiblePanels: panels.filter((panel) => !panel.hidden && panel.getClientRects().length).map((panel) => panel.dataset.workspacePanel),
    ordered: tree.left < stage.left && stage.right <= side.left,
    heightsAligned: Math.abs(tree.top - stage.top) < 2 && Math.abs(side.top - stage.top) < 2,
    chrome: {
      appbar: document.querySelector('.ws-appbar')!.getBoundingClientRect().height,
      tabs: document.querySelector('.ws-workspace-bar')!.getBoundingClientRect().height,
      ribbon: document.querySelector('[data-workspace-panel="solid"]')!.getBoundingClientRect().height,
      documents: document.querySelector('.ws-document-tabs')!.getBoundingClientRect().height,
    },
    solidGroups: document.querySelectorAll('#ws-panel-solid .ws-group').length,
    solidLarge: document.querySelectorAll('#ws-panel-solid .wsr-btn.is-large').length,
    solidCompact: document.querySelectorAll('#ws-panel-solid .wsr-btn.is-compact').length,
    compactRowsClear: [...document.querySelectorAll<HTMLElement>('#ws-panel-solid .wsr-btn.is-compact')].every((button) => {
      const icon = button.querySelector<HTMLElement>('.wsr-i')?.getBoundingClientRect();
      const label = button.querySelector<HTMLElement>('.wsr-label')?.getBoundingClientRect();
      return Boolean(icon && label && icon.right + 2 <= label.left && Math.abs((icon.top + icon.bottom) / 2 - (label.top + label.bottom) / 2) < 3);
    }),
    largeColumnsClear: [...document.querySelectorAll<HTMLElement>('#ws-panel-solid .wsr-btn.is-large')].every((button) => {
      const icon = button.querySelector<HTMLElement>('.wsr-i')?.getBoundingClientRect();
      const label = button.querySelector<HTMLElement>('.wsr-label')?.getBoundingClientRect();
      return Boolean(icon && label && icon.bottom < label.top && Math.abs((icon.left + icon.right) / 2 - (label.left + label.right) / 2) < 2);
    }),
    groupCaptionsClear: [...document.querySelectorAll<HTMLElement>('#ws-panel-solid .ws-group')].every((group) => {
      const tools = group.querySelector<HTMLElement>('.wsg-tools')?.getBoundingClientRect();
      const title = group.querySelector<HTMLElement>('.wsg-title')?.getBoundingClientRect();
      return Boolean(tools && title && tools.bottom + 4 <= title.top);
    }),
    titleBar: {
      zonesClear: brand.right <= documentTitle.left && documentTitle.right <= actions.left,
      verticallyCentered: [brand, documentTitle, actions].every((rect) => Math.abs((rect.top + rect.bottom) / 2 - (appbar.top + appbar.bottom) / 2) < 1),
      oneBaseline: Math.max(...titlePieces.map((piece) => (piece.rect.top + piece.rect.bottom) / 2)) - Math.min(...titlePieces.map((piece) => (piece.rect.top + piece.rect.bottom) / 2)) < 1,
      oneLine: titlePieces.every((piece) => piece.rect.height <= 11 && piece.whiteSpace === 'nowrap'),
      kindLayout: getComputedStyle(document.querySelector<HTMLElement>('.ws-document-kind')!).display,
    },
    documentTabCentered: Math.abs((documentTab.top + documentTab.bottom) / 2 - (documentTabs.top + documentTabs.bottom) / 2) < 1,
    documentName: document.getElementById('bw-tab-project-name')?.textContent,
  };
});
check('ribbon exposes the six video-derived application tabs', v3Shell.tabs === 6 && v3Shell.tabLabels === 'Home,Sketch,3D Tools,View,Manage,Output', JSON.stringify(v3Shell));
check('3D Tools is the single initial workspace', v3Shell.selected === 'solid' && v3Shell.visiblePanels.join(',') === 'solid', JSON.stringify(v3Shell));
check('model tree, canvas and inspector form one aligned workspace', v3Shell.ordered && v3Shell.heightsAligned, JSON.stringify(v3Shell));
check('desktop chrome uses a compact title-tab-ribbon-document hierarchy',
  Math.abs(v3Shell.chrome.appbar - 32) < 2 && Math.abs(v3Shell.chrome.tabs - 29) < 2 && Math.abs(v3Shell.chrome.ribbon - 112) < 2 && Math.abs(v3Shell.chrome.documents - 32) < 2,
  JSON.stringify(v3Shell.chrome));
check('3D Tools uses dense grouped large and compact commands', v3Shell.solidGroups >= 3 && v3Shell.solidLarge >= 3 && v3Shell.solidCompact >= 6, JSON.stringify(v3Shell));
check('compact ribbon rows keep icons clear of their labels', v3Shell.compactRowsClear, JSON.stringify(v3Shell));
check('large ribbon commands keep centred icon-label columns', v3Shell.largeColumnsClear, JSON.stringify(v3Shell));
check('ribbon group captions stay below every command row', v3Shell.groupCaptionsClear, JSON.stringify(v3Shell));
check('document title bar has three clear zones and one visual baseline', v3Shell.titleBar.zonesClear && v3Shell.titleBar.verticallyCentered && v3Shell.titleBar.oneBaseline && v3Shell.titleBar.oneLine && (v3Shell.titleBar.kindLayout === 'inline-flex' || v3Shell.titleBar.kindLayout === 'flex'), JSON.stringify(v3Shell.titleBar));
check('active document tab is vertically centred in its rail', v3Shell.documentTabCentered, JSON.stringify(v3Shell));
check('active document tab mirrors the project name', v3Shell.documentName === 'Untitled part', JSON.stringify(v3Shell));

check('3D Tools includes the real solid-modification commands', (await pageV.$$('#ws-panel-solid [data-feat="fillet"], #ws-panel-solid [data-feat="chamfer"], #ws-panel-solid [data-feat="shell"]')).length === 3);
await pageV.click('[data-workspace="view"]');
check('View tab exposes all orientation commands',
  (await pageV.$$('#ws-panel-view [data-view]')).length === 5 &&
  (await pageV.$eval('[data-workspace="view"]', (el) => el.getAttribute('aria-selected'))) === 'true');

check('ViewCube exposes top, front, right and isometric views', (await pageV.$$('[data-cube-view]')).length === 5);
await pageV.click('[data-cube-view="right"]');
check('ViewCube click synchronizes the View preset state',
  (await pageV.$eval('[data-view="right"]', (el) => el.getAttribute('aria-pressed'))) === 'true');
await pageV.click('[data-nav-mode="pan"]');
check('canvas navigation has exclusive Orbit and Pan modes',
  (await pageV.$eval('[data-nav-mode="pan"]', (el) => el.getAttribute('aria-pressed'))) === 'true' &&
  (await pageV.$eval('[data-nav-mode="orbit"]', (el) => el.getAttribute('aria-pressed'))) === 'false');
await pageV.click('#bw-tree-base');
check('Base plane orients the camera normal to XY',
  (await pageV.$eval('[data-view="top"]', (el) => el.getAttribute('aria-pressed'))) === 'true');

check('model tree renders feature-type badges',
  (await pageV.$$('.hist-item .hi-glyph')).length === 2 &&
  (await pageV.$$eval('.hist-item .hi-glyph', (els) => els.map((el) => el.textContent).join(','))) === 'EX,CU');
check('inspector begins with a deliberate empty-selection state',
  await pageV.$eval('#bw-inspector-empty', (el) => !(el as HTMLElement).hidden));
await pageV.click('.hist-item .hi-sel');
check('feature selection replaces the empty inspector with live properties',
  await pageV.$eval('#bw-context-wrap', (el) => !(el as HTMLElement).hidden) &&
  await pageV.$eval('#bw-inspector-empty', (el) => (el as HTMLElement).hidden));
check('document history actions reflect the actual command stacks',
  await pageV.$eval('#bw-undo', (el) => (el as HTMLButtonElement).disabled) &&
  await pageV.$eval('#bw-redo', (el) => (el as HTMLButtonElement).disabled));
await pageV.click('#bw-param-add');
check('a committed edit enables Undo in the document bar',
  !(await pageV.$eval('#bw-undo', (el) => (el as HTMLButtonElement).disabled)));

await pageV.click('[data-workspace="home"]');
await pageV.click('[data-command-feat="extrude"]');
check('Home ribbon proxies invoke the canonical modeling command', (await pageV.$eval('#bw-face', (el) => !(el as HTMLElement).hidden)));
await pageV.click('#bw-face-cancel');

await pageV.click('[data-workspace="solid"]');
await pageV.click('[data-feat="extrude"]');
await pageV.click('#bw-face-base');
check('sketching promotes Sketch to the active contextual workspace',
  !(await pageV.$eval('[data-workspace="sketch"]', (el) => (el as HTMLButtonElement).disabled)) &&
  (await pageV.$eval('[data-workspace="sketch"]', (el) => el.getAttribute('aria-selected'))) === 'true' &&
  !(await pageV.$eval('#ws-panel-sketch', (el) => (el as HTMLElement).hidden)));
await pageV.click('#bw-sk-cancel');
check('leaving sketch disables the Sketch workspace again',
  await pageV.$eval('[data-workspace="sketch"]', (el) => (el as HTMLButtonElement).disabled));

for (const [width, maxTitleWidth] of [[900, 160], [768, 100]] as const) {
  await pageV.setViewport({ width, height: 700 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const narrowHeader = await pageV.evaluate((expectedMax) => {
    const project = document.getElementById('bw-project-name')!;
    project.textContent = 'A deliberately long precision-machined component name';
    const brand = document.querySelector<HTMLElement>('.ws-brand')!.getBoundingClientRect();
    const title = document.querySelector<HTMLElement>('.ws-document')!.getBoundingClientRect();
    const actions = document.querySelector<HTMLElement>('.ws-app-actions')!.getBoundingClientRect();
    const kind = document.querySelector<HTMLElement>('.ws-document-kind')!;
    const separator = document.querySelector<HTMLElement>('.ws-document-separator')!;
    return {
      zonesClear: brand.right <= title.left && title.right <= actions.left,
      chromeHidden: getComputedStyle(kind).display === 'none' && getComputedStyle(separator).display === 'none',
      titleWidth: title.width,
      maxTitleWidth: expectedMax,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, maxTitleWidth);
  check(`${width}px desktop-equivalent header never collides or wraps`,
    narrowHeader.zonesClear && narrowHeader.chromeHidden && narrowHeader.titleWidth <= narrowHeader.maxTitleWidth + 1 && narrowHeader.overflow === 0,
    JSON.stringify(narrowHeader));
}
await pageV.evaluate(() => { document.getElementById('bw-project-name')!.textContent = 'Untitled part'; });

await pageV.setViewport({ width: 375, height: 700 });
await new Promise((resolve) => setTimeout(resolve, 250));
await pageV.click('#bw-mtab-project');
check('mobile Project tab opens real file and export actions',
  await pageV.$eval('.cadstudio-app', (el) => el.classList.contains('m-open-project')) &&
  await pageV.$eval('#bw-project-actions', (el) => Boolean(el.getClientRects().length)) &&
  (await pageV.$$('#bw-project-actions button')).length >= 5 &&
  (await pageV.$$eval('#bw-project-actions button', (buttons) =>
    buttons.map((button) => (button.textContent || '').trim()).filter(Boolean).join(','))) === 'Templates,Save,Open,Recover,Clear,STEP,STL');
await pageV.click('#bw-mtab-project');
check('mobile Project sheet toggles closed',
  !(await pageV.$eval('.cadstudio-app', (el) => el.classList.contains('m-open-project'))));
await pageV.close();

// --- application shell + first run ---------------------------------------
// Run after the legacy interaction suite: Start sketch deliberately begins
// a kernel load, and this fresh project must not alter any earlier fixtures.
const welcomePage = await newStudioPage(true);
await welcomePage.evaluateOnNewDocument(() => localStorage.clear());
welcomePage.on('pageerror', (e) => check('first-run page has no errors', false, String(e)));
await welcomePage.goto(URL_, { waitUntil: 'domcontentloaded' });
let welcomeReady = false;
for (let i = 0; i < 120 && !welcomeReady; i++) {
  welcomeReady = await welcomePage.evaluate(() => Boolean((window as unknown as { __bwStudio?: unknown }).__bwStudio));
  if (!welcomeReady) await new Promise((r) => setTimeout(r, 500));
}
if (!welcomeReady) throw new Error('first-run CAD app did not finish booting');
const shell = await welcomePage.evaluate(() => {
  const app = document.getElementById('studio')!.getBoundingClientRect();
  const main = document.querySelector('main')!.getBoundingClientRect();
  return {
    bodyClass: document.body.classList.contains('cadstudio-route'),
    siteHeaderHidden: getComputedStyle(document.querySelector('body > header.site')!).display === 'none',
    siteFooterHidden: getComputedStyle(document.querySelector('body > footer.site')!).display === 'none',
    app: [app.left, app.top, app.width, app.height],
    main: [main.left, main.top, main.width, main.height],
    viewport: [innerWidth, innerHeight],
    oldDocsGone: !document.getElementById('studio-docs'),
    welcomeVisible: !(document.getElementById('bw-welcome') as HTMLElement).hidden,
  };
});
check('studio route uses a dedicated application shell', shell.bodyClass && shell.siteHeaderHidden && shell.siteFooterHidden);
check(
  'workspace fills the browser viewport',
  Math.abs(shell.app[0]) < 1 &&
    Math.abs(shell.app[1]) < 1 &&
    Math.abs(shell.app[2] - shell.viewport[0]) < 2 &&
    Math.abs(shell.app[3] - shell.viewport[1]) < 2 &&
    Math.abs(shell.main[3] - shell.viewport[1]) < 2,
  JSON.stringify(shell),
);
check('long documentation page is removed', shell.oldDocsGone);
check('brand-new project shows the template-first launchpad', shell.welcomeVisible && (await welcomePage.$eval('#bw-welcome-title', (el) => el.textContent)) === 'Choose a starting point');
check('first-run launchpad shows four useful quick starters', (await welcomePage.$$('[data-welcome-template]')).length === 4);
check('first-run screen keeps template, blank, and existing-project choices', (await welcomePage.$$('.ws-welcome-actions button')).length === 3);
await welcomePage.click('#bw-welcome-help');
check('Help opens inside the application', await welcomePage.$eval('#bw-help', (el) => (el as HTMLDialogElement).open));
check('Help exposes tour replay and the template cabinet', (await welcomePage.$$('#bw-help-tour, #bw-help-templates')).length === 2);
await welcomePage.click('#bw-help-tour');
check('first-run Help walkthrough points to the available start controls', (await welcomePage.$eval('#bw-tour-title', (el) => el.textContent)) === 'Start from proven geometry');
await welcomePage.click('#bw-tour-skip');
check('finishing the Help walkthrough returns to the unfinished launchpad', !(await welcomePage.$eval('#bw-welcome', (el) => (el as HTMLElement).hidden)));
await welcomePage.evaluate(() => localStorage.removeItem('bw-studio-tour-v1'));
const fullscreenRequested = await welcomePage.evaluate(async () => {
  let called = false;
  const app = document.getElementById('studio') as HTMLElement;
  app.requestFullscreen = async () => {
    called = true;
  };
  (document.getElementById('bw-fullscreen') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  return called;
});
check(
  'fullscreen control requests the application surface',
  fullscreenRequested &&
    (await welcomePage.$eval('#bw-fullscreen', (el) => el.getAttribute('aria-pressed'))) === 'false' &&
    (await welcomePage.$eval('#bw-fullscreen-label', (el) => el.textContent)) === 'Full screen',
);

await welcomePage.click('#bw-welcome-templates');
await welcomePage.waitForSelector('#bw-templates[open]');
check('first run opens a real in-app component library', await welcomePage.$eval('#bw-templates', (el) => (el as HTMLDialogElement).open));
check('library exposes all 28 components and six category choices', (await welcomePage.$$('.ws-template-card')).length === 28 && (await welcomePage.$$('#bw-template-categories button')).length === 6);
check('selected component shows its feature recipe before opening', (await welcomePage.$$('#bw-template-recipe li')).length >= 2 && !(await welcomePage.$eval('#bw-template-use', (el) => (el as HTMLButtonElement).disabled)));
await welcomePage.keyboard.press('Escape');
check('Escape closes the library and restores the unfinished first run', !(await welcomePage.$eval('#bw-templates', (el) => (el as HTMLDialogElement).open)) && !(await welcomePage.$eval('#bw-welcome', (el) => (el as HTMLElement).hidden)));
await welcomePage.click('#bw-welcome-templates');
await welcomePage.waitForSelector('#bw-templates[open]');
await welcomePage.$eval('#bw-template-search', (el) => {
  (el as HTMLInputElement).value = 'electronics tray';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
check('template search filters immediately', (await welcomePage.$$('.ws-template-card')).length === 1 && (await welcomePage.$eval('.ws-template-card b', (el) => el.textContent)) === 'Electronics tray');
await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { delayNextKernelReply(milliseconds: number): void } }).__bwStudio.delayNextKernelReply(1200));
await welcomePage.click('#bw-template-use');
await welcomePage.waitForFunction(() => !(document.getElementById('bw-templates') as HTMLDialogElement).open && document.querySelectorAll('.hist-item').length === 2);
check(
  'opening a template creates a normal editable document',
  (await welcomePage.$eval('#bw-project-name', (el) => el.textContent)) === 'Electronics tray' &&
  (await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { docJson(): string } }).__bwStudio.docJson())).includes('"wall"'),
);
await new Promise((resolve) => setTimeout(resolve, 900));
const firstTourState = await welcomePage.evaluate(() => ({
  hidden: (document.getElementById('bw-tour') as HTMLElement).hidden,
  seen: localStorage.getItem('bw-studio-tour-v1'),
  title: document.getElementById('bw-tour-title')?.textContent,
  targetCount: document.querySelectorAll('.ws-tour-target').length,
}));
check('first template opens an anchored walkthrough over live controls', !firstTourState.hidden && firstTourState.targetCount === 1 && (await welcomePage.$eval('#bw-tour-step', (el) => el.textContent)) === '1 of 4', JSON.stringify(firstTourState));
await welcomePage.waitForFunction(() => {
  const studio = (window as unknown as { __bwStudio: { triCount(): number; appliedRevision(): number } }).__bwStudio;
  return studio.triCount() > 0 && studio.appliedRevision() > 0 && document.querySelectorAll('.ws-tour-target').length === 1;
});
check('walkthrough reanchors after a delayed rebuild replaces the feature tree', (await welcomePage.$$('.ws-tour-target')).length === 1);
await welcomePage.click('#bw-tour-next');
check('walkthrough advances from feature tree to a real dimension field', (await welcomePage.$eval('#bw-tour-title', (el) => el.textContent)) === 'Edit the driving numbers' && (await welcomePage.$$('.ws-tour-target')).length === 1);
await welcomePage.click('#bw-tour-next');
await welcomePage.click('#bw-tour-next');
await welcomePage.click('#bw-tour-next');
check('walkthrough finishes cleanly and removes its highlight', await welcomePage.$eval('#bw-tour', (el) => (el as HTMLElement).hidden) && (await welcomePage.$$('.ws-tour-target')).length === 0);
await welcomePage.click('#bw-help-open');
await welcomePage.click('#bw-help-tour');
check('Help can replay the walkthrough at any time', !(await welcomePage.$eval('#bw-tour', (el) => (el as HTMLElement).hidden)));
await welcomePage.click('#bw-tour-skip');

// Template changes are autosaved transitions, not browser interruptions.
const transitionBefore = await welcomePage.evaluate(() => {
  const studio = (window as unknown as { __bwStudio: { docJson(): string; projectId(): string; undoDepth(): number; redoDepth(): number } }).__bwStudio;
  (window as unknown as { __nativeConfirmCalls: number }).__nativeConfirmCalls = 0;
  window.confirm = () => {
    (window as unknown as { __nativeConfirmCalls: number }).__nativeConfirmCalls++;
    return false;
  };
  return { doc: studio.docJson(), projectId: studio.projectId(), undo: studio.undoDepth(), redo: studio.redoDepth() };
});
await welcomePage.click('#bw-templates-open');
await welcomePage.waitForSelector('#bw-templates[open]');
await welcomePage.$eval('#bw-template-search', (el) => {
  (el as HTMLInputElement).value = 'phone stand profile';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await welcomePage.click('#bw-template-use');
await welcomePage.waitForFunction(() => document.getElementById('bw-project-name')?.textContent === 'Phone stand profile' && !(document.getElementById('bw-templates') as HTMLDialogElement).open);
const templateTransition = await welcomePage.evaluate(async () => {
  const studio = (window as unknown as { __bwStudio: { projectId(): string; flushStorage(): Promise<void>; recovery(): Promise<Array<{ projectId: string; label: string }>> } }).__bwStudio;
  await studio.flushStorage();
  return {
    projectId: studio.projectId(),
    nativeConfirms: (window as unknown as { __nativeConfirmCalls: number }).__nativeConfirmCalls,
    toastOpen: !(document.getElementById('bw-transition-toast') as HTMLElement).hidden,
    toastTitle: document.getElementById('bw-transition-title')?.textContent,
    toastDetail: document.getElementById('bw-transition-detail')?.textContent,
    undoVisible: !(document.getElementById('bw-transition-undo') as HTMLElement).hidden,
    canvasFocused: document.activeElement === document.querySelector('#bw-studio > canvas'),
    recovery: await studio.recovery(),
  };
});
check('template switch never invokes a browser confirmation', templateTransition.nativeConfirms === 0);
check('template switch opens immediately as a new project', templateTransition.projectId !== transitionBefore.projectId);
check('template switch reports the recoverable transition in-app', templateTransition.toastOpen && /Phone stand profile/.test(templateTransition.toastTitle || '') && /Recover/.test(templateTransition.toastDetail || '') && templateTransition.undoVisible);
check('template switch returns keyboard focus to the 3D canvas', templateTransition.canvasFocused);
check('template switch journals the previous part before opening', templateTransition.recovery.some((entry) => entry.projectId === transitionBefore.projectId && entry.label === 'Before opening Phone stand profile'));
await welcomePage.click('#bw-transition-undo');
await welcomePage.waitForFunction((previousProjectId) => (window as unknown as { __bwStudio: { projectId(): string } }).__bwStudio.projectId() === previousProjectId, {}, transitionBefore.projectId);
const transitionRestored = await welcomePage.evaluate(async () => {
  const studio = (window as unknown as { __bwStudio: { docJson(): string; projectId(): string; undoDepth(): number; redoDepth(): number; flushStorage(): Promise<void>; recovery(): Promise<Array<{ projectId: string; label: string }>> } }).__bwStudio;
  await studio.flushStorage();
  return {
    doc: studio.docJson(),
    projectId: studio.projectId(),
    undo: studio.undoDepth(),
    redo: studio.redoDepth(),
    projectName: document.getElementById('bw-project-name')?.textContent,
    toastTitle: document.getElementById('bw-transition-title')?.textContent,
    undoHidden: (document.getElementById('bw-transition-undo') as HTMLElement).hidden,
    recovery: await studio.recovery(),
  };
});
check('template Undo restores the previous project byte-for-byte', transitionRestored.doc === transitionBefore.doc && transitionRestored.projectId === transitionBefore.projectId && transitionRestored.undo === transitionBefore.undo && transitionRestored.redo === transitionBefore.redo);
check('template Undo restores the previous project chrome', transitionRestored.projectName === 'Electronics tray' && transitionRestored.toastTitle === 'Previous part restored' && transitionRestored.undoHidden);
check('template Undo leaves the opened template in Recover', transitionRestored.recovery.some((entry) => entry.projectId === templateTransition.projectId && entry.label === 'Before restoring Electronics tray'));

await welcomePage.setViewport({ width: 375, height: 700 });
await new Promise((resolve) => setTimeout(resolve, 150));
await welcomePage.$eval('#bw-mtab-project', (el) => (el as HTMLButtonElement).click());
await welcomePage.$eval('#bw-templates-open', (el) => (el as HTMLButtonElement).click());
await welcomePage.waitForSelector('#bw-templates[open]');
const mobileLibrary = await welcomePage.evaluate(() => {
  const dialog = document.getElementById('bw-templates')!.getBoundingClientRect();
  const search = document.getElementById('bw-template-search')!.getBoundingClientRect();
  const close = document.getElementById('bw-templates-close')!.getBoundingClientRect();
  const list = document.getElementById('bw-template-list')!.getBoundingClientRect();
  const detail = document.getElementById('bw-template-detail')!.getBoundingClientRect();
  return { width: dialog.width, viewport: innerWidth, search: search.height, close: close.height, overflow: document.documentElement.scrollWidth - innerWidth, listBottom: list.bottom, detailTop: detail.top };
});
check('375px: component library fills the screen without horizontal overflow', mobileLibrary.width <= mobileLibrary.viewport + 1 && mobileLibrary.overflow <= 1, JSON.stringify(mobileLibrary));
check('375px: library search and close are touch-sized', mobileLibrary.search >= 44 && mobileLibrary.close >= 44, JSON.stringify(mobileLibrary));
check('375px: template list and detail form separate vertical rows', mobileLibrary.listBottom <= mobileLibrary.detailTop + 1, JSON.stringify(mobileLibrary));
await welcomePage.click('#bw-templates-close');
await welcomePage.setViewport({ width: 1440, height: 900 });
await new Promise((resolve) => setTimeout(resolve, 150));
await welcomePage.$eval('#bw-transition-toast', (el) => {
  (el as HTMLElement).hidden = false;
  el.classList.add('is-visible');
});
await welcomePage.$eval('#bw-welcome-start', (el) => (el as HTMLButtonElement).click());
await welcomePage.waitForSelector('#bw-sketch:not([hidden])');
check('starting a modeling command dismisses passive recovery notices', await welcomePage.$eval('#bw-transition-toast', (el) => (el as HTMLElement).hidden));
check(
  'Blank sketch remains a first-class start and opens Extrude',
  (await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { docJson(): string } }).__bwStudio.docJson())).includes('"features":[]'),
);

// --- direct sketch-to-solid flow: line chain -> region -> Press / Pull ----
await welcomePage.click('[data-sktool="line"]');
check('Line is a first-class contextual sketch command',
  (await welcomePage.$eval('[data-sktool="line"]', (el) => el.getAttribute('aria-pressed'))) === 'true');
await welcomePage.evaluate(() => {
  const canvas = document.getElementById('bw-sketch-canvas')!;
  const r = canvas.getBoundingClientRect();
  const point = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width / 2 + x, clientY: r.top + r.height / 2 + y, button: 0, bubbles: true }));
  point(-48, 34);
  point(48, 34);
  point(0, -45);
});
const openProfile = await welcomePage.evaluate(() => ({
  prompt: document.getElementById('bw-cmd-mode')?.textContent,
  region: Boolean(document.getElementById('bw-sk-presspull')),
  doc: (window as unknown as { __bwStudio: { docJson(): string } }).__bwStudio.docJson(),
}));
check('three unclosed points stay an in-progress line chain', /next point/.test(openProfile.prompt || '') && !openProfile.region && openProfile.doc.includes('"features":[]'), JSON.stringify(openProfile));
await welcomePage.keyboard.press('Escape');
check('Escape cancels only the in-progress line chain',
  (await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { mode(): { kind: string } } }).__bwStudio.mode().kind)) === 'sketching' &&
  await welcomePage.$eval('#bw-cmd-mode', (el) => /first point/.test(el.textContent || '')));
await welcomePage.evaluate(() => {
  const canvas = document.getElementById('bw-sketch-canvas')!;
  const r = canvas.getBoundingClientRect();
  const point = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width / 2 + x, clientY: r.top + r.height / 2 + y, button: 0, bubbles: true }));
  point(-48, 34);
  point(48, 34);
  point(0, -45);
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2 - 48, clientY: r.top + r.height / 2 + 34, button: 0, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width / 2 - 48, clientY: r.top + r.height / 2 + 34, button: 0, bubbles: true }));
});
const closedProfile = await welcomePage.evaluate(() => ({
  label: document.getElementById('bw-sk-dims')?.textContent,
  pull: Boolean(document.getElementById('bw-sk-presspull')),
  selectedTool: document.querySelector('[data-sktool][aria-pressed="true"]')?.getAttribute('data-sktool'),
  doc: (window as unknown as { __bwStudio: { docJson(): string } }).__bwStudio.docJson(),
}));
check('clicking the first endpoint closes and recognizes the three-edge region', /Closed region · 3 edges/.test(closedProfile.label || '') && closedProfile.pull && closedProfile.selectedTool === 'select', JSON.stringify(closedProfile));
check('recognized region remains a transactional draft', closedProfile.doc.includes('"features":[]'));
const cameraBeforePull = await welcomePage.evaluate(() =>
  (window as unknown as { __bwStudio: { cameraDir(): number[] } }).__bwStudio.cameraDir(),
);
await welcomePage.click('#bw-sk-presspull');
await welcomePage.waitForSelector('#bw-presspull:not([hidden])');
const pullStarted = await welcomePage.evaluate(() => {
  const studio = (window as unknown as { __bwStudio: { mode(): { kind: string }; pressPullPreviewTriangles(): number } }).__bwStudio;
  return {
    mode: studio.mode().kind,
    triangles: studio.pressPullPreviewTriangles(),
    sketchHidden: (document.getElementById('bw-sketch') as HTMLElement).hidden,
    pullVisible: !(document.getElementById('bw-presspull') as HTMLElement).hidden,
  };
});
check('Press / Pull switches from the 2D editor to a real shaded 3D preview', pullStarted.mode === 'press-pull' && pullStarted.triangles > 0 && pullStarted.sketchHidden && pullStarted.pullVisible, JSON.stringify(pullStarted));
await welcomePage.evaluate(() =>
  (window as unknown as { __bwStudio: { rebuildForTest(): Promise<void> } }).__bwStudio.rebuildForTest(),
);
check('a late committed-document rebuild does not erase the live Press / Pull preview',
  (await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { pressPullPreviewTriangles(): number } }).__bwStudio.pressPullPreviewTriangles())) > 0);
const pullCanvas = await welcomePage.$eval('#bw-studio > canvas', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.72, y: r.top + r.height * 0.7 };
});
const heightBeforeDrag = await welcomePage.$eval('#bw-presspull-h', (el) => Number((el as HTMLInputElement).value));
await welcomePage.mouse.move(pullCanvas.x, pullCanvas.y);
await welcomePage.mouse.down();
await welcomePage.mouse.move(pullCanvas.x, pullCanvas.y - 36, { steps: 4 });
await welcomePage.mouse.up();
const heightAfterDrag = await welcomePage.$eval('#bw-presspull-h', (el) => Number((el as HTMLInputElement).value));
check('dragging the shaded preview changes extrusion distance live', heightAfterDrag > heightBeforeDrag, `${heightBeforeDrag} -> ${heightAfterDrag}`);
await welcomePage.click('#bw-presspull-back');
check('Back to sketch preserves the closed region without committing',
  await welcomePage.$eval('#bw-sketch', (el) => !(el as HTMLElement).hidden) &&
  (await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { docJson(): string } }).__bwStudio.docJson())).includes('"features":[]'));
const cameraAfterBack = await welcomePage.evaluate(() =>
  (window as unknown as { __bwStudio: { cameraDir(): number[] } }).__bwStudio.cameraDir(),
);
check('Back to sketch restores the camera from before Press / Pull',
  cameraAfterBack.every((value, index) => Math.abs(value - cameraBeforePull[index]) < 1e-6),
  `${cameraBeforePull.join(',')} -> ${cameraAfterBack.join(',')}`);
await welcomePage.click('#bw-sk-presspull');
await welcomePage.waitForSelector('#bw-presspull:not([hidden])');
const cameraDuringFinalPull = await welcomePage.evaluate(() =>
  (window as unknown as { __bwStudio: { cameraDir(): number[] } }).__bwStudio.cameraDir(),
);
await welcomePage.$eval('#bw-presspull-h', (el) => {
  (el as HTMLInputElement).value = '12';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  (el as HTMLInputElement).focus();
});
await welcomePage.keyboard.press('Enter');
await waitForStudioPage(welcomePage, { solid: true, idle: true, timeout: 30_000 });
const finishedPull = await welcomePage.evaluate(() => {
  const studio = (window as unknown as { __bwStudio: { docJson(): string; undoDepth(): number; triCount(): number } }).__bwStudio;
  return { doc: studio.docJson(), undo: studio.undoDepth(), triangles: studio.triCount() };
});
check('typed Press / Pull distance commits the triangular solid', finishedPull.doc.includes('"kind":"poly"') && finishedPull.doc.includes('"h":12') && finishedPull.triangles > 0, finishedPull.doc);
check('the entire line-to-solid interaction is one undoable command', finishedPull.undo === 1, `undo depth ${finishedPull.undo}`);
const cameraAfterPull = await welcomePage.evaluate(() =>
  (window as unknown as { __bwStudio: { cameraDir(): number[] } }).__bwStudio.cameraDir(),
);
check('committing Press / Pull keeps the preview camera on the finished solid',
  cameraAfterPull.every((value, index) => Math.abs(value - cameraDuringFinalPull[index]) < 1e-6),
  `${cameraDuringFinalPull.join(',')} -> ${cameraAfterPull.join(',')}`);
await welcomePage.close();

await browser.close();
server.close();
console.log(failures === 0 ? `\nall ${checks} studio checks passed` : `\n${failures} FAILURES across ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
