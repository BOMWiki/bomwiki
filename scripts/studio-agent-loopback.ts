import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const MAX_EXCHANGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90 * 1000;
const MAX_PENDING_REQUESTS = 100;

type BridgeMessage = Record<string, unknown> & { type: string };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error & { code?: string; details?: unknown }) => void;
  timer: NodeJS.Timeout;
};

export type StudioLoopbackBridge = {
  sessionId: string;
  pairingUrl: string;
  request(tool: string, args: Record<string, unknown>): Promise<unknown>;
  status(): Record<string, unknown>;
  close(reason?: string): Promise<void>;
};

function bridgeError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
  return Object.assign(new Error(message), { code, ...(details === undefined ? {} : { details }) });
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function pairingPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOMwiki CAD agent bridge</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111922;color:#d9e5ef;font:14px system-ui,sans-serif}.card{width:min(440px,calc(100vw - 32px));padding:24px;border:1px solid #33465a;border-radius:10px;background:#1b2734;box-shadow:0 20px 60px #0008}.eyebrow{font-size:11px;letter-spacing:.14em;color:#78b9ed}h1{font-size:20px;margin:8px 0}p{color:#9eb2c5;line-height:1.5}.state{margin-top:18px;padding:10px;border-radius:6px;background:#111b26;color:#bcd0df}</style>
</head><body><main class="card"><div class="eyebrow">LOCAL STRUCTURED CONNECTION</div><h1>BOMwiki CAD agent bridge</h1><p>This page relays typed CAD requests between the local MCP process and the Studio tab that opened it. It cannot read that tab's DOM, cookies, storage, or any other page.</p><div class="state" id="state">Connecting to the local adapter…</div></main>
<script nonce="bomwiki-cad-agent">
(() => {
  const state = document.getElementById('state');
  const secret = decodeURIComponent(location.hash.slice(1));
  const studioOrigin = new URL(location.href).searchParams.get('studioOrigin');
  const pending = [];
  let stopped = false;
  if (!secret || !window.opener || !/^https?:\\/\\/[^/]+$/.test(studioOrigin || '')) {
    state.textContent = !secret ? 'This pairing link is incomplete.' : 'Open this pairing link from CAD Studio so the two windows can be bound safely.';
    return;
  }
  addEventListener('message', (event) => {
    if (event.source !== window.opener || event.origin !== studioOrigin || event.data?.source !== 'bomwiki-cad-studio' || !event.data.message) return;
    pending.push(event.data.message);
  });
  async function exchange() {
    if (stopped) return;
    try {
      const messages = pending.splice(0, pending.length);
      const response = await fetch('/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bomwiki-cad-secret': secret },
        body: JSON.stringify({ messages }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('The local adapter rejected this pairing.');
      const body = await response.json();
      for (const message of body.messages || []) {
        window.opener.postMessage({ source: 'bomwiki-cad-loopback', message }, studioOrigin);
        if (message.type === 'pairing.request') state.textContent = 'Waiting for approval in CAD Studio…';
        if (message.type === 'bridge.close') {
          stopped = true;
          state.textContent = message.reason || 'The local agent disconnected.';
        }
      }
      if (!stopped) setTimeout(exchange, body.messages?.length ? 20 : 140);
    } catch (error) {
      stopped = true;
      state.textContent = String(error?.message || error);
    }
  }
  addEventListener('beforeunload', () => pending.push({ type: 'studio.closed' }));
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
  requestTimeoutMs?: number;
}): Promise<StudioLoopbackBridge> {
  const sessionId = 'studio-loopback-' + randomUUID();
  const secret = randomUUID() + randomUUID();
  const clientLabel = String(options.clientLabel || 'Local CAD agent').trim().slice(0, 80) || 'Local CAD agent';
  const mode = ['read-only', 'preview-required', 'scoped-auto-commit'].includes(String(options.mode)) ? options.mode : 'preview-required';
  const permissionContext = structuredClone(options.permissionContext || {});
  const createdAt = Date.now();
  const expiresAt = createdAt + (options.pairingTtlMs || DEFAULT_PAIRING_TTL_MS);
  const requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
  const outgoing: BridgeMessage[] = [{
    type: 'pairing.request',
    protocol: 'bomwiki.cad.agent/v1',
    sessionId,
    clientLabel,
    mode,
    permissionContext,
  }];
  const pending = new Map<string, PendingRequest>();
  let state: 'waiting' | 'connected' | 'closing' | 'closed' = 'waiting';
  let projectId: string | undefined;
  let revision: number | undefined;
  let approvedPermissions: unknown;
  let closeReason: string | undefined;

  function settle(message: BridgeMessage): void {
    if (message.type === 'pairing.approved') {
      if (state !== 'waiting') return;
      state = 'connected';
      projectId = typeof message.projectId === 'string' ? message.projectId : undefined;
      revision = Number.isInteger(message.revision) ? message.revision as number : undefined;
      approvedPermissions = message.permissionContext;
      return;
    }
    if (message.type === 'pairing.denied') {
      closeReason = typeof message.message === 'string' ? message.message : 'The user denied the Studio connection.';
      void close(closeReason);
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
      } else entry.resolve(message.result);
      return;
    }
    if (message.type === 'studio.closed' || message.type === 'session.revoked') {
      void close(typeof message.reason === 'string' ? message.reason : 'The live Studio session closed.');
    }
  }

  const server = createServer(async (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'Loopback clients only.' });
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/pair') {
      const body = pairingPage();
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'nonce-bomwiki-cad-agent'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      response.end(body);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/exchange') {
      if (request.headers['x-bomwiki-cad-secret'] !== secret || state === 'closed') {
        json(response, 403, { error: 'Unknown or expired pairing secret.' });
        return;
      }
      try {
        const body = await readExchangeBody(request);
        const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100) : [];
        for (const candidate of messages) {
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof (candidate as { type?: unknown }).type === 'string') settle(candidate as BridgeMessage);
        }
        json(response, 200, { messages: outgoing.splice(0, outgoing.length), state });
      } catch (error: any) {
        json(response, error?.code === 'LIMIT_REQUEST_BYTES' ? 413 : 400, { code: error?.code || 'INVALID_REQUEST', message: String(error?.message || error) });
      }
      return;
    }
    json(response, 404, { error: 'Not found.' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw bridgeError('LOOPBACK_FAILED', 'Could not allocate a loopback bridge port.');
  const pairingUrl = `http://127.0.0.1:${address.port}/pair#${encodeURIComponent(secret)}`;

  const pairingTimer = setTimeout(() => {
    if (state === 'waiting') void close('The Studio pairing request expired.');
  }, Math.max(1, expiresAt - Date.now()));
  pairingTimer.unref();

  async function close(reason = 'The local agent disconnected.'): Promise<void> {
    if (state === 'closed' || state === 'closing') return;
    state = 'closing';
    closeReason = reason;
    clearTimeout(pairingTimer);
    outgoing.splice(0, outgoing.length, { type: 'bridge.close', reason });
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(bridgeError('SESSION_CLOSED', reason));
    }
    pending.clear();
    // Keep the authenticated exchange endpoint alive for one polling turn so
    // the bridge page can relay the close event into Studio. New CAD requests
    // are already refused while state is `closing`.
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    state = 'closed';
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return {
    sessionId,
    pairingUrl,
    request(tool, args) {
      if (state !== 'connected') {
        const closing = state === 'closing' || state === 'closed';
        return Promise.reject(bridgeError(closing ? 'SESSION_CLOSED' : 'SESSION_NOT_CONNECTED', closing ? closeReason || 'The live Studio session is closed.' : 'Approve the pairing request in CAD Studio first.'));
      }
      if (pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(bridgeError('LIMIT_PENDING_REQUESTS', 'The live Studio session already has 100 pending requests.'));
      const id = 'live-request-' + randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(bridgeError('REQUEST_TIMEOUT', 'The live Studio request timed out.'));
        }, requestTimeoutMs);
        timer.unref();
        pending.set(id, { resolve, reject, timer });
        outgoing.push({ type: 'tool.request', id, tool, args: structuredClone(args) });
      });
    },
    status() {
      return {
        kind: 'live-studio',
        state,
        sessionId,
        clientLabel,
        projectId,
        revision,
        permissionContext: approvedPermissions || permissionContext,
        expiresAt: new Date(expiresAt).toISOString(),
        pendingRequests: pending.size,
        ...(closeReason ? { closeReason } : {}),
      };
    },
    close,
  };
}
