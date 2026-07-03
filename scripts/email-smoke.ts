// Email + richer-profile smoke: settings email preferences, the profile
// website field, the contributors page, one-click unsubscribe, and the
// digest builder. Needs a running engine plus direct database access —
// the mailer is unconfigured in dev, so email behavior is verified at the
// database and builder level, not by delivery.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildDigest } from '../src/emails.ts';

const BASE = process.env.ENGINE_URL ?? 'http://localhost:4400';
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';
const NODE = process.env.SMOKE_NODE ?? 'battery-module';

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev',
});
await db.connect();

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

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

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
  const res = await anon.req('/auth/request', form({ email, handle }));
  const html = await res.text();
  const link = html.match(/href="(\/auth\/[a-f0-9]{48})"/)?.[1];
  check(`magic link issued for ${handle}`, Boolean(link));
  const authRes = await anon.req(link!);
  check(`${handle} signed in`, authRes.status === 303);
  return anon;
}

const stamp = Date.now() % 1000000;
const admin = client();
const loginRes = await admin.req('/login', form({ token: TOKEN }));
check('admin login', loginRes.status === 303);

const carolHandle = `carol-${stamp}`;
const daveHandle = `dave-${stamp}`;
const carol = await signup(`${carolHandle}@example.com`, carolHandle);
const dave = await signup(`${daveHandle}@example.com`, daveHandle);
const carolId = Number(
  (await db.query('select id from users where handle = $1', [carolHandle])).rows[0].id,
);
const daveId = Number(
  (await db.query('select id from users where handle = $1', [daveHandle])).rows[0].id,
);

// --- welcome is claim-gated, and inert without a mailer ---
const welcomed = await db.query('select welcomed_at from users where handle = $1', [carolHandle]);
check('welcome not claimed with mailer off', welcomed.rows[0].welcomed_at === null);

// --- settings: email section and defaults ---
let settingsHtml = await (await carol.req('/settings')).text();
check('settings shows email section', settingsHtml.includes('Weekly digest'));
check('digest defaults on', /name="digest"[^>]*checked/.test(settingsHtml));
check('decision notice defaults on', /name="decisions"[^>]*checked/.test(settingsHtml));

// --- profile: website kept when valid, dropped when not ---
await carol.req(
  '/settings',
  form({ displayName: 'Carol', affiliation: '', website: 'https://example.com/carol', bio: 'I fix quantities.' }),
);
let profileHtml = await (await admin.req(`/user/${carolHandle}`)).text();
check(
  'profile shows website with nofollow',
  profileHtml.includes('href="https://example.com/carol"') && profileHtml.includes('nofollow ugc'),
);
check('profile shows bio', profileHtml.includes('I fix quantities.'));
await carol.req(
  '/settings',
  form({ displayName: 'Carol', affiliation: '', website: 'javascript:alert(1)', bio: 'I fix quantities.' }),
);
profileHtml = await (await admin.req(`/user/${carolHandle}`)).text();
check('non-http website is dropped', !profileHtml.includes('javascript:alert'));

// --- email preferences round-trip ---
await carol.req('/settings/email', form({ replies: 'on' }));
settingsHtml = await (await carol.req('/settings')).text();
check('digest unchecked after save', !/name="digest"[^>]*checked/.test(settingsHtml));
check('replies still checked', /name="replies"[^>]*checked/.test(settingsHtml));
const prefs = await db.query(
  'select digest, notify_decisions, notify_replies from users where id = $1',
  [carolId],
);
check(
  'preferences persisted',
  prefs.rows[0].digest === 'off' && prefs.rows[0].notify_decisions === false && prefs.rows[0].notify_replies === true,
  JSON.stringify(prefs.rows[0]),
);
await carol.req('/settings/email', form({ digest: 'weekly', decisions: 'on', replies: 'on' }));

// --- one-click unsubscribe by token ---
const token = randomBytes(24).toString('hex');
await db.query('update users set email_token = $2 where id = $1', [carolId, token]);
const unsubGet = await admin.req(`/email/unsubscribe/${token}`);
check('unsubscribe page confirms', unsubGet.status === 200 && (await unsubGet.text()).includes('You are unsubscribed'));
const afterUnsub = await db.query(
  'select digest, notify_decisions, notify_replies from users where id = $1',
  [carolId],
);
check(
  'unsubscribe turns everything off',
  afterUnsub.rows[0].digest === 'off' && afterUnsub.rows[0].notify_decisions === false && afterUnsub.rows[0].notify_replies === false,
);
const unsubPost = await client().req(`/email/unsubscribe/${token}`, { method: 'POST' });
check('one-click POST answers plainly', unsubPost.status === 200 && (await unsubPost.text()) === 'unsubscribed');
const badToken = await admin.req(`/email/unsubscribe/${'f'.repeat(48)}`);
check('unknown token is 404', badToken.status === 404);
await carol.req('/settings/email', form({ digest: 'weekly', decisions: 'on', replies: 'on' }));

// --- watch + accepted edit -> digest content ---
const start = await pageData(admin, NODE);
const origNote = start.data.bom[0].note ?? '';
const watchRes = await carol.req(`/item/${NODE}/watch`, { method: 'POST' });
check('carol watches the node', watchRes.status === 303);
const cur = await pageData(dave, NODE);
const edited = JSON.parse(JSON.stringify(cur.data));
edited.bom[0].note = `email smoke ${stamp}`;
const proposed = await propose(dave, [{ op: 'edit', nodeId: NODE, baseRev: cur.rev, data: edited }]);
check('dave proposes a change', proposed.status === 201, JSON.stringify(proposed.body));
const acceptRes = await admin.req(`/review/${proposed.body.id}/accept`, { method: 'POST' });
check('admin accepts (decision hook does not break accept)', acceptRes.status === 303);

const digest = await buildDigest(carolId, new Date(Date.now() - 3600e3).toISOString());
check('digest built for watcher', digest !== null);
check('digest subject leads with the watchlist', Boolean(digest?.subject.includes('you watch')), digest?.subject);
check('digest lists the watched page', Boolean(digest?.text.includes(`/item/${NODE}/`)));
check('digest carries the site pulse', Boolean(digest?.text.includes('AROUND THE SITE')));

const daveDigest = await buildDigest(daveId, new Date(Date.now() - 3600e3).toISOString());
check('author digest reports their edits', Boolean(daveDigest?.text.includes('YOUR EDITS')));
const emptyDigest = await buildDigest(daveId, new Date(Date.now() + 60_000).toISOString());
check('quiet window builds no digest', emptyDigest === null);

// --- reply hook survives without a mailer ---
const topicRes = await carol.req(`/item/${NODE}/talk`, form({ body: `smoke topic ${stamp}` }));
check('carol posts a topic', topicRes.status === 303);
const topicId = (
  await db.query('select id from comments where author_id = $1 order by id desc limit 1', [carolId])
).rows[0].id;
const replyRes = await dave.req(
  `/item/${NODE}/talk`,
  form({ parent_id: String(topicId), body: 'smoke reply' }),
);
check('dave replies (reply hook does not break posting)', replyRes.status === 303);

// --- self-authored user page ---
const pageMd = `## Who I am\n\nPump engineer. <script>alert(1)</script>\n\n- [[battery-module]]\n- [[no-such-node-${stamp}]]`;
const pageSave = await carol.req(`/user/${carolHandle}/page`, form({ page: pageMd }));
check('user page saves', pageSave.status === 303);
profileHtml = await (await admin.req(`/user/${carolHandle}`)).text();
check('user page renders markdown heading', profileHtml.includes('Who I am'));
check('user page script is sanitized away', !profileHtml.includes('<script>alert'));
check('user page resolves wiki-links', profileHtml.includes(`href="/item/battery-module/"`));
check('user page red-links missing nodes', profileHtml.includes('redlink'));
const strangerEdit = await dave.req(`/user/${carolHandle}/page`);
check('stranger cannot open the editor', strangerEdit.status === 303);
const strangerSave = await dave.req(`/user/${carolHandle}/page`, form({ page: 'vandalism' }));
check('stranger cannot save', strangerSave.status === 303);
profileHtml = await (await admin.req(`/user/${carolHandle}`)).text();
check('stranger save did not stick', !profileHtml.includes('vandalism'));
const clearSave = await carol.req(`/user/${carolHandle}/page`, form({ page: '   ' }));
check('blank save clears the page', clearSave.status === 303);
profileHtml = await (await carol.req(`/user/${carolHandle}`)).text();
check('cleared page shows the invitation again', profileHtml.includes('write an about page'));

// --- profile extras and contributors ---
profileHtml = await (await admin.req(`/user/${carolHandle}`)).text();
check('profile counts discussion posts', /<b>1<\/b> discussion posts/.test(profileHtml));
const contribHtml = await (await admin.req('/contributors')).text();
check('contributors lists dave after his accepted edit', contribHtml.includes(daveHandle));

// --- nothing was emailed and nothing was logged (mailer off) ---
const logged = await db.query('select count(*)::int as n from email_log where user_id = any($1)', [
  [carolId, daveId],
]);
check('no email logged with mailer off', logged.rows[0].n === 0);

// --- restore the node ---
const restoreCur = await pageData(admin, NODE);
const restored = JSON.parse(JSON.stringify(restoreCur.data));
restored.bom[0].note = origNote || undefined;
if (!origNote) delete restored.bom[0].note;
const restoreRes = await propose(admin, [
  { op: 'edit', nodeId: NODE, baseRev: restoreCur.rev, data: restored },
]);
check('node restored', restoreRes.status === 201 && restoreRes.body.applied === true);

await db.end();
console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
