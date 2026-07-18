// The BOMwiki engine server: plain node:http, no framework. Read path from
// the in-memory graph; write path (propose -> review -> apply) from
// milestone 2. Auth is a single admin session until milestone 3.
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageFor, PUBLIC_DIR } from './images.ts';
import { ffsQuery, productsUsing } from './graphdb.ts';
import { adminDashPage } from './render/admin.ts';
import { DOMAINS, initDomains, setDomains, type Domain } from './domains.ts';
import { isIndexableNode } from './seo.ts';
import { domainPage } from './render/domain.ts';
import { homePage, productsPage } from './render/home.ts';
import { searchPage } from './render/search.ts';
import {
  aboutPage,
  enginePage,
  governancePage,
  helpEditingPage,
  intelligencePage,
  policiesPage,
  projectPage,
  verificationPage,
} from './render/static-pages.ts';
import {
  getSession,
  login,
  logout,
  requestMagicLink,
  verifyMagicLink,
  type Session,
} from './auth.ts';
import {
  decideChangeset,
  getChangeset,
  isAutoconfirmed,
  listPending,
  massRevert,
  pendingIdsForNode,
  proposeChangeset,
  revertNode,
  withdrawChangeset,
  type ProposedEdit,
} from './changesets.ts';
import {
  addComment,
  contributionsOf,
  contributionStats,
  getUserByHandle,
  listContributors,
  profileExtras,
  recentChanges,
  setProfilePage,
  setBlocked,
  setRole,
  setTopicResolved,
  toggleWatch,
  topicsFor,
  updateProfile,
  watchlistFeed,
} from './community.ts';
import {
  getEmailPrefs,
  notifyModelDecision,
  notifyReply,
  sendWelcome,
  setEmailPrefs,
  startDigestTicker,
  unsubscribeByToken,
} from './emails.ts';
import {
  createSubmission,
  decideSubmission,
  fileAccess,
  listModeledItems,
  listPendingSubmissions,
  MODEL_MIME,
  modelFilePath,
  modelForNode,
  myPendingForNode,
  receiveUpload,
  withdrawSubmission,
  type ModelExt,
} from './models.ts';
import { cadHubPage, modelUploadPage } from './render/models.ts';
import {
  changesPage,
  contributorsPage,
  HOME_TALK,
  homepageAdminPage,
  newPagePage,
  profilePage,
  profilePageEditor,
  settingsPage,
  signinPage,
  talkPage,
  talkSubjectForNode,
  unsubscribePage,
  watchlistPage,
  type TalkSubject,
} from './render/community.ts';
import { getSetting, setSetting, settingMeta } from './site-settings.ts';
import { pool } from './db.ts';
import { esc, stripNul } from './html.ts';
import {
  allNodes,
  children,
  getNode,
  lineCount,
  loadGraph,
  nodeCount,
  productList,
  productsByDomain,
  redirectOf,
  searchNodes,
  setRedirectInMemory,
  setVerificationInMemory,
  totalCatalogParts,
  totalParts,
  type Verification,
} from './nodes.ts';
import { scanPage } from './render/scan.ts';
import { page } from './render/base.ts';
import { historyPage, type RevisionRow } from './render/history.ts';
import { itemPage } from './render/item.ts';
import { changesetPage, reviewPage } from './render/review.ts';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev';
const PORT = Number(process.env.PORT ?? 4400);

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, body: string, status = 200): void {
  send(res, status, 'text/html; charset=utf-8', body);
}

// Read pages carry no per-session HTML (session-aware chrome is filled in by a
// client fetch), so they are identical for every visitor and safe to cache at
// the edge. Short TTL + stale-while-revalidate keeps edits appearing quickly
// while letting a CDN absorb read traffic instead of the single Node process.
function sendCacheableHtml(res: http.ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=60, stale-while-revalidate=86400',
  });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json', JSON.stringify(value));
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(303, { location: to });
  res.end();
}

// For URL canonicalization (trailing slash, retired routes, renamed pages).
// 301 tells crawlers the move is permanent so ranking signal consolidates on
// the target; the 303 helper above stays for POST-redirect-GET flows.
function redirectPermanent(res: http.ServerResponse, to: string): void {
  res.writeHead(301, { location: to });
  res.end();
}

function notFound(res: http.ServerResponse, id?: string): void {
  sendHtml(
    res,
    page({
      title: 'Not found | BOMwiki',
      description: 'This page does not exist.',
      path: '/404',
      indexable: false,
      body: `<p>Nothing here${id ? ` for <code>${esc(id)}</code>` : ''}. <a href="/">Back to the catalog</a>.</p>`,
    }),
    404,
  );
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Scan images are JPEG data URLs, far over readBody's cap for text forms.
async function readBodyLimited(req: http.IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const PHOTO_BOM_URL = process.env.PHOTO_BOM_URL ?? 'http://127.0.0.1:8791/api/photo-bom';

// Every scan is a paid vision-model call, so the proxy is rate limited on
// two levels: a per-IP allowance for fairness, and a global hourly budget
// that bounds worst-case spend even from a distributed abuser (who could
// also spoof cf-connecting-ip when hitting the origin directly).
const SCAN_IP_LIMIT = Number(process.env.SCAN_IP_LIMIT ?? 12); // per IP per window
const SCAN_IP_WINDOW_MS = 10 * 60_000;
const SCAN_GLOBAL_LIMIT = Number(process.env.SCAN_GLOBAL_LIMIT ?? 300); // per hour, all IPs
const scanByIp = new Map<string, { count: number; windowStart: number }>();
let scanGlobal = { count: 0, windowStart: 0 };

function clientIp(req: http.IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function scanAllowed(req: http.IncomingMessage): boolean {
  const now = Date.now();
  if (now - scanGlobal.windowStart > 3_600_000) scanGlobal = { count: 0, windowStart: now };
  if (scanGlobal.count >= SCAN_GLOBAL_LIMIT) return false;
  // Windows are long, so a sweep on each call keeps the map from growing
  // unbounded without needing a timer.
  if (scanByIp.size > 10_000) {
    for (const [ip, entry] of scanByIp) if (now - entry.windowStart > SCAN_IP_WINDOW_MS) scanByIp.delete(ip);
  }
  const ip = clientIp(req);
  const entry = scanByIp.get(ip);
  if (!entry || now - entry.windowStart > SCAN_IP_WINDOW_MS) {
    scanByIp.set(ip, { count: 1, windowStart: now });
  } else if (entry.count >= SCAN_IP_LIMIT) {
    return false;
  } else {
    entry.count++;
  }
  scanGlobal.count++;
  return true;
}

// Model uploads write real bytes to disk, so they get the same two-level
// limiter shape as scans: per-IP fairness plus a global cap that bounds
// worst-case disk churn. Submissions are additionally rate limited per user
// in createSubmission.
const MODEL_IP_LIMIT = Number(process.env.MODEL_IP_LIMIT ?? 10); // per IP per window
const MODEL_IP_WINDOW_MS = 10 * 60_000;
const MODEL_GLOBAL_LIMIT = Number(process.env.MODEL_GLOBAL_LIMIT ?? 200); // per hour, all IPs
const modelByIp = new Map<string, { count: number; windowStart: number }>();
let modelGlobal = { count: 0, windowStart: 0 };

function modelUploadAllowed(req: http.IncomingMessage): boolean {
  const now = Date.now();
  if (now - modelGlobal.windowStart > 3_600_000) modelGlobal = { count: 0, windowStart: now };
  if (modelGlobal.count >= MODEL_GLOBAL_LIMIT) return false;
  if (modelByIp.size > 10_000) {
    for (const [ip, entry] of modelByIp)
      if (now - entry.windowStart > MODEL_IP_WINDOW_MS) modelByIp.delete(ip);
  }
  const ip = clientIp(req);
  const entry = modelByIp.get(ip);
  if (!entry || now - entry.windowStart > MODEL_IP_WINDOW_MS) {
    modelByIp.set(ip, { count: 1, windowStart: now });
  } else if (entry.count >= MODEL_IP_LIMIT) {
    return false;
  } else {
    entry.count++;
  }
  modelGlobal.count++;
  return true;
}

// Catalog snapshot for the photo-BOM scanner. Walking totalParts over every
// product costs real CPU, so the serialized result is memoized for an hour;
// the scanner sidecar itself only refetches when its process restarts.
let scanCatalogCache: { body: string; at: number } | undefined;
function scanCatalogJson(): string {
  if (scanCatalogCache && Date.now() - scanCatalogCache.at < 3_600_000) return scanCatalogCache.body;
  const domainName = new Map(DOMAINS.map((d) => [d.slug, d.name]));
  const items = productList().map((p) => {
    const top = children(p.id)
      .slice(0, 8)
      .map(({ node, qty, note }) => ({
        id: node.id,
        name: node.name,
        kind: node.kind,
        qty,
        note: note ?? '',
        partsTotal: node.kind === 'part' ? 1 : totalParts(node.id),
        directLines: lineCount(node.id),
        url: `/item/${node.id}/`,
      }));
    return {
      id: p.id,
      name: p.name,
      domain: p.domain ?? '',
      domainName: domainName.get(p.domain ?? '') ?? p.domain ?? '',
      summary: p.summary ?? '',
      aliases: p.aliases ?? [],
      partsTotal: totalParts(p.id),
      directLines: lineCount(p.id),
      url: `/item/${p.id}/`,
      top,
    };
  });
  const body = JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), items });
  scanCatalogCache = { body, at: Date.now() };
  return body;
}

async function requireUser(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<Session | null> {
  const session = await getSession(req);
  if (!session) {
    redirect(res, '/login');
    return null;
  }
  return session;
}

async function requireReviewer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<Session | null> {
  const session = await getSession(req);
  if (!session) {
    redirect(res, '/login');
    return null;
  }
  if (session.role !== 'admin' && session.role !== 'reviewer') {
    // Bouncing a signed-in contributor to the sign-in page reads as a broken
    // session. Say what actually happened instead.
    sendHtml(
      res,
      page({
        title: 'Reviewers only | BOMwiki',
        description: 'This action needs reviewer rights.',
        path: '/reviewers-only',
        indexable: false,
        body: `<div class="review"><h1>Reviewers only</h1>
          <p>You are signed in as <a href="/user/${esc(session.handle)}">${esc(session.handle)}</a>, but this action needs <b>reviewer</b> rights. Reviewers are promoted from contributors with a track record of accepted edits; how that works is on the <a href="/about/governance">governance page</a>.</p>
          <p>What you can do today: propose changes with any page's Edit button (they go through review), raise problems on a page's Discussion tab, and track your proposals from <a href="/user/${esc(session.handle)}">your profile</a>.</p></div>`,
        extraCss: ['/static/edit.css'],
      }),
      403,
    );
    return null;
  }
  return session;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/healthz') return sendJson(res, 200, { ok: true, nodes: nodeCount() });

  // Public assets from the site's public dir: photos, thumbs, social cards,
  // favicons. Prefix-allowlisted, path-normalized, GET only.
  const publicPrefixes = ['/img/', '/og/', '/favicon.svg', '/favicon.png', '/og-card-v2.png'];
  if (method === 'GET' && publicPrefixes.some((p) => path.startsWith(p))) {
    const normalized = normalize(path.replace(/^\/+/, '')).replaceAll('\\', '/');
    if (normalized.startsWith('..')) return notFound(res);
    const types: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.gif': 'image/gif',
    };
    const type = types[normalized.slice(normalized.lastIndexOf('.')).toLowerCase()];
    if (!type) return notFound(res);
    try {
      const content = readFileSync(join(PUBLIC_DIR, normalized));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
      res.end(content);
    } catch {
      notFound(res);
    }
    return;
  }

  // Contributed 3D model files, content-addressed and immutable. Public only
  // once an accepted submission references the hash; before that the uploader
  // and reviewers can fetch it (uncached) to preview a pending submission —
  // everyone else gets the same 404 as a hash that never existed.
  const modelFile = path.match(/^\/models\/([a-f0-9]{64})\.(stl|step|fcstd|scad)$/);
  if (modelFile && method === 'GET') {
    const [, sha, ext] = modelFile;
    const session = await getSession(req);
    const access = await fileAccess(
      sha,
      session ? { userId: session.userId, role: session.role } : null,
    );
    if (access === 'none') return notFound(res);
    const filePath = modelFilePath(sha, ext);
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return notFound(res);
    }
    const headers: Record<string, string> = {
      'content-type': MODEL_MIME[ext as ModelExt],
      'content-length': String(size),
      'cache-control':
        access === 'public' ? 'public, max-age=31536000, immutable' : 'no-store',
    };
    // STL streams to the in-page viewer; everything else is a download.
    if (ext !== 'stl') {
      headers['content-disposition'] = `attachment; filename="bomwiki-${sha.slice(0, 12)}.${ext}"`;
    }
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
    return;
  }

  if (path === '/robots.txt') {
    return send(
      res,
      200,
      'text/plain; charset=utf-8',
      'User-agent: *\nAllow: /\nDisallow: /review\nDisallow: /api/\nSitemap: https://bomwiki.com/sitemap.xml\n',
    );
  }

  if (path === '/sitemap.xml') {
    // Only indexable URLs: home, domain hubs, and nodes that clear the tier +
    // content floor in isIndexableNode (currently substantive products).
    const urls: string[] = ["https://bomwiki.com/", "https://bomwiki.com/products", "https://bomwiki.com/cad", "https://bomwiki.com/project", "https://bomwiki.com/project/engine", "https://bomwiki.com/help/editing"];
    for (const d of DOMAINS) {
      if (productsByDomain(d.slug).length > 0) urls.push(`https://bomwiki.com/domain/${d.slug}/`);
    }
    for (const node of allNodes()) {
      if (isIndexableNode(node)) urls.push(`https://bomwiki.com/item/${node.id}/`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>\n`;
    res.writeHead(200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    res.end(xml);
    return;
  }

  if (path.startsWith('/static/')) {
    const name = normalize(path.slice('/static/'.length)).replaceAll('\\', '/');
    // Files directly in static/ plus the vendored client libs one level down.
    if (name.includes('..') || !/^(?:vendor\/)?[A-Za-z0-9._-]+$/.test(name)) return notFound(res);
    const type = STATIC_TYPES[name.slice(name.lastIndexOf('.'))];
    if (!type) return notFound(res);
    try {
      const content = readFileSync(join(staticDir, name));
      // Pages link assets with ?v=<content hash> (see assets.ts), so a
      // versioned URL never changes meaning and can be cached forever.
      // Unversioned requests (vendor libs loaded from graph.js, hotlinks)
      // stay short so a deploy propagates within minutes.
      const cache = url.searchParams.has('v')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300';
      res.writeHead(200, { 'content-type': type, 'cache-control': cache });
      res.end(content);
    } catch {
      notFound(res);
    }
    return;
  }

  // --- auth ---
  const setSessionAndGo = (token: string, to: string) => {
    // Secure in production (bomwiki.com is HTTPS end to end through Cloudflare);
    // left off in local dev so login works over plain http://localhost.
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.writeHead(303, {
      'set-cookie': `bw_sess=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${secure}`,
      location: to,
    });
    res.end();
  };
  if ((path === '/login' || path === '/signup') && method === 'GET') {
    return sendHtml(res, signinPage());
  }
  if (path === '/login' && method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const token = await login(body.get('token') ?? '');
    if (!token) return sendHtml(res, signinPage({ error: 'Wrong token.' }), 403);
    return setSessionAndGo(token, '/review');
  }
  if (path === '/auth/request' && method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const result = await requestMagicLink(body.get('email') ?? '', body.get('handle') ?? undefined);
    if (result.error) return sendHtml(res, signinPage({ error: result.error }), 422);
    return sendHtml(res, signinPage({ sent: true, devLink: result.devLink }));
  }
  const magic = path.match(/^\/auth\/([a-f0-9]{48})$/);
  if (magic && method === 'GET') {
    const verified = await verifyMagicLink(magic[1]);
    if (!verified) return sendHtml(res, signinPage({ error: 'That link is expired or already used.' }), 403);
    // First sign-in gets the welcome email. Detached: mail must never make
    // login slow or failable.
    void sendWelcome(verified.userId).catch((err) => console.error('welcome email failed:', err));
    return setSessionAndGo(verified.session, '/');
  }
  if (path === '/logout' && method === 'POST') {
    await logout(req);
    res.writeHead(303, { 'set-cookie': 'bw_sess=; Path=/; Max-Age=0', location: '/' });
    res.end();
    return;
  }

  // --- api ---
  if (path === '/api/session') {
    const session = await getSession(req);
    return sendJson(res, 200, session ? { handle: session.handle, role: session.role } : {});
  }
  if (path === '/api/search') {
    const q = url.searchParams.get('q') ?? '';
    const raw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, raw)) : 8;
    return sendJson(res, 200, searchNodes(q, limit));
  }
  if (path === '/api/changesets' && method === 'POST') {
    const session = await getSession(req);
    if (!session) return sendJson(res, 401, { error: 'sign in to propose changes' });
    let parsed: { summary?: string; edits: ProposedEdit[] };
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    const result = await proposeChangeset(
      { userId: session.userId, role: session.role },
      parsed.edits ?? [],
      parsed.summary,
    );
    if (result.errors) return sendJson(res, 422, { errors: result.errors });
    return sendJson(res, 201, {
      id: result.id,
      applied: result.applied,
      ...(result.applyError ? { applyError: result.applyError } : {}),
    });
  }

  // --- 3D models: two-step contribution (upload the bytes, then submit
  // the metadata). Both require a session; the upload is IP-rate-limited
  // because it writes real bytes to disk before any review happens. ---
  if (path === '/api/models/upload' && method === 'POST') {
    // Error paths here reject without reading the (possibly huge) body, which
    // leaves unread bytes on the socket — a keep-alive reuse would then parse
    // body bytes as the next request. Close the connection on every error.
    const reject = (status: number, value: unknown): void => {
      res.writeHead(status, {
        'content-type': 'application/json',
        connection: 'close',
      });
      res.end(JSON.stringify(value), () => req.destroy());
    };
    const session = await getSession(req);
    if (!session) return reject(401, { error: 'sign in to add a model' });
    if (!modelUploadAllowed(req)) {
      return reject(429, {
        error: 'Too many uploads right now. Wait a few minutes and try again.',
        code: 'rate_limited',
      });
    }
    const result = await receiveUpload(req, url.searchParams.get('ext') ?? '', session.userId);
    if (!result.ok) return reject(result.status, { error: result.message, code: result.code });
    return sendJson(res, 200, {
      sha256: result.sha256,
      bytes: result.bytes,
      format: result.format,
      triangles: result.triangles,
    });
  }
  if (path === '/api/models/submit' && method === 'POST') {
    const session = await getSession(req);
    if (!session) return sendJson(res, 401, { error: 'sign in to add a model' });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    const result = await createSubmission({ userId: session.userId, role: session.role }, parsed);
    if ('errors' in result) return sendJson(res, 422, { errors: result.errors });
    return sendJson(res, 201, { id: result.id, live: result.live });
  }
  const modelUpload = path.match(/^\/item\/([A-Za-z0-9._-]+)\/model\/upload$/);
  if (modelUpload && method === 'GET') {
    const node = getNode(modelUpload[1]);
    if (!node) return notFound(res, modelUpload[1]);
    const session = await getSession(req);
    const mine = session ? await myPendingForNode(node.id, session.userId) : [];
    return sendHtml(res, modelUploadPage(node, Boolean(session), mine));
  }
  const modelWithdraw = path.match(/^\/model\/(\d+)\/withdraw$/);
  if (modelWithdraw && method === 'POST') {
    const session = await getSession(req);
    if (!session) return redirect(res, '/login');
    const nodeId = await withdrawSubmission(Number(modelWithdraw[1]), session.userId);
    return redirect(res, nodeId ? `/item/${nodeId}/model/upload` : '/');
  }

  // --- review ---
  if (path === '/review' && method === 'GET') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const [pending, pendingModels] = await Promise.all([listPending(), listPendingSubmissions()]);
    return sendHtml(
      res,
      reviewPage(pending, url.searchParams.get('m') ?? undefined, pendingModels),
    );
  }
  const modelDecide = path.match(/^\/review\/model\/(\d+)\/(accept|reject)$/);
  if (modelDecide && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const decision = modelDecide[2] === 'accept' ? 'accepted' : 'rejected';
    const result = await decideSubmission(Number(modelDecide[1]), session.userId, decision);
    if (result.ok) {
      void notifyModelDecision(Number(modelDecide[1]), decision, session.userId).catch((err) =>
        console.error('model decision email failed:', err),
      );
    }
    const m = result.ok
      ? `Model #${modelDecide[1]} ${modelDecide[2]}ed.`
      : `Model #${modelDecide[1]}: ${result.error}`;
    return redirect(res, `/review?m=${encodeURIComponent(m)}`);
  }
  const decide = path.match(/^\/review\/(\d+)\/(accept|reject)$/);
  if (decide && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const result = await decideChangeset(
      Number(decide[1]),
      session.userId,
      decide[2] === 'accept' ? 'accepted' : 'rejected',
    );
    const m = result.ok
      ? `Change #${decide[1]} ${decide[2]}ed.`
      : `Change #${decide[1]}: ${result.error}`;
    return redirect(res, `/review?m=${encodeURIComponent(m)}`);
  }

  // --- changeset pages: where contributors track their proposals ---
  const csView = path.match(/^\/changeset\/(\d+)$/);
  if (csView && method === 'GET') {
    const cs = await getChangeset(Number(csView[1]));
    if (!cs) return notFound(res, `changeset ${csView[1]}`);
    const session = await getSession(req);
    return sendHtml(
      res,
      changesetPage(cs, { userId: session?.userId ?? null, role: session?.role ?? null }),
    );
  }
  const csWithdraw = path.match(/^\/changeset\/(\d+)\/withdraw$/);
  if (csWithdraw && method === 'POST') {
    const session = await getSession(req);
    if (!session) return redirect(res, '/login');
    await withdrawChangeset(Number(csWithdraw[1]), session.userId);
    return redirect(res, `/changeset/${csWithdraw[1]}`);
  }
  if (path === '/api/pending' && method === 'GET') {
    const nodeId = url.searchParams.get('node') ?? '';
    if (!/^[A-Za-z0-9._-]+$/.test(nodeId)) return sendJson(res, 422, { error: 'bad node id' });
    return sendJson(res, 200, { pending: await pendingIdsForNode(nodeId) });
  }

  // --- history ---
  const history = path.match(/^\/item\/([A-Za-z0-9._-]+)\/history$/);
  if (history) {
    const node = getNode(history[1]);
    if (!node) return notFound(res, history[1]);
    const session = await getSession(req);
    const rows = await pool.query(
      `select r.rev, r.created_at, r.summary, r.changeset_id, u.handle as author
       from revisions r join changesets c on c.id = r.changeset_id join users u on u.id = c.author_id
       where r.node_id = $1 order by r.rev desc`,
      [node.id],
    );
    const revisions: RevisionRow[] = rows.rows.map((r) => ({
      rev: Number(r.rev),
      author: r.author,
      createdAt: r.created_at.toISOString(),
      summary: r.summary ?? '',
      changesetId: Number(r.changeset_id),
    }));
    return sendHtml(res, historyPage(node, revisions, session?.role === 'admin'));
  }

  const oldRev = path.match(/^\/item\/([A-Za-z0-9._-]+)\/rev\/(\d+)$/);
  if (oldRev) {
    const node = getNode(oldRev[1]);
    if (!node) return notFound(res, oldRev[1]);
    const row = await pool.query('select data from revisions where node_id = $1 and rev = $2', [
      oldRev[1],
      Number(oldRev[2]),
    ]);
    if (row.rows.length === 0) return notFound(res, `r${oldRev[2]}`);
    const historical = { id: node.id, ...row.rows[0].data };
    return sendHtml(res, itemPage(historical, { asOfRev: Number(oldRev[2]) }));
  }

  const revert = path.match(/^\/item\/([A-Za-z0-9._-]+)\/revert\/(\d+)$/);
  if (revert && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const result = await revertNode(revert[1], Number(revert[2]), session.userId);
    if (!result.ok) return sendJson(res, 409, { error: result.error });
    return redirect(res, `/item/${revert[1]}/history`);
  }

  // --- community ---
  if (path === '/changes') return sendHtml(res, changesPage(await recentChanges()));

  const profile = path.match(/^\/user\/([a-z0-9_-]+)$/);
  if (profile && method === 'GET') {
    const user = await getUserByHandle(profile[1]);
    if (!user) return notFound(res, profile[1]);
    const session = await getSession(req);
    const rows = await contributionsOf(user.id);
    // "Edits mostly in …" from the domains of their recent accepted edits;
    // recent is enough, this is a flavor line, not a statistic.
    const domainCounts = new Map<string, number>();
    for (const c of rows) {
      if (c.status !== 'accepted') continue;
      for (const e of c.edits) {
        const d = getNode(e.nodeId)?.domain;
        if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
      }
    }
    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([slug]) => DOMAINS.find((d) => d.slug === slug)?.name ?? slug);
    return sendHtml(
      res,
      profilePage(user, await contributionStats(user.id), await profileExtras(user.id), rows, {
        adminView: session?.role === 'admin',
        ownProfile: session?.handle === user.handle,
        domains: topDomains,
        notice: url.searchParams.get('m') ?? undefined,
      }),
    );
  }

  // The self-authored user page: its owner (or an admin, for moderation)
  // edits it here; it renders at the top of the profile.
  const userPageEdit = path.match(/^\/user\/([a-z0-9_-]+)\/page$/);
  if (userPageEdit && (method === 'GET' || method === 'POST')) {
    const session = await requireUser(req, res);
    if (!session) return;
    const target = await getUserByHandle(userPageEdit[1]);
    if (!target) return notFound(res, userPageEdit[1]);
    const adminEdit = session.role === 'admin' && session.userId !== target.id;
    if (session.userId !== target.id && !adminEdit) {
      return redirect(res, `/user/${target.handle}`);
    }
    if (method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      const md = stripNul(body.get('page') ?? '')
        .replace(/\r\n/g, '\n')
        .trim()
        .slice(0, 20_000);
      await setProfilePage(target.id, md || null);
      return redirect(res, `/user/${target.handle}`);
    }
    return sendHtml(res, profilePageEditor(target, { adminEdit }));
  }

  // The photo worklist: every product page still showing a line-art icon.
  // Exists so "no photo" is a queue anyone can work, not a dead end.
  // The CAD layer's linkable front door: what it is, every item with a
  // model, how to contribute. Session-independent, so edge-cacheable.
  if ((path === '/cad' || path === '/cad/') && method === 'GET') {
    if (path === '/cad/') return redirectPermanent(res, '/cad');
    const items = await listModeledItems();
    return sendCacheableHtml(res, cadHubPage(items, nodeCount()));
  }

  if (path === '/photos-needed' && method === 'GET') {
    const missing = productList().filter((p) => !imageFor(p));
    const total = productList().length;
    const byDomain = new Map<string, typeof missing>();
    for (const p of missing) {
      const key = p.domain ?? 'other';
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key)!.push(p);
    }
    const sections = [...byDomain.entries()]
      .map(([slug, nodes]) => ({
        name: DOMAINS.find((d) => d.slug === slug)?.name ?? 'Other',
        nodes,
      }))
      .sort((a, b) => b.nodes.length - a.nodes.length)
      .map(
        (s) => `<h2 class="si-h">${esc(s.name)} <span class="rv-meta">(${s.nodes.length})</span></h2>
        <p class="pn-list">${s.nodes.map((n) => `<a href="/item/${n.id}/">${esc(n.name)}</a>`).join(' · ')}</p>`,
      )
      .join('\n');
    return sendCacheableHtml(
      res,
      page({
        title: 'Pages needing photos | BOMwiki',
        description: 'Product pages that still show a placeholder drawing.',
        path: '/photos-needed',
        ogImage: '/og/page/photos-needed.png',
        indexable: false,
        body: `<div class="review"><h1>Pages needing photos</h1>
          <p class="stub">${missing.length.toLocaleString()} of ${total.toLocaleString()} products still show a line drawing instead of a photo. A good photo is openly licensed (Wikimedia Commons is ideal) and clearly shows the real thing. Open a page you can vouch for and use "Suggest a photo" there.</p>
          ${sections}</div>`,
        extraCss: ['/static/edit.css'],
      }),
    );
  }

  if (path === '/new' && method === 'GET') {
    const session = await getSession(req);
    return sendHtml(res, newPagePage(Boolean(session)));
  }

  if (path === '/contributors' && method === 'GET') {
    const [rows, members] = await Promise.all([
      listContributors(),
      pool.query("select count(*)::int as n from users where role <> 'system' and not blocked"),
    ]);
    return sendHtml(res, contributorsPage(rows, members.rows[0].n));
  }

  // --- operator dashboard (admin) ---
  if (path === '/admin') {
    const session = await getSession(req);
    if (!session || session.role !== 'admin') return redirect(res, '/login');
    const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
    const [usersQ, recentUsersQ, csQ, recentCsQ, commentsQ, vfQ, vfe7Q] = await Promise.all([
      pool.query(
        `select count(*)::int total,
                count(*) filter (where created_at > now() - interval '7 days')::int new7,
                count(*) filter (where role = 'reviewer')::int reviewers,
                count(*) filter (where role = 'admin')::int admins,
                count(*) filter (where blocked)::int blocked
         from users where role <> 'system'`,
      ),
      pool.query(
        `select u.handle, u.role, u.blocked, u.created_at,
                (select count(*)::int from changesets c where c.author_id = u.id) edits
         from users u where u.role <> 'system' order by u.created_at desc limit 12`,
      ),
      pool.query(
        `select count(*) filter (where status = 'pending')::int pending,
                count(*) filter (where status = 'accepted')::int accepted,
                count(*) filter (where status = 'rejected')::int rejected,
                count(*) filter (where created_at > now() - interval '7 days')::int proposed7,
                count(*) filter (where status = 'accepted' and decided_at > now() - interval '7 days')::int accepted7
         from changesets`,
      ),
      pool.query(
        `select c.id, u.handle as author, c.status, coalesce(c.summary, '') as summary, c.created_at
         from changesets c join users u on u.id = c.author_id order by c.id desc limit 10`,
      ),
      pool.query(
        `select count(*)::int total,
                count(*) filter (where created_at > now() - interval '7 days')::int last7
         from comments`,
      ),
      pool.query(`select verification, count(*)::int n from nodes group by verification`),
      pool.query(
        `select count(*)::int n from verification_events where created_at > now() - interval '7 days'`,
      ),
    ]);
    const intelUrl = process.env.INTEL_URL ?? 'http://127.0.0.1:8799';
    const intel = await fetch(intelUrl, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false);
    const ffsRows = await ffsQuery('MATCH (n:Item) RETURN count(n) AS n');
    return sendHtml(
      res,
      adminDashPage({
        users: usersQ.rows[0],
        recentUsers: recentUsersQ.rows.map((u) => ({
          handle: u.handle,
          role: u.role,
          blocked: u.blocked,
          joined: iso(u.created_at),
          edits: u.edits,
        })),
        changes: csQ.rows[0],
        recentChangesets: recentCsQ.rows.map((c) => ({
          id: Number(c.id),
          author: c.author,
          status: c.status,
          summary: String(c.summary).split('\n')[0].slice(0, 90),
          when: iso(c.created_at),
        })),
        comments: commentsQ.rows[0],
        verification: Object.fromEntries(vfQ.rows.map((r) => [r.verification, r.n])),
        verifyEvents7: vfe7Q.rows[0].n,
        health: { intel, ffs: ffsRows ? Number(ffsRows[0]?.n ?? 0) : null, mail: Boolean(process.env.MAIL_API_KEY) },
      }, url.searchParams.get('m') ?? undefined),
    );
  }

  // Merge duplicate pages: 301 the duplicate to the canonical page and drop
  // it from listings and search. Node and history stay untouched in the
  // database, so a merge is reversible by deleting the redirect row.
  if (path === '/admin/redirect' && method === 'POST') {
    const session = await getSession(req);
    if (!session || session.role !== 'admin') return redirect(res, '/login');
    const body = new URLSearchParams(await readBody(req));
    const fromId = (body.get('from') ?? '').trim();
    const toId = (body.get('to') ?? '').trim();
    const fail = (m: string) => redirect(res, `/admin?m=${encodeURIComponent(m)}`);
    if (!getNode(fromId)) return fail(`No page with id "${fromId}".`);
    if (!getNode(toId)) return fail(`No page with id "${toId}".`);
    if (fromId === toId) return fail('A page cannot redirect to itself.');
    if (redirectOf(toId)) return fail(`"${toId}" is itself redirected; pick its target.`);
    await pool.query(
      'insert into redirects (from_id, to_id) values ($1, $2) on conflict (from_id) do update set to_id = $2',
      [fromId, toId],
    );
    setRedirectInMemory(fromId, toId);
    return redirect(res, `/admin?m=${encodeURIComponent(`"${fromId}" now redirects to "${toId}".`)}`);
  }

  // --- domain taxonomy curation (reviewers) ---
  if (path === '/admin/domains') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    if (method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      const parsed = (body.get('domains') ?? '')
        .split('\n')
        .map((line) => line.split('|').map((s) => s.trim()))
        .filter((p) => p.length === 2 && /^[a-z0-9-]{2,40}$/.test(p[0]) && p[1])
        .map(([slug, name]) => ({ slug, name }));
      if (parsed.length < 5) {
        return redirect(res, `/admin/domains?m=${encodeURIComponent('Not saved: need at least 5 valid "slug | Name" lines.')}`);
      }
      await setSetting('domains', parsed, session.userId);
      setDomains(parsed);
      return redirect(res, `/admin/domains?m=${encodeURIComponent(`Saved ${parsed.length} domains.`)}`);
    }
    const meta = await settingMeta('domains');
    const notice = url.searchParams.get('m');
    return sendHtml(
      res,
      page({
        title: 'Curate domains | BOMwiki',
        description: 'The domain taxonomy.',
        path: '/admin/domains',
        indexable: false,
        body: `<div class="review"><h1>Curate domains</h1>
          ${notice ? `<p class="rv-notice">${esc(notice)}</p>` : ''}
          <p class="stub">One per line, as <code>slug | Display Name</code>. Renames change display only; products keep their domain slug, so removing a slug hides that hub rather than deleting anything. ${
            meta ? `Last edited by <a href="/user/${esc(meta.updatedBy)}">${esc(meta.updatedBy)}</a>.` : 'Currently the launch seed.'
          }</p>
          <form method="post" action="/admin/domains" class="settings-form">
            <label>Domains <textarea name="domains" rows="20">${esc(DOMAINS.map((d) => `${d.slug} | ${d.name}`).join('\n'))}</textarea></label>
            <button>Save</button>
          </form></div>`,
        extraCss: ['/static/edit.css'],
      }),
    );
  }

  // --- homepage curation (reviewers) ---
  if (path === '/admin/homepage') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    if (method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      const rawPool = (body.get('pool') ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknown = rawPool.filter((id) => !getNode(id) || getNode(id)!.kind !== 'product');
      const clean = rawPool.filter((id) => getNode(id)?.kind === 'product');
      const facts = (body.get('facts') ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (clean.length) await setSetting('featured-pool', clean, session.userId);
      await setSetting('did-you-know', facts, session.userId);
      const welcomeTitle = body.get('welcomeTitle')?.trim().slice(0, 60);
      const welcomeSubtitle = body.get('welcomeSubtitle')?.trim().slice(0, 300);
      if (welcomeTitle && welcomeSubtitle) {
        await setSetting('welcome', { title: welcomeTitle, subtitle: welcomeSubtitle }, session.userId);
      }
      const notice = unknown.length
        ? `Saved. Skipped ${unknown.length} id(s) that are not products: ${unknown.slice(0, 5).join(', ')}`
        : 'Saved.';
      return redirect(res, `/admin/homepage?m=${encodeURIComponent(notice)}`);
    }
    return sendHtml(
      res,
      homepageAdminPage({
        pool: await getSetting<string[]>('featured-pool', []),
        facts: await getSetting<string[]>('did-you-know', []),
        welcome: await getSetting('welcome', {
          title: 'Everything is BOM',
          subtitle:
            'Every product is exploded into the parts it is built from, down to individual screws, bearings, and cells.',
        }),
        meta: await settingMeta('featured-pool'),
        notice: url.searchParams.get('m') ?? undefined,
      }),
    );
  }

  // --- admin moderation actions ---
  const modAction = path.match(/^\/admin\/user\/([a-z0-9_-]+)\/(block|unblock|make-reviewer|make-contributor|mass-revert)$/);
  if (modAction && method === 'POST') {
    const session = await getSession(req);
    if (!session || session.role !== 'admin') return redirect(res, '/login');
    const target = await getUserByHandle(modAction[1]);
    if (!target) return notFound(res, modAction[1]);
    if (target.role === 'admin' || target.role === 'system') {
      return redirect(res, `/user/${target.handle}?m=${encodeURIComponent('Admins cannot be moderated from here.')}`);
    }
    let message = '';
    switch (modAction[2]) {
      case 'block':
        await setBlocked(target.id, true);
        message = 'Account blocked; sessions ended, pending changes rejected.';
        break;
      case 'unblock':
        await setBlocked(target.id, false);
        message = 'Account unblocked.';
        break;
      case 'make-reviewer':
        await setRole(target.id, 'reviewer');
        message = 'Promoted to reviewer.';
        break;
      case 'make-contributor':
        await setRole(target.id, 'contributor');
        message = 'Set to contributor.';
        break;
      case 'mass-revert': {
        const result = await massRevert(target.id, session.userId);
        message = `Mass revert: ${result.reverted.length} page(s) restored${result.skipped.length ? `, ${result.skipped.length} skipped (no earlier revision by someone else)` : ''}.`;
        break;
      }
    }
    return redirect(res, `/user/${target.handle}?m=${encodeURIComponent(message)}`);
  }

  if (path === '/settings') {
    const session = await requireUser(req, res);
    if (!session) return;
    if (method === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      // A profile website must be a plain http(s) URL or nothing.
      const website = stripNul(body.get('website')?.trim().slice(0, 200) || '');
      await updateProfile(session.userId, {
        displayName: stripNul(body.get('displayName')?.trim().slice(0, 60) || '') || undefined,
        affiliation: stripNul(body.get('affiliation')?.trim().slice(0, 120) || '') || undefined,
        bio: stripNul(body.get('bio')?.trim().slice(0, 1000) || '') || undefined,
        website: /^https?:\/\/\S+$/.test(website) ? website : undefined,
      });
      return redirect(res, '/settings?saved=1');
    }
    const user = await getUserByHandle(session.handle);
    return sendHtml(
      res,
      settingsPage(user!, await getEmailPrefs(session.userId), url.searchParams.has('saved')),
    );
  }

  if (path === '/settings/email' && method === 'POST') {
    const session = await requireUser(req, res);
    if (!session) return;
    const body = new URLSearchParams(await readBody(req));
    await setEmailPrefs(session.userId, {
      digest: body.get('digest') === 'weekly' ? 'weekly' : 'off',
      notifyDecisions: body.get('decisions') === 'on',
      notifyReplies: body.get('replies') === 'on',
    });
    return redirect(res, '/settings?saved=1');
  }

  // Unsubscribe by emailed token: no session needed (email clients open
  // these signed out). GET shows a confirmation page; POST is RFC 8058
  // one-click for mail clients, answered plainly.
  const unsub = path.match(/^\/email\/unsubscribe\/([a-f0-9]{48})$/);
  if (unsub && (method === 'GET' || method === 'POST')) {
    const handle = await unsubscribeByToken(unsub[1]);
    if (method === 'POST') return send(res, handle ? 200 : 404, 'text/plain', handle ? 'unsubscribed' : 'unknown token');
    return sendHtml(res, unsubscribePage(handle), handle ? 200 : 404);
  }

  // Talk subjects: any node, plus reserved page discussions (the homepage).
  const talk = path.match(/^\/item\/([A-Za-z0-9._-]+)\/talk$/);
  const pageTalk = path === '/home/talk';
  if (talk || pageTalk) {
    let subject: TalkSubject;
    if (pageTalk) {
      subject = HOME_TALK;
    } else {
      const node = getNode(talk![1]);
      if (!node) return notFound(res, talk![1]);
      subject = talkSubjectForNode(node);
    }
    const session = await getSession(req);
    if (method === 'POST') {
      if (!session) return redirect(res, '/login');
      const body = new URLSearchParams(await readBody(req));
      const parentRaw = body.get('parent_id');
      let parentId: number | undefined;
      if (parentRaw) {
        parentId = Number.parseInt(parentRaw, 10);
        if (!Number.isInteger(parentId)) return sendJson(res, 422, { error: 'invalid parent_id' });
      }
      const trusted = await isAutoconfirmed(session.userId, session.role);
      const result = await addComment(
        subject.key,
        session.userId,
        body.get('body') ?? '',
        parentId,
        trusted,
      );
      if (result.error) return sendJson(res, 422, result);
      if (parentId) {
        // Detached: the topic author hears about the reply, the replier
        // never waits on mail.
        void notifyReply(
          parentId,
          { userId: session.userId, handle: session.handle },
          { title: subject.title, talkPath: subject.talkPath },
          (body.get('body') ?? '').trim(),
        ).catch((err) => console.error('reply email failed:', err));
      }
      return redirect(res, subject.talkPath);
    }
    const canModerate = session?.role === 'admin' || session?.role === 'reviewer';
    const topic = url.searchParams.get('topic');
    const prefill =
      topic === 'photo'
        ? 'The photo on this page looks wrong or mismatched for this item. What it shows instead: '
        : topic === 'add-photo'
          ? 'A good photo for this page (openly licensed, Wikimedia Commons is ideal), and what it shows: '
          : '';
    return sendHtml(
      res,
      talkPage(subject, await topicsFor(subject.key), Boolean(session), canModerate, prefill),
    );
  }

  const resolve = path.match(/^\/talk\/(\d+)\/resolve$/);
  if (resolve && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const subjectKey = await setTopicResolved(Number(resolve[1]), true);
    if (!subjectKey) return notFound(res);
    return redirect(res, subjectKey === 'home' ? '/home/talk' : `/item/${subjectKey}/talk`);
  }

  const verify = path.match(/^\/item\/([A-Za-z0-9._-]+)\/verify$/);
  if (verify && method === 'POST') {
    const session = await requireReviewer(req, res);
    if (!session) return;
    const node = getNode(verify[1]);
    if (!node) return notFound(res, verify[1]);
    const body = new URLSearchParams(await readBody(req));
    const status = body.get('status') ?? '';
    if (!['unverified', 'machine-checked', 'human-verified'].includes(status)) {
      return sendJson(res, 422, { error: 'invalid status' });
    }
    await pool.query('update nodes set verification = $2 where id = $1', [node.id, status]);
    await pool.query(
      'insert into verification_events (node_id, status, user_id, note) values ($1, $2, $3, $4)',
      [node.id, status, session.userId, stripNul(body.get('note')?.trim().slice(0, 500) || '') || null],
    );
    setVerificationInMemory(node.id, status as Verification);
    return redirect(res, `/item/${node.id}/`);
  }

  const watch = path.match(/^\/item\/([A-Za-z0-9._-]+)\/watch$/);
  if (watch && method === 'POST') {
    const session = await requireUser(req, res);
    if (!session) return;
    if (!getNode(watch[1])) return notFound(res, watch[1]);
    await toggleWatch(session.userId, watch[1]);
    return redirect(res, `/item/${watch[1]}/`);
  }

  if (path === '/watchlist') {
    const session = await requireUser(req, res);
    if (!session) return;
    return sendHtml(res, watchlistPage(await watchlistFeed(session.userId)));
  }

  // --- read path ---
  if (path === '/about' || path === '/about/') return sendCacheableHtml(res, aboutPage());
  if (path === '/project') return sendCacheableHtml(res, projectPage());
  if (path === '/project/engine') return sendCacheableHtml(res, enginePage());
  if (path === '/help/editing') return sendCacheableHtml(res, helpEditingPage());
  if (path === '/about/verification') return sendCacheableHtml(res, verificationPage());
  if (path === '/about/governance') return sendCacheableHtml(res, governancePage());
  if (path === '/intelligence') return sendCacheableHtml(res, intelligencePage());
  if (path === '/about/numbers' || path === '/about/numbers/') return redirectPermanent(res, '/about/');
  if (path === '/policies') return sendCacheableHtml(res, policiesPage());

  const domain = path.match(/^\/domain\/([a-z0-9-]+)(\/?)$/);
  if (domain) {
    if (!domain[2]) return redirectPermanent(res, `/domain/${domain[1]}/`);
    const html = domainPage(domain[1]);
    if (!html) return notFound(res, domain[1]);
    return sendCacheableHtml(res, html);
  }

  // Legacy routes from the static site. Old links must keep working: anything
  // that was ever live gets a permanent redirect to its closest current page.
  const legacyItem = path.match(/^\/(?:part|assembly)\/([A-Za-z0-9._-]+)\/?$/);
  if (legacyItem) {
    const id = redirectOf(legacyItem[1]) ?? legacyItem[1];
    if (getNode(id)) return redirectPermanent(res, `/item/${id}/`);
    return notFound(res, legacyItem[1]);
  }
  const legacyCategory = path.match(/^\/category\/([a-z0-9-]+)\/?$/);
  if (legacyCategory) {
    const slug = legacyCategory[1];
    if (DOMAINS.some((d) => d.slug === slug)) return redirectPermanent(res, `/domain/${slug}/`);
    return redirectPermanent(res, `/search?q=${encodeURIComponent(slug.replace(/-/g, ' '))}`);
  }
  if (path === '/scan') return redirectPermanent(res, '/scan/');
  if (path === '/scan/') return sendCacheableHtml(res, scanPage());

  // Product catalog snapshot the photo-BOM scanner matches against
  // (SCAN_CATALOG_URL in its unit points here). Same shape as the retired
  // static site's scan-catalog.json; rebuilt lazily at most once an hour.
  if (path === '/scan-catalog.json') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    res.end(scanCatalogJson());
    return;
  }

  // Proxy scan images to the photo-BOM sidecar so the browser only ever
  // talks to the engine. Images are ~0.2-1MB data URLs; cap matches the
  // sidecar's own body limit.
  if (path === '/api/photo-bom' && method === 'POST') {
    if (!scanAllowed(req)) {
      return sendJson(res, 429, {
        status: 'error',
        code: 'rate_limited',
        message: 'Too many scans right now. Wait a few minutes and try again.',
      });
    }
    let body: string;
    try {
      body = await readBodyLimited(req, 7_000_000);
    } catch {
      return sendJson(res, 413, { status: 'error', code: 'too_large', message: 'Image too large.' });
    }
    try {
      const upstream = await fetch(PHOTO_BOM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch {
      sendJson(res, 502, { status: 'error', code: 'scanner_offline', message: 'The scanner service is not reachable.' });
    }
    return;
  }

  if (path === '/search') {
    return sendHtml(res, searchPage(url.searchParams.get('q') ?? ''));
  }

  const item = path.match(/^\/item\/([A-Za-z0-9._-]+)(\/?)$/);
  if (item) {
    const [, id, slash] = item;
    const target = redirectOf(id);
    if (target) {
      res.writeHead(301, { location: `/item/${target}/` });
      res.end();
      return;
    }
    const node = getNode(id);
    if (!node) return notFound(res, id);
    if (!slash) return redirectPermanent(res, `/item/${id}/`);
    // Transitive where-used comes from the FFS graph sidecar; products are
    // never contained by anything, so skip the lookup for them.
    const [usedIn, model] = await Promise.all([
      node.kind === 'product' ? null : productsUsing(id),
      modelForNode(id),
    ]);
    return sendCacheableHtml(res, itemPage(node, { productsUsing: usedIn, model }));
  }

  if (path === '/') {
    return sendCacheableHtml(res, await homePage());
  }

  if (path === '/products' || path === '/products/') {
    return sendCacheableHtml(res, productsPage());
  }

  if (path === '/random') {
    const products = productList();
    const pick = products[Math.floor(Math.random() * products.length)];
    res.writeHead(302, { location: `/item/${pick.id}/`, 'cache-control': 'no-store' });
    res.end();
    return;
  }

  notFound(res);
}

const t0 = performance.now();
await loadGraph(DATABASE_URL);
initDomains(await getSetting<Domain[] | null>('domains', null));
console.log(
  `graph loaded: ${nodeCount().toLocaleString()} nodes, ${totalCatalogParts.toLocaleString()} catalog parts in ${Math.round(performance.now() - t0)}ms`,
);
startDigestTicker();

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(`${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  })
  .listen(PORT, () => {
    console.log(`bomwiki engine listening on http://localhost:${PORT}`);
  });
