// Milestone-3 smoke test: accounts, trust ladder, discussions, recent
// changes, profiles, watchlist, and the pending cap. Needs a running engine.
// Creates throwaway users; reverts content changes at the end.
const BASE = process.env.ENGINE_URL ?? 'http://localhost:4400';
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const NODE = process.env.SMOKE_NODE ?? 'battery-module';
const AUTOCONFIRM = Number(process.env.AUTOCONFIRM_EDITS ?? 4);

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function client(cookie = '') {
  const jar = { cookie };
  return {
    jar,
    async req(path: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers ?? {}), cookie: jar.cookie },
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith('bw_sess=') && !set.includes('Max-Age=0')) jar.cookie = set.split(';')[0];
      return res;
    },
  };
}

type Client = ReturnType<typeof client>;

async function pageData(c: Client, id: string): Promise<{ rev: number; data: any }> {
  const html = await (await c.req(`/item/${id}/`)).text();
  const m = html.match(/id="bw-edit-data">([\s\S]*?)<\/script>/);
  return JSON.parse(m![1]);
}

async function propose(c: Client, edits: unknown[]): Promise<{ status: number; body: any }> {
  const res = await c.req('/api/changesets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits }),
  });
  return { status: res.status, body: await res.json() };
}

async function signup(email: string, handle: string): Promise<Client> {
  const anon = client();
  const res = await anon.req('/auth/request', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&handle=${encodeURIComponent(handle)}`,
  });
  const html = await res.text();
  const link = html.match(/href="(\/auth\/[a-f0-9]{48})"/)?.[1];
  check(`magic link issued for ${handle}`, Boolean(link));
  // The link is only shown because dev mode is on; the page must say so, which
  // is the guard that keeps it from ever rendering in production.
  check('magic link is dev-gated', html.includes('Development mode'));
  const authRes = await anon.req(link!);
  check(`magic link signs ${handle} in`, authRes.status === 303 && anon.jar.cookie.startsWith('bw_sess='));
  const again = await anon.req(link!);
  check('magic link is single-use', again.status === 403);
  return anon;
}

const stamp = Date.now() % 1000000;
const admin = client();

// --- admin login ---
const loginRes = await admin.req('/login', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `token=${encodeURIComponent(TOKEN)}`,
});
check('admin login', loginRes.status === 303);

// --- signup and gated editing ---
const alice = await signup(`alice-${stamp}@example.com`, `alice-${stamp}`);
const session = await (await alice.req('/api/session')).json();
check('session has handle', session.handle === `alice-${stamp}`);

const start = await pageData(admin, NODE);
const origNote = start.data.bom[0].note ?? '';

async function proposeNoteChange(c: Client, i: number): Promise<{ status: number; body: any }> {
  const cur = await pageData(c, NODE);
  const data = JSON.parse(JSON.stringify(cur.data));
  data.bom[0].note = `community smoke pass ${i}`;
  return propose(c, [{ op: 'edit', nodeId: NODE, baseRev: cur.rev, data }]);
}

const first = await proposeNoteChange(alice, 1);
check('new contributor gated to pending', first.status === 201 && first.body.applied === false, JSON.stringify(first.body));
const unchanged = await pageData(admin, NODE);
check('page unchanged while pending', (unchanged.data.bom[0].note ?? '') === origNote);
const reviewAsAlice = await alice.req('/review');
check(
  'contributor cannot review, told why',
  reviewAsAlice.status === 403 && (await reviewAsAlice.text()).includes('Reviewers only'),
  `status ${reviewAsAlice.status}`,
);

// --- climb the trust ladder ---
let accepted = 0;
let acceptRes = await admin.req(`/review/${first.body.id}/accept`, { method: 'POST' });
check('admin accepts first change', acceptRes.status === 303 && !decodeURIComponent(acceptRes.headers.get('location') ?? '').includes('conflict'));
accepted++;
while (accepted < AUTOCONFIRM) {
  const p = await proposeNoteChange(alice, accepted + 1);
  if (p.body.applied) break;
  acceptRes = await admin.req(`/review/${p.body.id}/accept`, { method: 'POST' });
  accepted++;
}
check(`${AUTOCONFIRM} changes accepted`, accepted === AUTOCONFIRM);
const auto = await proposeNoteChange(alice, 99);
check('autoconfirmed edit publishes instantly', auto.status === 201 && auto.body.applied === true, JSON.stringify(auto.body));
const nowLive = await pageData(admin, NODE);
check('page shows the instant edit', nowLive.data.bom[0].note === 'community smoke pass 99');

// --- profile and recent changes ---
const profileHtml = await (await admin.req(`/user/alice-${stamp}`)).text();
check('profile page exists', profileHtml.includes(`alice-${stamp}`));
check('profile counts accepted edits', /<b>5<\/b> accepted/.test(profileHtml));
const changesHtml = await (await admin.req('/changes')).text();
check('recent changes attributes the author', changesHtml.includes(`alice-${stamp}`));
check('recent changes shows the summary', changesHtml.includes('note updated'));

// --- create a new page from scratch ---
// alice is autoconfirmed by now (5 accepted), so her create applies live.
const newId = `smoke-widget-${stamp}`;
const childId = `smoke-part-${stamp}`;
const createRes = await propose(alice, [
  { op: 'create', nodeId: childId, data: { name: 'Smoke Test Part', kind: 'part' } },
  {
    op: 'create',
    nodeId: newId,
    data: {
      name: 'Smoke Test Widget',
      kind: 'product',
      domain: 'automobiles',
      summary: 'Created by the smoke test.',
      bom: [{ id: childId, qty: 2 }],
    },
  },
]);
check('create page applies for autoconfirmed author', createRes.status === 201 && createRes.body.applied === true, JSON.stringify(createRes.body));
const newPage = await (await admin.req(`/item/${newId}/`)).text();
check('new page is live', newPage.includes('Smoke Test Widget'));
check('new page shows its inline-created child', newPage.includes('Smoke Test Part'));
const productsHtml = await (await admin.req('/products')).text();
check('new product appears in its domain listing', productsHtml.includes(newId));
const dupCreate = await propose(alice, [
  { op: 'create', nodeId: newId, data: { name: 'Dup', kind: 'product' } },
]);
check('duplicate id is rejected', dupCreate.status === 422 && JSON.stringify(dupCreate.body).includes('already exists'));

// --- settings feed the public profile ---
await alice.req('/settings', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'displayName=Alice%20Smoke&affiliation=Example%20Bearings%20GmbH&bio=I%20count%20washers.',
});
const profile2 = await (await admin.req(`/user/alice-${stamp}`)).text();
check('display name public', profile2.includes('Alice Smoke'));
check('affiliation public', profile2.includes('Example Bearings GmbH'));

// --- discussion ---
await alice.req(`/item/${NODE}/talk`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'body=Should%20the%20busbars%20be%20counted%20per%20module%3F',
});
let talkHtml = await (await admin.req(`/item/${NODE}/talk`)).text();
check('topic posted', talkHtml.includes('Should the busbars be counted per module?'));
const topicId = talkHtml.match(/\/talk\/(\d+)\/resolve/)?.[1];
await admin.req(`/item/${NODE}/talk`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `parent_id=${topicId}&body=Yes%2C%20per%20module%20is%20the%20convention.`,
});
talkHtml = await (await admin.req(`/item/${NODE}/talk`)).text();
check('reply posted', talkHtml.includes('per module is the convention'));
const resolveRes = await admin.req(`/talk/${topicId}/resolve`, { method: 'POST' });
check('reviewer resolves topic', resolveRes.status === 303);
talkHtml = await (await admin.req(`/item/${NODE}/talk`)).text();
check('topic shows resolved', talkHtml.includes('resolved'));

// --- watchlist ---
await alice.req(`/item/${NODE}/watch`, { method: 'POST' });
const watchHtml = await (await alice.req('/watchlist')).text();
check('watchlist shows watched node revisions', watchHtml.includes(`/item/${NODE}/`) && watchHtml.includes('note updated'));

// --- comment spam controls for a fresh account ---
const bob = await signup(`bob-${stamp}@example.com`, `bob-${stamp}`);
const spamComment = await bob.req(`/item/${NODE}/talk`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `body=${encodeURIComponent('buy https://a.example https://b.example https://c.example')}`,
});
check('new-account comment with 3 links refused', spamComment.status === 422);
let commentCapped = false;
for (let i = 0; i < 11; i++) {
  const c = await bob.req(`/item/${NODE}/talk`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `body=${encodeURIComponent('comment pass ' + i)}`,
  });
  if (c.status === 422) {
    commentCapped = (await c.json()).error?.includes('rate limit');
    break;
  }
}
check('comment hourly cap enforced', commentCapped);

// --- pending cap for a fresh account ---
const pendingIds: number[] = [];
let capped = false;
for (let i = 0; i < 11; i++) {
  const p = await proposeNoteChange(bob, 200 + i);
  if (p.status === 422) {
    capped = String(p.body.errors).includes('waiting for review');
    break;
  }
  pendingIds.push(p.body.id);
}
check('pending cap enforced at 10', capped && pendingIds.length === 10, `${pendingIds.length} pending`);

// --- block: bob's session dies, his pending queue empties ---
const blockRes = await admin.req(`/admin/user/bob-${stamp}/block`, { method: 'POST' });
check('admin blocks account', blockRes.status === 303);
const bobSession = await (await bob.req('/api/session')).json();
check('blocked session is dead', !bobSession.handle);
const queueAfterBlock = await (await admin.req('/review')).text();
check(
  'blocking rejected the pending queue entries',
  !pendingIds.some((id) => queueAfterBlock.includes(`Change #${id}`)),
);
const profileHtml3 = await (await admin.req(`/user/bob-${stamp}`)).text();
check('profile shows blocked badge', profileHtml3.includes('blocked'));

// --- mass-revert: one action undoes alice's live edits ---
const beforeRevert = await pageData(admin, NODE);
check('alice edit is live before mass-revert', beforeRevert.data.bom[0].note === 'community smoke pass 99');
const mr = await admin.req(`/admin/user/alice-${stamp}/mass-revert`, { method: 'POST' });
check('mass-revert redirects', mr.status === 303);
const afterRevert = await pageData(admin, NODE);
check('mass-revert restored pre-alice content', (afterRevert.data.bom[0].note ?? '') === origNote);
const end = await pageData(admin, NODE);
check('note back to original', (end.data.bom[0].note ?? '') === origNote);

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
