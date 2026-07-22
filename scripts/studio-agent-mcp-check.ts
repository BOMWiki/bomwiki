import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log('  PASS', name);
  } else {
    failed++;
    console.error('  FAIL', name, detail ?? '');
  }
}

const root = await mkdtemp(join(tmpdir(), 'bomwiki-cad-mcp-'));
const child = spawn(process.execPath, [
  '--experimental-strip-types',
  'scripts/studio-agent-mcp.ts',
  '--allow-read', root,
  '--allow-write', root,
  '--permissions', 'project.read,project.create,project.edit,project.save-new,project.save-in-place,artifact.export-project',
], { cwd: join(import.meta.dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] });

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.setEncoding('utf8');
let buffer = '';
const pending: Array<(value: any) => void> = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const resolve = pending.shift();
    if (resolve) resolve(JSON.parse(line));
  }
});

let rpcId = 0;
function rpc(method: string, params?: Record<string, unknown>): Promise<any> {
  return rpcWithId(++rpcId, method, params);
}

function rpcWithId(id: number | string, method: string, params?: Record<string, unknown>): Promise<any> {
  const message = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}. stderr=${stderr}`)), 10_000);
    pending.push((value) => {
      clearTimeout(timer);
      resolve(value);
    });
    child.stdin.write(JSON.stringify(message) + '\n');
  });
}

async function tool(name: string, args: Record<string, unknown>) {
  const response = await rpc('tools/call', { name, arguments: args });
  return response.result;
}

console.log('\nAgent MCP stdio');
const beforeInit = await rpc('tools/list');
check('MCP lifecycle rejects tools before initialization', beforeInit.error?.code === -32002);

const initialized = await rpc('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'bomwiki-deterministic-check', version: '1.0.0' },
});
check('MCP initializes with the stable negotiated protocol', initialized.result?.protocolVersion === '2025-11-25' && initialized.result?.capabilities?.tools);

const listed = await rpc('tools/list');
const toolNames = listed.result?.tools?.map((entry: any) => entry.name) || [];
check('MCP exposes exactly the eight stable CAD tools', toolNames.join(',') === 'cad_capabilities,cad_session,cad_inspect,cad_query,cad_preview,cad_commit,cad_history,cad_artifact');
check('MCP mutating tools describe revision and preview behavior', listed.result.tools.find((entry: any) => entry.name === 'cad_commit').description.includes('revision-bound'));

const capabilities = await tool('cad_capabilities', {});
check('MCP capabilities are structured and machine-readable', capabilities.structuredContent.protocolVersion === 'bomwiki.cad.agent/v1');

const retryMessage = {
  name: 'cad_session',
  arguments: { action: 'create', projectId: 'project-mcp-retry', name: 'MCP retry check' },
};
const retryFirst = await rpcWithId('retry-session-create', 'tools/call', retryMessage);
const retrySecond = await rpcWithId('retry-session-create', 'tools/call', retryMessage);
check('MCP duplicate request ID returns the original completed response without re-execution',
  retryFirst.result.structuredContent.sessionId === retrySecond.result.structuredContent.sessionId);
await tool('cad_session', { action: 'close', sessionId: retryFirst.result.structuredContent.sessionId });

const created = await tool('cad_session', {
  action: 'create',
  projectId: 'project-mcp-check',
  name: 'MCP check',
  permissions: {
    granted: ['project.read', 'project.edit', 'project.save-new', 'artifact.export-project', 'artifact.export-step'],
  },
});
const session = created.structuredContent;
check('MCP creates an isolated permission-scoped session', session.projectId === 'project-mcp-check' && session.revision === 0);
check('MCP cannot enlarge permissions supplied by the server', !session.permissions.granted.includes('artifact.export-step'));

const tx = {
  transactionId: 'tx-mcp-create', label: 'Create MCP housing', expectedRevision: 0, atomic: true,
  operations: [{
    kind: 'feature.extrude',
    input: {
      id: 'feature-mcp-housing', name: 'Housing extrude', bodyName: 'Housing', height: 12,
      sketch: { shapes: [{ kind: 'rect', x: 0, y: 0, w: 20, h: 30 }], z: 0 },
      resultPolicy: { kind: 'new-body', bodyName: 'Housing' },
    },
  }],
  metadata: { actor: 'agent', clientLabel: 'MCP deterministic check' },
};
const preview = await tool('cad_preview', { sessionId: session.sessionId, transaction: tx });
check('MCP preview returns a detached semantic change set', preview.structuredContent.baseRevision === 0 && preview.structuredContent.changeSet.created.some((entry: any) => entry.id === 'body-feature-mcp-housing'));

const beforeCommit = await tool('cad_inspect', { sessionId: session.sessionId, query: { kind: 'project.summary' } });
check('MCP preview did not mutate the session', beforeCommit.structuredContent.result.counts.bodies === 0 && beforeCommit.structuredContent.revision === 0);

const committed = await tool('cad_commit', { sessionId: session.sessionId, previewId: preview.structuredContent.previewId, expectedRevision: 0 });
check('MCP commit creates one revision and normal history entry', committed.structuredContent.revision === 1 && committed.structuredContent.historyEntry.label === 'Create MCP housing');

const inspected = await tool('cad_inspect', { sessionId: session.sessionId, query: { kind: 'project.tree' } });
check('MCP inspection returns the human-editable body and feature',
  inspected.structuredContent.result.items.some((entry: any) => entry.id === 'body-feature-mcp-housing') &&
  inspected.structuredContent.result.items.some((entry: any) => entry.id === 'feature-mcp-housing'));

const advancedPreview = await tool('cad_preview', {
  sessionId: session.sessionId,
  transaction: {
    transactionId: 'tx-mcp-advanced', label: 'Create MCP advanced assembly', expectedRevision: 1, atomic: true,
    operations: [
      { kind: 'datum.create', input: { id: 'datum-mcp-x', name: 'MCP X', datumKind: 'axis', definition: { mode: 'principal', origin: [0, 0, 0], direction: [1, 0, 0] } } },
      { kind: 'body.transform', input: { id: 'feature-mcp-move', name: 'MCP body move', bodyId: 'body-feature-mcp-housing', moveOriginal: true, transform: { mode: 'move', translation: [15, 0, 0] } } },
      { kind: 'assembly.create', input: { id: 'assembly-mcp', name: 'MCP assembly', occurrenceId: 'occurrence-mcp-base', fixed: true } },
      { kind: 'component.duplicate', input: { occurrenceId: 'occurrence-mcp-base', id: 'occurrence-mcp-second', name: 'MCP linked second', baseTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 80, 0, 0, 1] } },
      { kind: 'section.create', input: { id: 'section-mcp', name: 'MCP cutaway', kind: 'plane', planes: [{ normal: [1, 0, 0], offset: 40 }], cap: true } },
    ],
  },
});
const advancedCommitted = await tool('cad_commit', { sessionId: session.sessionId, previewId: advancedPreview.structuredContent.previewId, expectedRevision: 1 });
const advancedTree = await tool('cad_inspect', { sessionId: session.sessionId, query: { kind: 'project.tree', pageSize: 500 } });
check('MCP adapter previews, commits, and semantically inspects advanced assembly operations',
  advancedCommitted.structuredContent.revision === 2 &&
  ['datum-mcp-x', 'feature-mcp-move', 'assembly-mcp', 'occurrence-mcp-second', 'section-mcp']
    .every((id) => advancedTree.structuredContent.result.items.some((entry: any) => entry.id === id)));

const stale = await tool('cad_preview', { sessionId: session.sessionId, transaction: { ...tx, transactionId: 'tx-mcp-stale' } });
check('MCP stale revision returns a typed tool error without mutation', stale.isError === true && stale.structuredContent.code === 'REVISION_CONFLICT');

const projectPath = join(root, 'mcp-project.json');
const saved = await tool('cad_session', { action: 'save', sessionId: session.sessionId, path: projectPath });
const savedProject = JSON.parse(await readFile(projectPath, 'utf8'));
check('MCP save writes a checksummed canonical project inside the approved root', saved.structuredContent.sha256.length === 64 && savedProject.projectId === 'project-mcp-check' && savedProject.rootDocument.kind === 'assembly');

const traversal = await tool('cad_session', { action: 'save', sessionId: session.sessionId, path: join(root, '..', 'escaped-project.json') });
check('MCP rejects path traversal outside the approved output root', traversal.isError === true && traversal.structuredContent.code === 'PATH_OUTSIDE_SCOPE');

const exactExport = await tool('cad_artifact', { sessionId: session.sessionId, format: 'step' });
check('MCP refuses to fake STEP without an exact kernel adapter', exactExport.isError === true && exactExport.structuredContent.code === 'EXACT_KERNEL_REQUIRED');

const closed = await tool('cad_session', { action: 'close', sessionId: session.sessionId });
const afterClose = await tool('cad_inspect', { sessionId: session.sessionId, query: { kind: 'project.summary' } });
check('MCP close revokes the session immediately', closed.structuredContent.closed === true && afterClose.isError === true && afterClose.structuredContent.code === 'SESSION_NOT_FOUND');

const live = await tool('cad_session', {
  action: 'connect',
  clientLabel: 'MCP loopback check',
  permissions: { granted: ['project.read', 'project.edit'] },
});
const liveSession = live.structuredContent;
check('MCP creates an expiring loopback-only Studio pairing',
  liveSession.kind === 'live-studio' && /^http:\/\/127\.0\.0\.1:\d+\/pair#/.test(liveSession.pairingUrl) && liveSession.status.state === 'waiting', liveSession);
if (liveSession.pairingUrl) {
  const pairingPage = await fetch(liveSession.pairingUrl);
  const pairingHtml = await pairingPage.text();
  check('loopback pairing page is no-store and frame-blocked',
    pairingPage.ok && pairingPage.headers.get('cache-control') === 'no-store' && pairingPage.headers.get('content-security-policy')?.includes("frame-ancestors 'none'") && pairingHtml.includes('event.origin !== studioOrigin'));
  const waiting = await tool('cad_session', { action: 'status', sessionId: liveSession.sessionId });
  check('unapproved live session exposes no project data', waiting.structuredContent.status.state === 'waiting' && !waiting.structuredContent.status.projectId);
  const closedLive = await tool('cad_session', { action: 'close', sessionId: liveSession.sessionId });
  check('MCP can revoke an unapproved loopback pairing', closedLive.structuredContent.closed === true);
} else {
  check('loopback pairing page is no-store and frame-blocked', false, liveSession);
  check('unapproved live session exposes no project data', false, liveSession);
  check('MCP can revoke an unapproved loopback pairing', false, liveSession);
}

child.stdin.end();
await new Promise<void>((resolve) => child.once('exit', () => resolve()));
check('MCP writes only protocol messages to stdout', buffer === '');
check('MCP server exits cleanly after stdin closes', child.exitCode === 0, { exitCode: child.exitCode, stderr });

console.log(`\n${passed}/${passed + failed} MCP checks passed`);
if (failed) process.exitCode = 1;
