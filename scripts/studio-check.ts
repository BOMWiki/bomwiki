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
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const newStudioPage = async (showWelcome = false): Promise<Page> => {
  const next = await browser.newPage();
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

// --- ribbon icon system: complete, semantic, and state-stable ------------
const iconAudit = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ws-ribbon .wsr-btn'));
  const icons = buttons.map((button) => button.querySelector<SVGElement>(':scope > .wsr-i > svg.ws-icon'));
  const iconNames = icons.map((icon) => icon?.dataset.icon ?? '');
  const views = Array.from(document.querySelectorAll<SVGElement>('[data-view] svg.ws-icon')).map(
    (icon) => icon.dataset.icon,
  );
  const appIcons = Array.from(document.querySelectorAll<SVGElement>('.ws-app-actions svg.ws-icon'));
  const extrudeIcon = document.querySelector('[data-feat="extrude"] .wsr-i')!;
  return {
    buttonCount: buttons.length,
    complete: icons.every(Boolean),
    noGlyphFallbacks: buttons.every((button) => button.querySelector('.wsr-i')?.textContent === ''),
    uniqueNames: new Set(iconNames).size === iconNames.length,
    views,
    step: document.querySelector<SVGElement>('#bw-export-step svg')?.dataset.icon,
    stl: document.querySelector<SVGElement>('#bw-export-stl svg')?.dataset.icon,
    appComplete:
      appIcons.length === 2 &&
      appIcons.every((icon) => icon.closest('[aria-hidden="true"]') && icon.getAttribute('focusable') === 'false'),
    pressedDecoration: getComputedStyle(extrudeIcon, '::after').content,
  };
});
check('every ribbon command has one inline SVG icon', iconAudit.buttonCount === 23 && iconAudit.complete);
check('ribbon has no operating-system glyph fallbacks', iconAudit.noGlyphFallbacks);
check('ribbon command icons have unique semantic identities', iconAudit.uniqueNames);
check('all five View commands have orientation icons', iconAudit.views.join(',') === 'top,front,right,iso,fit', iconAudit.views.join(','));
check('STEP solid and STL mesh exports have distinct icons', iconAudit.step === 'step' && iconAudit.stl === 'stl');
check('Help and Full screen use hidden SVG icons', iconAudit.appComplete);
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
for (const payload of ['{"nope": true}', '{"features":[null]}', 'not json at all']) {
  const undoBefore = await S<number>('(s) => s.undoDepth()');
  const redoBefore = await S<number>('(s) => s.redoDepth()');
  await openBad(payload);
  await new Promise((r) => setTimeout(r, 600));
  check(`malformed project ${JSON.stringify(payload).slice(0, 24)}…: doc unchanged`, (await S<string>('(s) => s.docJson()')) === beforeBad);
  check('  …and undo/redo stacks untouched', (await S<number>('(s) => s.undoDepth()')) === undoBefore && (await S<number>('(s) => s.redoDepth()')) === redoBefore);
}

// --- clear -> reload stays empty ------------------------------------------
page.on('dialog', (d) => d.accept());
await page.click('#bw-clear');
await new Promise((r) => setTimeout(r, 1200));
check('clear empties the document', (await S<string>('(s) => s.docJson()')).includes('"features":[]'));
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForStudioPage(page, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));
check('reload after clear stays empty (no starter resurrection)', (await S<string>('(s) => s.docJson()')).includes('"features":[]'));

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
check('sketch mode announced', (await SB<string>('(s) => s.mode().kind')) === 'sketching');
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
  // Controllable confirm stub: tests flip the result and count the calls.
  (window as unknown as { __confirmCalls: number }).__confirmCalls = 0;
  (window as unknown as { __confirmResult: boolean }).__confirmResult = true;
  window.confirm = () => {
    (window as unknown as { __confirmCalls: number }).__confirmCalls++;
    return (window as unknown as { __confirmResult: boolean }).__confirmResult;
  };
});
await pageC.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageC, { solid: true });
const SC = async <T>(fn: string): Promise<T> => pageC.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
const confirmCalls = () => pageC.evaluate(() => (window as unknown as { __confirmCalls: number }).__confirmCalls);
const setConfirm = (v: boolean) =>
  pageC.evaluate((r: boolean) => {
    (window as unknown as { __confirmResult: boolean }).__confirmResult = r;
  }, v);

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
check('clean pick -> extrude switches silently', (await confirmCalls()) === callsBefore && (await SC<string>('(s) => s.mode().kind')) === 'choose-face');
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
await setConfirm(false);
const callsBeforeDirty = await confirmCalls();
await pageC.click('[data-feat="fillet"]');
check('dirty draft: switching asks first', (await confirmCalls()) === callsBeforeDirty + 1);
check('dirty draft: declining keeps the sketch open', (await SC<string>('(s) => s.mode().kind')) === 'sketching');
await setConfirm(true);
await pageC.click('[data-feat="fillet"]');
check('dirty draft: accepting switches to the new operation', (await SC<string>('(s) => s.mode().kind')) === 'picking-edges');
await pageC.keyboard.press('Escape');

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
await pageC.click('#bw-clear'); // confirm stub returns true
await new Promise((r) => setTimeout(r, 1200));
check('clear with selection empties the doc', (await SC<string>('(s) => s.docJson()')).includes('"features":[]'));
check('clear with selection hides the context panel', await pageC.$eval('#bw-context-wrap', (el) => (el as HTMLElement).hidden));

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
check('375px: ribbon buttons are 44px touch targets', targets.length > 5 && targets.every((t) => t >= 43.5), targets.join(','));
await pageC.close();

// --- re-review set: field dirty, Clear/Open coordination, ribbon state ----
const pageE = await newStudioPage();
pageE.on('pageerror', (e) => check('no page errors (re-review pass)', false, String(e)));
await pageE.evaluateOnNewDocument(() => {
  localStorage.removeItem('bw-studio-doc-v2');
  localStorage.removeItem('bw-studio-v2-seeded');
  (window as unknown as { __confirmCalls: number }).__confirmCalls = 0;
  (window as unknown as { __confirmResult: boolean }).__confirmResult = true;
  window.confirm = () => {
    (window as unknown as { __confirmCalls: number }).__confirmCalls++;
    return (window as unknown as { __confirmResult: boolean }).__confirmResult;
  };
});
await pageE.goto(URL_, { waitUntil: 'domcontentloaded' });
await waitForStudioPage(pageE, { solid: true });
const SE = async <T>(fn: string): Promise<T> => pageE.evaluate(`(() => (${fn})(window.__bwStudio))()`) as Promise<T>;
const confirmCallsE = () => pageE.evaluate(() => (window as unknown as { __confirmCalls: number }).__confirmCalls);
const setConfirmE = (v: boolean) =>
  pageE.evaluate((r: boolean) => {
    (window as unknown as { __confirmResult: boolean }).__confirmResult = r;
  }, v);

// P1-1: a typed radius alone makes the draft dirty
await pageE.click('[data-feat="fillet"]');
await pageE.click('#bw-pick-r', { count: 3 });
await pageE.keyboard.type('7');
await setConfirmE(false);
let calls = await confirmCallsE();
await pageE.click('[data-feat="chamfer"]');
check('typed radius: switching asks first', (await confirmCallsE()) === calls + 1);
check('typed radius: declining keeps the picker', (await SE<{ kind: string; feat?: string }>('(s) => s.mode()')).feat === 'fillet');
check('typed radius: value survives the decline', await pageE.$eval('#bw-pick-r', (el) => (el as HTMLInputElement).value === '7'));
await setConfirmE(true);
await pageE.keyboard.press('Escape');

// P1-1: a typed sketch height alone makes the draft dirty
await pageE.click('[data-feat="extrude"]');
await pageE.click('#bw-face-base');
await pageE.click('#bw-sk-op-h', { count: 3 });
await pageE.keyboard.type('44');
await setConfirmE(false);
calls = await confirmCallsE();
await pageE.click('[data-feat="fillet"]');
check('typed height: switching asks first', (await confirmCallsE()) === calls + 1);
check('typed height: declining keeps the sketch', (await SE<string>('(s) => s.mode().kind')) === 'sketching');
await setConfirmE(true);

// P1-2: Clear during a dirty sketch asks, declining preserves everything
const docE = await SE<string>('(s) => s.docJson()');
await setConfirmE(false);
calls = await confirmCallsE();
await pageE.click('#bw-clear');
check('Clear during dirty sketch: asks first', (await confirmCallsE()) === calls + 1);
check('Clear during dirty sketch: declining keeps the sketch open', (await SE<string>('(s) => s.mode().kind')) === 'sketching');
check('Clear during dirty sketch: document untouched', (await SE<string>('(s) => s.docJson()')) === docE);
check('Clear declined: typed value survives', await pageE.$eval('#bw-sk-op-h', (el) => (el as HTMLInputElement).value === '44'));
// accepting cancels the editor and empties the document
await setConfirmE(true);
calls = await confirmCallsE();
await pageE.click('#bw-clear');
await new Promise((r) => setTimeout(r, 1200));
check('Clear accepted: one atomic confirmation', (await confirmCallsE()) === calls + 1);
check('Clear accepted: editor closed', (await SE<string>('(s) => s.mode().kind')) === 'idle' && (await pageE.$eval('#bw-sketch', (el) => (el as HTMLElement).hidden)));
check('Clear accepted: document empty', (await SE<string>('(s) => s.docJson()')).includes('"features":[]'));

// P1-2: Open during a clean editor cancels it and loads the project
await pageE.click('[data-feat="extrude"]'); // empty doc -> sketch directly
await pageE.waitForSelector('#bw-sketch:not([hidden])');
calls = await confirmCallsE();
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
check('brand-new project shows Start with a sketch', shell.welcomeVisible);
check('first-run screen has three concrete project choices', (await welcomePage.$$('.ws-welcome-actions button')).length === 3);
const welcomeHelpHit = await welcomePage.$eval('#bw-welcome-help', (el) => {
  const r = el.getBoundingClientRect();
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
});
check('first-run Help control is a reachable hit target', welcomeHelpHit);
await welcomePage.$eval('#bw-welcome-help', (el) => (el as HTMLButtonElement).click());
check('Help opens inside the application', await welcomePage.$eval('#bw-help', (el) => (el as HTMLDialogElement).open));
await welcomePage.$eval('#bw-help-close', (el) => (el as HTMLButtonElement).click());
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
await welcomePage.$eval('#bw-welcome-start', (el) => (el as HTMLButtonElement).click());
await welcomePage.waitForSelector('#bw-sketch:not([hidden])');
check(
  'Start sketch opens a blank Extrude sketch',
  (await welcomePage.evaluate(() => (window as unknown as { __bwStudio: { docJson(): string } }).__bwStudio.docJson())).includes('"features":[]'),
);
await welcomePage.$eval('#bw-sk-cancel', (el) => (el as HTMLButtonElement).click());
await welcomePage.close();

await browser.close();
server.close();
console.log(failures === 0 ? '\nall studio checks passed' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
