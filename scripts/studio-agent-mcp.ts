import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { startStudioLoopbackBridge, type StudioLoopbackBridge } from './studio-agent-loopback.ts';

// @ts-expect-error Browser-native module intentionally has no declarations.
import { CadCommandService, cadCapabilityManifest } from '../static/studio-agent-service.js';
// @ts-expect-error Browser-native module intentionally has no declarations.
import { canonicalStudioV5Project, parseOrMigrateStudioV5RuntimeProject } from '../static/studio-v5-runtime-document.js';
import { createEmptyStudioV5PartProject } from '../static/studio-project-v5.js';

const MCP_VERSION = '2025-11-25';
const SERVER_NAME = 'bomwiki-cad';
const SERVER_VERSION = '5A-agent-1';
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_RPC_RESPONSE_CACHE = 1000;
const ALL_TOOL_NAMES = [
  'cad_capabilities',
  'cad_session',
  'cad_inspect',
  'cad_query',
  'cad_preview',
  'cad_commit',
  'cad_history',
  'cad_artifact',
] as const;

type Session = {
  id: string;
  kind: 'headless' | 'live-studio';
  service?: any;
  bridge?: StudioLoopbackBridge;
  permissions: { granted: string[]; projectIds: string[]; operationKinds?: string[]; expiresAt?: string; maxCommits?: number };
  sourcePath?: string;
};

type ServerOptions = {
  readableRoots: string[];
  writableRoots: string[];
  permissions: Set<string>;
};

function parseOptions(argv: string[]): ServerOptions {
  const readableRoots: string[] = [];
  const writableRoots: string[] = [];
  const permissions = new Set<string>(['project.read']);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--allow-read' && value) {
      readableRoots.push(resolve(value));
      index++;
    } else if (flag === '--allow-write' && value) {
      writableRoots.push(resolve(value));
      index++;
    } else if (flag === '--permissions' && value) {
      value.split(',').filter(Boolean).forEach((permission) => permissions.add(permission));
      index++;
    }
  }
  return { readableRoots, writableRoots, permissions };
}

const options = parseOptions(process.argv.slice(2));
const sessions = new Map<string, Session>();
const rpcResponseCache = new Map<string, unknown>();
let initialized = false;

const toolDefinitions = [
  {
    name: 'cad_capabilities',
    description: 'Read-only. Discover the authoritative CAD protocol, operation/query schemas, disabled capability reasons, limits, transports, exports, and permissions before planning work.',
    inputSchema: { type: 'object', additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'cad_session',
    description: 'Create, open, inspect, save, or close an isolated headless CAD session, or create a user-approved loopback pairing for a visible Studio tab. File access stays inside approved roots and live access requires in-app consent.',
    inputSchema: {
      type: 'object', required: ['action'],
      properties: {
        action: { enum: ['create', 'open', 'connect', 'status', 'save', 'close'] },
        sessionId: { type: 'string' }, projectId: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' },
        clientLabel: { type: 'string' }, mode: { enum: ['read-only', 'preview-required', 'scoped-auto-commit'] },
        permissions: { type: 'object' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'cad_inspect',
    description: 'Read-only. Inspect project summary, paginated tree, entity detail, dependencies, search results, or history at the returned revision.',
    inputSchema: { type: 'object', required: ['sessionId', 'query'], properties: { sessionId: { type: 'string' }, query: { type: 'object' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'cad_query',
    description: 'Read-only. Run bounded semantic or exact geometry queries. Exact requests fail rather than fabricate evidence when this server has no exact-kernel adapter.',
    inputSchema: { type: 'object', required: ['sessionId', 'query'], properties: { sessionId: { type: 'string' }, query: { type: 'object' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'cad_preview',
    description: 'Non-persistent mutation phase. Validate one atomic typed transaction against expectedRevision and return an expiring preview plus semantic change set. Never changes the project.',
    inputSchema: { type: 'object', required: ['sessionId', 'transaction'], properties: { sessionId: { type: 'string' }, transaction: { type: 'object' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'cad_commit',
    description: 'Mutating. Commit the exact revision-bound preview as one undoable command. Stale/expired previews fail without mutation; destructive previews should be confirmed by the MCP host.',
    inputSchema: { type: 'object', required: ['sessionId', 'previewId', 'expectedRevision'], properties: { sessionId: { type: 'string' }, previewId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'cad_history',
    description: 'List history/changes read-only, or mutate with revision-controlled undo/redo. History mutations preserve normal project structure and create a new revision.',
    inputSchema: { type: 'object', required: ['sessionId', 'action'], properties: { sessionId: { type: 'string' }, action: { enum: ['list', 'changesSince', 'undo', 'redo'] }, revision: { type: 'integer' }, expectedRevision: { type: 'integer' }, cursor: { type: 'string' }, pageSize: { type: 'integer' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'cad_artifact',
    description: 'Read or write an approved artifact. Project JSON export is available. STEP/STL/render explicitly fail when the session has no exact browser-kernel adapter. File writes require explicit permission and an approved output root.',
    inputSchema: { type: 'object', required: ['sessionId', 'format'], properties: { sessionId: { type: 'string' }, format: { enum: ['project', 'step', 'stl', 'png'] }, path: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function writeMessage(message: unknown) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function rpcCacheKey(message: any) {
  return message && message.id !== undefined && message.id !== null
    ? JSON.stringify(message.id)
    : null;
}

function cacheRpcResponse(key: string, response: unknown) {
  if (!rpcResponseCache.has(key) && rpcResponseCache.size >= MAX_RPC_RESPONSE_CACHE) {
    rpcResponseCache.delete(rpcResponseCache.keys().next().value!);
  }
  rpcResponseCache.set(key, structuredClone(response));
}

function toolResult(value: unknown, isError = false) {
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function requireSession(sessionId: unknown): Session {
  if (typeof sessionId !== 'string' || !sessions.has(sessionId)) throw Object.assign(new Error('Unknown or closed CAD session.'), { code: 'SESSION_NOT_FOUND' });
  return sessions.get(sessionId)!;
}

function intersectPermissions(requested: unknown, projectId: string) {
  const request = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested as Record<string, unknown> : {};
  const requestedGranted = Array.isArray(request.granted) ? request.granted.filter((entry): entry is string => typeof entry === 'string') : [...options.permissions];
  const granted = requestedGranted.filter((permission) => options.permissions.has(permission));
  return {
    granted,
    projectIds: [projectId],
    ...(Array.isArray(request.operationKinds) ? { operationKinds: request.operationKinds.filter((entry): entry is string => typeof entry === 'string') } : {}),
    ...(typeof request.expiresAt === 'string' ? { expiresAt: request.expiresAt } : {}),
    ...(Number.isInteger(request.maxCommits) ? { maxCommits: request.maxCommits as number } : {}),
  };
}

function pendingLivePermissions(requested: unknown) {
  const request = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested as Record<string, unknown> : {};
  const requestedGranted = Array.isArray(request.granted) ? request.granted.filter((entry): entry is string => typeof entry === 'string') : ['project.read'];
  const granted = requestedGranted.filter((permission) => options.permissions.has(permission));
  if (!granted.includes('project.read') && options.permissions.has('project.read')) granted.unshift('project.read');
  return {
    granted,
    projectIds: [],
    ...(Array.isArray(request.operationKinds) ? { operationKinds: request.operationKinds.filter((entry): entry is string => typeof entry === 'string') } : {}),
    ...(typeof request.expiresAt === 'string' ? { expiresAt: request.expiresAt } : {}),
    ...(Number.isInteger(request.maxCommits) ? { maxCommits: request.maxCommits as number } : {}),
  };
}

async function canonicalRoot(root: string) {
  return realpath(root);
}

function isInside(root: string, candidate: string) {
  const suffix = relative(root, candidate);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

async function resolveReadablePath(input: unknown) {
  if (typeof input !== 'string' || !input) throw Object.assign(new Error('A project path is required.'), { code: 'INVALID_PATH' });
  const candidate = await realpath(resolve(input));
  const roots = await Promise.all(options.readableRoots.map(canonicalRoot));
  if (!roots.some((root) => isInside(root, candidate))) throw Object.assign(new Error('Project path is outside the approved readable roots.'), { code: 'PATH_OUTSIDE_SCOPE' });
  const details = await stat(candidate);
  if (!details.isFile()) throw Object.assign(new Error('Project path must name a regular file.'), { code: 'INVALID_PATH' });
  return candidate;
}

async function resolveWritablePath(input: unknown) {
  if (typeof input !== 'string' || !input) throw Object.assign(new Error('An output path is required.'), { code: 'INVALID_PATH' });
  const candidate = resolve(input);
  const parent = await realpath(dirname(candidate));
  const roots = await Promise.all(options.writableRoots.map(canonicalRoot));
  if (!roots.some((root) => isInside(root, parent))) throw Object.assign(new Error('Output path is outside the approved writable roots.'), { code: 'PATH_OUTSIDE_SCOPE' });
  try {
    const existing = await realpath(candidate);
    if (!roots.some((root) => isInside(root, existing))) throw Object.assign(new Error('Output symlink escapes the approved writable roots.'), { code: 'PATH_OUTSIDE_SCOPE' });
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return candidate;
}

function requirePermission(session: Session, permission: string) {
  if (!session.permissions.granted.includes(permission)) throw Object.assign(new Error('Permission "' + permission + '" is required.'), { code: 'PERMISSION_DENIED' });
}

async function sessionTool(args: Record<string, any>) {
  const action = args.action;
  if (action === 'create') {
    if (!options.permissions.has('project.create')) throw Object.assign(new Error('Server does not grant project.create.'), { code: 'PERMISSION_DENIED' });
    const projectId = typeof args.projectId === 'string' && args.projectId ? args.projectId : 'project-' + randomUUID();
    const project = createEmptyStudioV5PartProject({ projectId, name: args.name || 'Agent part', units: 'mm' });
    const sessionId = 'session-' + randomUUID();
    const session: Session = { id: sessionId, kind: 'headless', service: new CadCommandService({ project }), permissions: intersectPermissions(args.permissions, projectId) };
    sessions.set(sessionId, session);
    return { sessionId, projectId, revision: 0, permissions: session.permissions, summary: session.service!.inspect() };
  }
  if (action === 'open') {
    requireServerPermission('project.read');
    const sourcePath = await resolveReadablePath(args.path);
    const project = parseOrMigrateStudioV5RuntimeProject(await readFile(sourcePath, 'utf8'));
    const sessionId = 'session-' + randomUUID();
    const session: Session = {
      id: sessionId,
      kind: 'headless',
      service: new CadCommandService({ project }),
      permissions: intersectPermissions(args.permissions, project.projectId),
      sourcePath,
    };
    sessions.set(sessionId, session);
    return { sessionId, projectId: project.projectId, revision: 0, permissions: session.permissions, sourcePath, summary: session.service!.inspect() };
  }
  if (action === 'connect') {
    requireServerPermission('project.read');
    const permissions = pendingLivePermissions(args.permissions);
    const bridge = await startStudioLoopbackBridge({
      clientLabel: args.clientLabel,
      mode: args.mode,
      permissionContext: permissions,
    });
    const session: Session = { id: bridge.sessionId, kind: 'live-studio', bridge, permissions };
    sessions.set(session.id, session);
    return {
      sessionId: session.id,
      kind: session.kind,
      pairingUrl: bridge.pairingUrl,
      status: bridge.status(),
      instructions: 'In CAD Studio, open Help, choose Connect local agent, paste pairingUrl, and approve the requested scopes. Then call cad_session status until state is connected.',
    };
  }
  const session = requireSession(args.sessionId);
  if (action === 'status') {
    if (session.kind === 'live-studio') return { sessionId: session.id, permissions: session.permissions, status: session.bridge!.status() };
    return { sessionId: session.id, permissions: session.permissions, sourcePath: session.sourcePath, summary: session.service!.inspect() };
  }
  if (action === 'save') {
    if (session.kind === 'live-studio') throw Object.assign(new Error('Use cad_artifact for an approved live Studio project export.'), { code: 'LIVE_SAVE_REQUIRES_ARTIFACT' });
    const saveInPlace = !args.path && session.sourcePath;
    requirePermission(session, saveInPlace ? 'project.save-in-place' : 'project.save-new');
    const target = await resolveWritablePath(args.path || session.sourcePath);
    const text = JSON.stringify(canonicalStudioV5Project(session.service!.snapshot()), null, 2) + '\n';
    await writeFile(target, text, { encoding: 'utf8', mode: 0o600 });
    const checksum = createHash('sha256').update(text).digest('hex');
    session.sourcePath = target;
    return { sessionId: session.id, path: target, bytes: Buffer.byteLength(text), sha256: checksum, revision: session.service!.revision };
  }
  if (action === 'close') {
    await session.bridge?.close('The MCP client closed the live Studio session.');
    sessions.delete(session.id);
    return { sessionId: session.id, closed: true };
  }
  throw Object.assign(new Error('Unknown cad_session action.'), { code: 'INVALID_ACTION' });
}

function requireServerPermission(permission: string) {
  if (!options.permissions.has(permission)) throw Object.assign(new Error('Server does not grant ' + permission + '.'), { code: 'PERMISSION_DENIED' });
}

async function artifactTool(args: Record<string, any>) {
  const session = requireSession(args.sessionId);
  if (session.kind === 'live-studio') return session.bridge!.request('cad_artifact', args);
  if (args.format !== 'project') throw Object.assign(new Error('This headless session has no exact browser-kernel adapter for ' + args.format + '.'), { code: 'EXACT_KERNEL_REQUIRED' });
  requirePermission(session, 'artifact.export-project');
  const text = JSON.stringify(canonicalStudioV5Project(session.service!.snapshot()), null, 2) + '\n';
  const result: Record<string, unknown> = {
    format: 'project',
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    documentHash: session.service!.inspect().documentHash,
  };
  if (args.path) {
    requirePermission(session, 'project.save-new');
    const target = await resolveWritablePath(args.path);
    await writeFile(target, text, { encoding: 'utf8', mode: 0o600 });
    result.path = target;
  } else result.text = text;
  return result;
}

async function callTool(name: string, args: Record<string, any>) {
  if (!ALL_TOOL_NAMES.includes(name as any)) throw Object.assign(new Error('Unknown CAD tool "' + name + '".'), { code: 'TOOL_NOT_FOUND' });
  if (name === 'cad_capabilities') return cadCapabilityManifest({ exactKernel: false });
  if (name === 'cad_session') return sessionTool(args);
  if (name === 'cad_artifact') return artifactTool(args);
  const session = requireSession(args.sessionId);
  if (session.kind === 'live-studio') return session.bridge!.request(name, args);
  if (name === 'cad_inspect') {
    requirePermission(session, 'project.read');
    return { revision: session.service!.revision, result: session.service!.inspect(args.query || {}) };
  }
  if (name === 'cad_query') {
    requirePermission(session, 'project.read');
    return { revision: session.service!.revision, result: await session.service!.query(args.query || {}) };
  }
  if (name === 'cad_preview') return session.service!.preview(args.transaction, session.permissions);
  if (name === 'cad_commit') return session.service!.commit(args.previewId, args.expectedRevision, session.permissions);
  if (name === 'cad_history') return session.service!.historyAction(args, session.permissions);
  throw Object.assign(new Error('Unsupported CAD tool.'), { code: 'TOOL_NOT_FOUND' });
}

async function handle(message: any) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return jsonRpcError(message?.id, -32600, 'Invalid JSON-RPC request.');
  if (message.method === 'initialize') {
    initialized = true;
    return jsonRpcResult(message.id, {
      protocolVersion: MCP_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: 'Call cad_capabilities first. Use cad_preview before cad_commit. Never infer disabled CAD operations from UI labels.',
    });
  }
  if (message.method === 'notifications/initialized') {
    initialized = true;
    return null;
  }
  if (message.method === 'ping') return jsonRpcResult(message.id, {});
  if (!initialized) return jsonRpcError(message.id, -32002, 'MCP server is not initialized.');
  if (message.method === 'tools/list') return jsonRpcResult(message.id, { tools: toolDefinitions });
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (typeof name !== 'string') return jsonRpcError(message.id, -32602, 'tools/call requires a tool name.');
    try {
      const value = await callTool(name, message.params?.arguments || {});
      return jsonRpcResult(message.id, toolResult(value));
    } catch (error: any) {
      return jsonRpcResult(message.id, toolResult({
        code: error?.code || 'CAD_TOOL_FAILED',
        message: String(error?.message || error),
        ...(error?.details ? { details: error.details } : {}),
      }, true));
    }
  }
  return jsonRpcError(message.id, -32601, 'Method not found.');
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let inputQueue = Promise.resolve();

async function processLine(line: string) {
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    writeMessage(jsonRpcError(null, -32700, 'MCP message exceeds the 2 MiB line limit.'));
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    writeMessage(jsonRpcError(null, -32700, 'Invalid JSON.'));
    return;
  }
  if (Array.isArray(message)) {
    writeMessage(jsonRpcError(null, -32600, 'JSON-RPC batches are not accepted during this MCP lifecycle.'));
    return;
  }
  const cacheKey = rpcCacheKey(message);
  if (cacheKey && rpcResponseCache.has(cacheKey)) {
    writeMessage(structuredClone(rpcResponseCache.get(cacheKey)));
    return;
  }
  const response = await handle(message);
  if (response) {
    if (cacheKey) cacheRpcResponse(cacheKey, response);
    writeMessage(response);
  }
}

input.on('line', (line) => {
  // Keep stdio calls ordered. This prevents concurrent duplicate requests from
  // racing before the completed-response cache is populated.
  inputQueue = inputQueue.then(() => processLine(line)).catch((error) => {
    writeMessage(jsonRpcError(null, -32603, 'Internal MCP processing error.', String(error?.message || error)));
  });
});

async function closeAllSessions() {
  await Promise.all([...sessions.values()].map((session) => session.bridge?.close('The MCP process ended.')));
  sessions.clear();
}

input.on('close', () => {
  inputQueue = inputQueue.then(closeAllSessions);
});
