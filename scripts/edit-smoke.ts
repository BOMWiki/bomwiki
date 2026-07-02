// End-to-end smoke test of the edit loop against a running engine, as an
// admin (trust ladder: admin proposals auto-apply). Pending-queue gating for
// new contributors is covered by community-smoke.ts. Leaves the database as
// it was found.
const BASE = process.env.ENGINE_URL ?? 'http://localhost:4400';
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const NODE = process.env.SMOKE_NODE ?? 'hv-battery-pack';

let cookie = '';
let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie },
  });
}

async function propose(edits: unknown[]): Promise<{ status: number; body: any }> {
  const res = await req('/api/changesets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits }),
  });
  return { status: res.status, body: await res.json() };
}

async function pageData(id: string): Promise<{ rev: number; data: any; html: string }> {
  const html = await (await req(`/item/${id}/`)).text();
  const m = html.match(/<script type="application\/json" id="bw-edit-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no edit data on /item/${id}/`);
  const parsed = JSON.parse(m[1]);
  return { rev: parsed.rev, data: parsed.data, html };
}

// --- login ---
const loginRes = await fetch(`${BASE}/login`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `token=${encodeURIComponent(TOKEN)}`,
});
cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
check('login sets session', loginRes.status === 303 && cookie.startsWith('bw_sess='));

// --- snapshot the starting state ---
const before = await pageData(NODE);
const origQty = before.data.bom[0].qty;
const newQty = origQty + 3;
const newPartName = `Smoke Test Washer ${Date.now() % 100000}`;
const newPartId = newPartName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// --- propose as admin: applies immediately (trust ladder) ---
const proposed = JSON.parse(JSON.stringify(before.data));
proposed.bom[0].qty = newQty;
proposed.bom.push({ id: newPartId, qty: 6, note: 'smoke test line' });
const a = await propose([
  { op: 'create', nodeId: newPartId, data: { name: newPartName, kind: 'part' } },
  { op: 'edit', nodeId: NODE, baseRev: before.rev, data: proposed },
]);
check('admin propose auto-applies', a.status === 201 && a.body.applied === true, JSON.stringify(a.body));

const after = await pageData(NODE);
check('page shows new qty', after.data.bom[0].qty === newQty);
check('page rev advanced', after.rev > before.rev);
check('new part page exists', (await req(`/item/${newPartId}/`)).status === 200);
check('new part in rendered BOM', after.html.includes(newPartId));

// --- invalid edits still rejected (422, not 500) ---
const bad = await propose([
  { op: 'edit', nodeId: NODE, baseRev: after.rev, data: { ...proposed, bom: [{ id: 'does-not-exist-xyz', qty: 0.5 }] } },
]);
check('invalid edit rejected (422)', bad.status === 422);

// --- malformed payloads are 422, never 500 (review-fix regressions) ---
const noData = await propose([{ op: 'edit', nodeId: NODE, baseRev: after.rev }]);
check('edit missing data → 422', noData.status === 422, `got ${noData.status}`);
const badOp = await propose([{ op: 'frobnicate', nodeId: NODE, baseRev: after.rev, data: proposed }]);
check('unknown op → 422', badOp.status === 422, `got ${badOp.status}`);
const dupCreate = await propose([
  { op: 'create', nodeId: NODE, data: { name: 'X', kind: 'part' } },
]);
check('create of existing id → 422 (not 500)', dupCreate.status === 422, `got ${dupCreate.status}`);
const badParent = await fetch(`${BASE}/item/${NODE}/talk`, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'body=hi&parent_id=abc',
});
check('non-numeric talk parent_id → 422 (not 500)', badParent.status === 422, `got ${badParent.status}`);
const emptyLimit = await (await req('/api/search?q=motor&limit=')).json();
check('empty search limit falls back, not empty', Array.isArray(emptyLimit) && emptyLimit.length > 0);

// --- history ---
const histHtml = await (await req(`/item/${NODE}/history`)).text();
check('history lists new revision', histHtml.includes(`r${after.rev}`));
check('history has semantic summary', histHtml.includes(`quantity ${origQty} → ${newQty}`));
const oldView = await (await req(`/item/${NODE}/rev/${before.rev}`)).text();
check('old revision view has banner', oldView.includes(`viewing r${before.rev}`));

// --- stale base + non-overlapping change merges cleanly ---
const mergeable = JSON.parse(JSON.stringify(before.data));
mergeable.bom[1].note = 'merged note from a concurrent editor';
const m = await propose([{ op: 'edit', nodeId: NODE, baseRev: before.rev, data: mergeable }]);
check('non-overlapping stale change merges on apply', m.status === 201 && m.body.applied === true, JSON.stringify(m.body));
const merged = await pageData(NODE);
check('merge kept the earlier qty change', merged.data.bom[0].qty === newQty);
check('merge kept the added line', merged.data.bom.some((l: any) => l.id === newPartId));
check('merge applied the note change', merged.data.bom[1].note === 'merged note from a concurrent editor');
check('history marks the merge', (await (await req(`/item/${NODE}/history`)).text()).includes('(merged over r'));

// --- stale base + overlapping change is a conflict: stays pending ---
const conflicting = JSON.parse(JSON.stringify(before.data));
conflicting.bom[0].qty = newQty + 5;
const c = await propose([{ op: 'edit', nodeId: NODE, baseRev: before.rev, data: conflicting }]);
check('conflicting change not auto-applied', c.status === 201 && c.body.applied === false, JSON.stringify(c.body));
const queueHtml = await (await req('/review')).text();
check('conflicting change waits in queue', queueHtml.includes(`Change #${c.body.id}`));
const rejectRes = await req(`/review/${c.body.id}/reject`, { method: 'POST' });
check('conflict rejected', rejectRes.status === 303);

// --- verification: banner, reviewer flow, earned indexability ---
const PRODUCT = 'ev-car';
const prodBefore = await (await req(`/item/${PRODUCT}/`)).text();
const wasVerification = prodBefore.match(/vf-tag vf-([a-z-]+)/)?.[1] ?? 'unverified';
check('unverified/machine-checked page shows banner', prodBefore.includes('vf-banner'));
check('page is noindex before human verification', prodBefore.includes('noindex'));
const verifyRes = await req(`/item/${PRODUCT}/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'status=human-verified&note=smoke%20test%20verification',
});
check('reviewer sets human-verified', verifyRes.status === 303);
const prodAfter = await (await req(`/item/${PRODUCT}/`)).text();
check('verified page drops the banner', !prodAfter.includes('vf-banner'));
check('verified product becomes indexable', !prodAfter.includes('noindex'));
check('infobox shows verified status', prodAfter.includes('vf-human-verified'));
await req(`/item/${PRODUCT}/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `status=${wasVerification}&note=smoke%20reset`,
});
const prodReset = await (await req(`/item/${PRODUCT}/`)).text();
check('verification reset', prodReset.includes(`vf-${wasVerification}`));

// --- revert restores the original state ---
const revertRes = await req(`/item/${NODE}/revert/${before.rev}`, { method: 'POST' });
check('revert redirects', revertRes.status === 303);
const restored = await pageData(NODE);
check('qty restored', restored.data.bom[0].qty === origQty);
check('smoke line gone', !restored.data.bom.some((l: any) => l.id === newPartId));
check('merged note gone', (restored.data.bom[1].note ?? '') === (before.data.bom[1].note ?? ''));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
