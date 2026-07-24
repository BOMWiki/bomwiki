import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const MAX_EXCHANGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_RECOVERY_TTL_MS = 2 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90 * 1000;
const MAX_PENDING_REQUESTS = 100;
const EXCHANGE_LONG_POLL_MS = 25 * 1000;

export const STUDIO_LOOPBACK_DISCOVERY_PORT = 49784;
export const DEFAULT_STUDIO_ORIGIN = 'https://bomwiki.com';
export const DEFAULT_STUDIO_URL = 'https://bomwiki.com/cad/studio';

type BridgeMessage = Record<string, unknown> & { type: string };
type BridgeState = 'waiting' | 'connected' | 'paused' | 'recovering' | 'closing' | 'closed';

type PendingRequest = {
  tool: string;
  cancellable: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error & { code?: string; details?: unknown }) => void;
  timer: NodeJS.Timeout;
};

export type StudioLoopbackBridge = {
  sessionId: string;
  discoveryUrl: string;
  launchUrl: string;
  pairingUrl: string;
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  reconnect(): { launchUrl: string; recoveryExpiresAt: string };
  status(): Record<string, unknown>;
  close(reason?: string): Promise<void>;
};

function bridgeError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
  return Object.assign(new Error(message), { code, ...(details === undefined ? {} : { details }) });
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isCancellableTool(tool: string): boolean {
  return !['cad_commit', 'cad_history'].includes(tool);
}

function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function safeStudioOrigin(value: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(value || DEFAULT_STUDIO_ORIGIN);
  } catch {
    throw bridgeError('PAIRING_NOT_AVAILABLE', 'The configured Studio origin is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/') {
    throw bridgeError('PAIRING_NOT_AVAILABLE', 'The configured Studio origin must be an HTTP or HTTPS origin.');
  }
  return parsed.origin;
}

function safeStudioUrl(value: string | undefined, studioOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value || DEFAULT_STUDIO_URL);
  } catch {
    throw bridgeError('PAIRING_NOT_AVAILABLE', 'The configured Studio URL is invalid.');
  }
  if (parsed.origin !== studioOrigin || parsed.username || parsed.password) {
    throw bridgeError('PAIRING_NOT_AVAILABLE', 'The Studio launch URL must use the approved Studio origin.');
  }
  return parsed.href;
}

function pairingPage(options: {
  secret: string;
  studioOrigin: string;
  sessionId: string;
}): string {
  const secret = JSON.stringify(options.secret);
  const studioOrigin = JSON.stringify(options.studioOrigin);
  const sessionId = JSON.stringify(options.sessionId);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOMwiki CAD agent bridge</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111922;color:#d9e5ef;font:14px system-ui,sans-serif}.card{width:min(440px,calc(100vw - 32px));padding:24px;border:1px solid #33465a;border-radius:10px;background:#1b2734;box-shadow:0 20px 60px #0008}.eyebrow{font-size:11px;letter-spacing:.14em;color:#78b9ed}h1{font-size:20px;margin:8px 0}p{color:#9eb2c5;line-height:1.5}.state{margin-top:18px;padding:10px;border-radius:6px;background:#111b26;color:#bcd0df}</style>
</head><body><main class="card"><div class="eyebrow">LOCAL STRUCTURED CONNECTION</div><h1>BOMwiki CAD agent bridge</h1><p>This page relays typed CAD requests between the local MCP process and Studio. It cannot read Studio's DOM, cookies, storage, or any other page.</p><div class="state" id="state">Connecting to the local adapter…</div></main>
<script nonce="bomwiki-cad-agent">
(() => {
  const state = document.getElementById('state');
  const secret = ${secret};
  const studioOrigin = ${studioOrigin};
  const sessionId = ${sessionId};
  const studioWindow = window.opener || (window.parent !== window ? window.parent : null);
  const pending = [];
  let stopped = false;
  let pushing = false;
  if (!studioWindow) {
    state.textContent = 'Open this connection from CAD Studio.';
    return;
  }
  addEventListener('message', (event) => {
    if (event.source !== studioWindow || event.origin !== studioOrigin || event.data?.source !== 'bomwiki-cad-studio' || !event.data.message) return;
    pending.push(event.data.message);
    void flushPending();
  });
  function postToStudio(message) {
    studioWindow.postMessage({ source: 'bomwiki-cad-loopback', sessionId, message }, studioOrigin);
  }
  function receive(messages) {
    for (const message of messages || []) {
      postToStudio(message);
      if (message.type === 'pairing.request') state.textContent = message.resume ? 'Waiting for recovery approval in CAD Studio…' : 'Waiting for approval in CAD Studio…';
      if (message.type === 'bridge.close') {
        stopped = true;
        state.textContent = message.reason || 'The local agent disconnected.';
      }
    }
  }
  async function flushPending() {
    if (stopped || pushing || !pending.length) return;
    pushing = true;
    try {
      const messages = pending.splice(0, pending.length);
      const response = await fetch('/exchange?direction=push', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bomwiki-cad-secret': secret },
        body: JSON.stringify({ messages }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('The local adapter rejected this connection.');
      receive((await response.json()).messages);
    } catch (error) {
      stopped = true;
      state.textContent = String(error?.message || error);
    } finally {
      pushing = false;
      if (!stopped && pending.length) queueMicrotask(flushPending);
    }
  }
  async function exchange() {
    if (stopped) return;
    try {
      const response = await fetch('/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bomwiki-cad-secret': secret },
        body: JSON.stringify({ messages: [] }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('The local adapter rejected this connection.');
      const body = await response.json();
      receive(body.messages);
      if (!stopped) setTimeout(exchange, body.messages?.length ? 20 : 0);
    } catch (error) {
      stopped = true;
      state.textContent = String(error?.message || error);
    }
  }
  addEventListener('pagehide', () => {
    if (stopped) return;
    fetch('/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bomwiki-cad-secret': secret },
      body: JSON.stringify({ messages: [{ type: 'studio.closed', recoverable: true }] }),
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  });
  exchange();
})();
</script></body></html>`;
}

async function readExchangeBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_EXCHANGE_BYTES) throw bridgeError('LIMIT_REQUEST_BYTES', 'Loopback exchange exceeds the 2 MiB limit.');
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw bridgeError('INVALID_JSON', 'Loopback exchange is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw bridgeError('INVALID_REQUEST', 'Loopback exchange must be an object.');
  return parsed as Record<string, unknown>;
}

export async function startStudioLoopbackBridge(options: {
  clientLabel?: string;
  mode?: 'read-only' | 'preview-required' | 'scoped-auto-commit';
  permissionContext: Record<string, unknown>;
  pairingTtlMs?: number;
  sessionTtlMs?: number;
  recoveryTtlMs?: number;
  requestTimeoutMs?: number;
  discoveryPort?: number;
  studioOrigin?: string;
  studioUrl?: string;
  skillVersion?: string;
}): Promise<StudioLoopbackBridge> {
  const sessionId = 'studio-loopback-' + randomUUID();
  let exchangeSecret = randomUUID() + randomUUID();
  const pairingNonce = randomUUID() + randomUUID();
  const clientLabel = String(options.clientLabel || 'Local CAD agent').trim().slice(0, 80) || 'Local CAD agent';
  const mode = ['read-only', 'preview-required', 'scoped-auto-commit'].includes(String(options.mode)) ? options.mode : 'preview-required';
  const permissionContext = structuredClone(options.permissionContext || {});
  const studioOrigin = safeStudioOrigin(options.studioOrigin);
  const studioUrl = safeStudioUrl(options.studioUrl, studioOrigin);
  const createdAt = Date.now();
  const pairingExpiresAt = createdAt + (options.pairingTtlMs || DEFAULT_PAIRING_TTL_MS);
  const requestedExpiry = typeof permissionContext.expiresAt === 'string' ? Date.parse(permissionContext.expiresAt) : Number.NaN;
  const sessionExpiresAt = Number.isFinite(requestedExpiry)
    ? Math.min(requestedExpiry, createdAt + (options.sessionTtlMs || DEFAULT_SESSION_TTL_MS))
    : createdAt + (options.sessionTtlMs || DEFAULT_SESSION_TTL_MS);
  if (sessionExpiresAt <= createdAt) throw bridgeError('PERMISSION_EXPIRED', 'The requested live Studio permission scope has already expired.');
  const recoveryTtlMs = options.recoveryTtlMs || DEFAULT_RECOVERY_TTL_MS;
  const requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
  const skillVersion = String(options.skillVersion || '0.1.0').slice(0, 40);
  const basePairingRequest: BridgeMessage = {
    type: 'pairing.request',
    protocol: 'bomwiki.cad.agent/v1',
    uiProfile: 'bomwiki.cad.agentic-ui/v1',
    sessionId,
    clientLabel,
    skillVersion,
    mode,
    expiresAt: new Date(sessionExpiresAt).toISOString(),
    permissionContext: {
      ...permissionContext,
      expiresAt: new Date(sessionExpiresAt).toISOString(),
    },
  };
  const outgoing: BridgeMessage[] = [basePairingRequest];
  const outgoingWaiters = new Set<() => void>();
  const pending = new Map<string, PendingRequest>();
  let state: BridgeState = 'waiting';
  let projectId: string | undefined;
  let revision: number | undefined;
  let uiRevision: number | undefined;
  let approvedPermissions: unknown;
  let approvedCapabilities: unknown;
  let closeReason: string | undefined;
  let closeCode: string | undefined;
  let recoveryExpiresAt: number | undefined;
  let recoveryTimer: NodeJS.Timeout | undefined;
  let serverPort = 0;

  function wakeOutgoingWaiters(): void {
    for (const wake of outgoingWaiters) wake();
    outgoingWaiters.clear();
  }

  function enqueueOutgoing(message: BridgeMessage): void {
    outgoing.push(message);
    wakeOutgoingWaiters();
  }

  async function waitForOutgoing(): Promise<void> {
    if (outgoing.length || state === 'closing' || state === 'closed') return;
    await new Promise<void>((resolve) => {
      let complete = false;
      const done = () => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        outgoingWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, EXCHANGE_LONG_POLL_MS);
      outgoingWaiters.add(done);
    });
  }

  function cancelCancellableRequests(reason: string): void {
    for (const [id, entry] of pending) {
      if (!entry.cancellable) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      enqueueOutgoing({ type: 'tool.cancel', id, reason });
      entry.reject(bridgeError('SESSION_PAUSED', reason));
    }
  }

  function enterRecovery(reason: string): void {
    if (!['connected', 'paused'].includes(state)) return;
    state = 'recovering';
    recoveryExpiresAt = Date.now() + recoveryTtlMs;
    cancelCancellableRequests('Studio reloaded before the request settled.');
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      if (state === 'recovering') void close('The Studio recovery window expired.', 'SESSION_RECOVERY_EXPIRED');
    }, recoveryTtlMs);
    recoveryTimer.unref();
    closeReason = reason;
  }

  function settle(message: BridgeMessage): void {
    if (message.type === 'pairing.approved') {
      if (!['waiting', 'recovering'].includes(state)) return;
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
      recoveryExpiresAt = undefined;
      state = 'connected';
      closeReason = undefined;
      closeCode = undefined;
      projectId = typeof message.projectId === 'string' ? message.projectId : undefined;
      revision = Number.isInteger(message.revision) ? message.revision as number : undefined;
      uiRevision = Number.isInteger(message.uiRevision) ? message.uiRevision as number : undefined;
      approvedPermissions = message.permissionContext;
      approvedCapabilities = message.capabilities;
      return;
    }
    if (message.type === 'pairing.denied') {
      closeReason = typeof message.message === 'string' ? message.message : 'The user denied the Studio connection.';
      void close(closeReason, 'PAIRING_APPROVAL_REQUIRED');
      return;
    }
    if (message.type === 'session.paused') {
      if (state !== 'connected') return;
      state = 'paused';
      cancelCancellableRequests(typeof message.reason === 'string' ? message.reason : 'The user paused the Studio session.');
      return;
    }
    if (message.type === 'session.resumed') {
      if (state === 'paused') state = 'connected';
      return;
    }
    if (message.type === 'tool.response' && typeof message.id === 'string') {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.ok === false) {
        const error = message.error && typeof message.error === 'object' ? message.error as Record<string, unknown> : {};
        entry.reject(bridgeError(String(error.code || 'CAD_TOOL_FAILED'), String(error.message || 'The live Studio request failed.'), error.details));
      } else {
        const result = message.result && typeof message.result === 'object'
          ? message.result as Record<string, any>
          : {};
        const snapshot = result.snapshot && typeof result.snapshot === 'object'
          ? result.snapshot as Record<string, any>
          : null;
        const nextProjectId = typeof snapshot?.projectId === 'string'
          ? snapshot.projectId
          : typeof result.projectId === 'string'
            ? result.projectId
            : undefined;
        const snapshotRevision = snapshot?.documentRevision;
        const snapshotUiRevision = snapshot?.uiRevision;
        const nextRevision = Number.isInteger(snapshotRevision)
          ? snapshotRevision
          : Number.isInteger(result.revision)
            ? result.revision
            : undefined;
        const nextUiRevision = Number.isInteger(result.uiRevision)
          ? result.uiRevision
          : Number.isInteger(snapshotUiRevision)
            ? snapshotUiRevision
            : undefined;
        if (nextProjectId) {
          projectId = nextProjectId;
          if (approvedPermissions && typeof approvedPermissions === 'object') {
            approvedPermissions = {
              ...(approvedPermissions as Record<string, unknown>),
              projectIds: [nextProjectId],
            };
          }
        }
        if (nextRevision !== undefined) revision = nextRevision;
        if (nextUiRevision !== undefined) uiRevision = nextUiRevision;
        entry.resolve(message.result);
      }
      return;
    }
    if (message.type === 'studio.closed') {
      if (message.recoverable !== false) enterRecovery('Studio reloaded or closed.');
      else void close('The live Studio session closed.', 'SESSION_CLOSED');
      return;
    }
    if (message.type === 'session.revoked') {
      void close(typeof message.reason === 'string' ? message.reason : 'The live Studio session was revoked.', 'SESSION_REVOKED');
    }
  }

  const server = createServer(async (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'Loopback clients only.' });
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const requestOrigin = request.headers.origin;
    const corsHeaders: Record<string, string> = requestOrigin === studioOrigin
      ? {
          'access-control-allow-origin': studioOrigin,
          'access-control-allow-private-network': 'true',
          vary: 'Origin',
        }
      : {};
    if (request.method === 'OPTIONS' && requestOrigin === studioOrigin) {
      response.writeHead(204, {
        ...corsHeaders,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-bomwiki-cad-secret',
        'cache-control': 'no-store',
      });
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/bomwiki-cad') {
      json(response, 200, {
        service: 'bomwiki-cad-local',
        version: 1,
        protocol: 'bomwiki.cad.agent/v1',
        uiProfile: 'bomwiki.cad.agentic-ui/v1',
        state,
        pendingApproval: state === 'waiting' || state === 'recovering',
      }, corsHeaders);
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/launch/')) {
      if (
        url.pathname.slice('/launch/'.length) !== pairingNonce ||
        !['waiting', 'recovering'].includes(state)
      ) {
        json(response, 404, { code: 'PAIRING_NOT_AVAILABLE', message: 'Unknown or expired Studio launch.' });
        return;
      }
      const recoveryLaunch = state === 'recovering' && url.searchParams.get('recovery') === '1';
      const target = new URL(studioUrl);
      const fragment = new URLSearchParams({
        'bomwiki-cad-pair': pairingNonce,
        'bomwiki-cad-port': String(serverPort),
      });
      if (recoveryLaunch) fragment.set('bomwiki-cad-recovery', '1');
      target.hash = fragment.toString();
      response.writeHead(302, {
        location: target.href,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/pair') {
      if (!['waiting', 'recovering'].includes(state)) {
        json(response, 409, { code: 'PAIRING_NOT_AVAILABLE', message: 'This local agent already has an active Studio connection.' });
        return;
      }
      if (url.searchParams.get('studioOrigin') !== studioOrigin) {
        json(response, 403, { code: 'PAIRING_NOT_AVAILABLE', message: 'This Studio origin is not approved by the local integration.' });
        return;
      }
      const suppliedNonce = url.searchParams.get('nonce');
      if (suppliedNonce && suppliedNonce !== pairingNonce) {
        json(response, 403, { code: 'PAIRING_NOT_AVAILABLE', message: 'The Studio launch nonce is invalid or expired.' });
        return;
      }
      if (state === 'recovering' && suppliedNonce !== pairingNonce) {
        json(response, 403, { code: 'PAIRING_NOT_AVAILABLE', message: 'Recovery requires the short-lived agent-first launch nonce.' });
        return;
      }
      exchangeSecret = randomUUID() + randomUUID();
      if (state === 'recovering') {
        outgoing.splice(0, outgoing.length, { ...basePairingRequest, resume: true });
        wakeOutgoingWaiters();
      }
      const body = pairingPage({ secret: exchangeSecret, studioOrigin, sessionId });
      const embedded = url.searchParams.get('embed') === '1';
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'nonce-bomwiki-cad-agent'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${embedded ? studioOrigin : "'none'"}`,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      response.end(body);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/exchange') {
      const requestSecret = request.headers['x-bomwiki-cad-secret'];
      if (requestSecret !== exchangeSecret || state === 'closed') {
        json(response, 403, { error: 'Unknown or expired pairing secret.' });
        return;
      }
      try {
        const body = await readExchangeBody(request);
        const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100) : [];
        for (const candidate of messages) {
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof (candidate as { type?: unknown }).type === 'string') settle(candidate as BridgeMessage);
        }
        if (!messages.length) await waitForOutgoing();
        if (requestSecret !== exchangeSecret) {
          json(response, 409, { code: 'SESSION_RECOVERY_REQUIRED', message: 'This bridge page was replaced by a recovery connection.' });
          return;
        }
        json(response, 200, { messages: outgoing.splice(0, outgoing.length), state });
      } catch (error: any) {
        json(response, error?.code === 'LIMIT_REQUEST_BYTES' ? 413 : 400, { code: error?.code || 'INVALID_REQUEST', message: String(error?.message || error) });
      }
      return;
    }
    json(response, 404, { error: 'Not found.' });
  });

  const discoveryPort = Number.isInteger(options.discoveryPort) && (options.discoveryPort as number) >= 0
    ? options.discoveryPort as number
    : STUDIO_LOOPBACK_DISCOVERY_PORT;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(discoveryPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error: any) {
    throw bridgeError(
      'PAIRING_NOT_AVAILABLE',
      discoveryPort === STUDIO_LOOPBACK_DISCOVERY_PORT
        ? `The fixed BOMwiki CAD bridge port ${STUDIO_LOOPBACK_DISCOVERY_PORT} is already in use. Close the other local CAD integration and retry.`
        : 'The requested local CAD bridge port is unavailable.',
      { port: discoveryPort, cause: String(error?.code || error?.message || error) },
    );
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw bridgeError('PAIRING_NOT_AVAILABLE', 'Could not allocate the loopback bridge.');
  serverPort = address.port;
  const localOrigin = `http://127.0.0.1:${serverPort}`;
  const discoveryUrl = `${localOrigin}/.well-known/bomwiki-cad`;
  const launchUrl = `${localOrigin}/launch/${encodeURIComponent(pairingNonce)}`;
  const pairingUrl = `${localOrigin}/pair?studioOrigin=${encodeURIComponent(studioOrigin)}&embed=1&nonce=${encodeURIComponent(pairingNonce)}`;

  const pairingTimer = setTimeout(() => {
    if (state === 'waiting') void close('The Studio pairing request expired.', 'PAIRING_NOT_AVAILABLE');
  }, Math.max(1, pairingExpiresAt - Date.now()));
  pairingTimer.unref();
  const sessionTimer = setTimeout(() => {
    if (!['closing', 'closed'].includes(state)) void close('The live Studio session expired.', 'PERMISSION_EXPIRED');
  }, Math.max(1, sessionExpiresAt - Date.now()));
  sessionTimer.unref();

  async function close(reason = 'The local agent disconnected.', code = 'SESSION_CLOSED'): Promise<void> {
    if (state === 'closed' || state === 'closing') return;
    state = 'closing';
    closeReason = reason;
    closeCode = code;
    clearTimeout(pairingTimer);
    clearTimeout(sessionTimer);
    clearTimeout(recoveryTimer);
    outgoing.splice(0, outgoing.length, { type: 'bridge.close', reason, code });
    wakeOutgoingWaiters();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(bridgeError(code, reason));
    }
    pending.clear();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    state = 'closed';
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return {
    sessionId,
    discoveryUrl,
    launchUrl,
    pairingUrl,
    request(tool, args) {
      if (state !== 'connected') {
        const code = state === 'paused'
          ? 'SESSION_PAUSED'
          : state === 'recovering'
            ? 'SESSION_RECOVERY_REQUIRED'
            : state === 'closing' || state === 'closed'
              ? closeCode || 'SESSION_CLOSED'
              : 'SESSION_NOT_CONNECTED';
        const message = state === 'paused'
          ? 'The user paused this Studio session.'
          : state === 'recovering'
            ? 'Studio reloaded. Resume the session through the approved recovery launch.'
            : state === 'closing' || state === 'closed'
              ? closeReason || 'The live Studio session is closed.'
              : 'Approve the connection request in CAD Studio first.';
        return Promise.reject(bridgeError(code, message));
      }
      if (pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(bridgeError('LIMIT_PENDING_REQUESTS', 'The live Studio session already has 100 pending requests.'));
      const id = 'live-request-' + randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(bridgeError('REQUEST_TIMEOUT', 'The live Studio request timed out.'));
        }, requestTimeoutMs);
        timer.unref();
        pending.set(id, { tool, cancellable: isCancellableTool(tool), resolve, reject, timer });
        enqueueOutgoing({ type: 'tool.request', id, tool, args: structuredClone(args) });
      });
    },
    reconnect() {
      if (state !== 'recovering') {
        throw bridgeError('SESSION_RECOVERY_NOT_AVAILABLE', 'This Studio session is not waiting for recovery.');
      }
      if (!recoveryExpiresAt || recoveryExpiresAt <= Date.now()) {
        throw bridgeError('SESSION_RECOVERY_EXPIRED', 'The Studio recovery window expired.');
      }
      outgoing.splice(0, outgoing.length);
      return {
        launchUrl: `${launchUrl}?recovery=1`,
        recoveryExpiresAt: new Date(recoveryExpiresAt).toISOString(),
      };
    },
    status() {
      return {
        kind: 'live-studio',
        state,
        sessionId,
        clientLabel,
        skillVersion,
        mode,
        projectId,
        revision,
        uiRevision,
        permissionContext: approvedPermissions || permissionContext,
        ...(approvedCapabilities ? { capabilities: approvedCapabilities } : {}),
        discovery: {
          port: serverPort,
          url: discoveryUrl,
          fixed: discoveryPort === STUDIO_LOOPBACK_DISCOVERY_PORT,
        },
        pairingExpiresAt: new Date(pairingExpiresAt).toISOString(),
        sessionExpiresAt: new Date(sessionExpiresAt).toISOString(),
        ...(recoveryExpiresAt ? { recoveryExpiresAt: new Date(recoveryExpiresAt).toISOString() } : {}),
        pendingRequests: pending.size,
        ...(closeReason ? { closeReason } : {}),
        ...(closeCode ? { closeCode } : {}),
      };
    },
    close,
  };
}
