// The write path: propose -> validate -> pending -> accept/reject -> revisions.
// Proposed snapshots live in changeset_edits until a reviewer accepts; apply
// is transactional with optimistic concurrency against base_rev.
import { pool } from './db.ts';
import {
  getNode,
  lineCount,
  loadedDatabaseUrl,
  loadGraph,
  type BomLine,
  type NodeData,
} from './nodes.ts';

export interface Snapshot {
  name: string;
  kind: 'product' | 'assembly' | 'part';
  domain?: string;
  summary?: string;
  standard?: string;
  material?: string;
  bom?: BomLine[];
}

export interface ProposedEdit {
  op: 'edit' | 'create';
  nodeId: string;
  baseRev?: number;
  data: Snapshot;
}

export interface PendingChangeset {
  id: number;
  author: string;
  createdAt: string;
  summary: string | null;
  edits: { nodeId: string; op: string; baseRev: number | null; summary: string }[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

function snapshotOf(node: NodeData): Snapshot {
  const { id, ...data } = node;
  return data;
}

/** Plain-language lines describing base -> next; one vocabulary for the
 *  change bar, the review queue, and history. */
export function semanticDiff(base: Snapshot | null, next: Snapshot): string[] {
  const lines: string[] = [];
  const name = next.name;
  if (!base) {
    lines.push(`Created ${name} (${next.kind})${next.summary ? ` — "${next.summary}"` : ''}`);
    for (const l of next.bom ?? []) {
      lines.push(`Added ${getNode(l.id)?.name ?? l.id} × ${l.qty}`);
    }
    return lines;
  }
  for (const field of ['name', 'summary', 'material', 'standard', 'domain'] as const) {
    const a = base[field] ?? '';
    const b = next[field] ?? '';
    if (a !== b) {
      lines.push(a && b ? `${field} changed to "${b}"` : b ? `${field} set to "${b}"` : `${field} removed`);
    }
  }
  const baseLines = new Map((base.bom ?? []).map((l) => [l.id, l]));
  const nextLines = new Map((next.bom ?? []).map((l) => [l.id, l]));
  for (const [id, l] of nextLines) {
    const nodeName = getNode(id)?.name ?? id;
    const b = baseLines.get(id);
    if (!b) {
      lines.push(`Added ${nodeName} × ${l.qty}${l.note ? ` — "${l.note}"` : ''}`);
    } else {
      if (b.qty !== l.qty) lines.push(`${nodeName} quantity ${b.qty} → ${l.qty}`);
      if ((b.note ?? '') !== (l.note ?? '')) lines.push(`${nodeName} note updated`);
    }
  }
  for (const [id] of baseLines) {
    if (!nextLines.has(id)) lines.push(`Removed ${getNode(id)?.name ?? id}`);
  }
  return lines;
}

/** Validation against the live graph plus the changeset's own creates. */
export function validateEdits(edits: ProposedEdit[]): string[] {
  const errors: string[] = [];
  const created = new Set(edits.filter((e) => e.op === 'create').map((e) => e.nodeId));
  const proposedBom = new Map<string, BomLine[]>();
  for (const e of edits) proposedBom.set(e.nodeId, e.data.bom ?? []);

  if (edits.length === 0) errors.push('changeset has no edits');
  const seen = new Set<string>();
  for (const e of edits) {
    if (seen.has(e.nodeId)) errors.push(`${e.nodeId}: appears twice in one changeset`);
    seen.add(e.nodeId);
    if (!ID_RE.test(e.nodeId)) errors.push(`${e.nodeId}: invalid id`);
    if (!e.data.name?.trim()) errors.push(`${e.nodeId}: name is required`);
    if (!['product', 'assembly', 'part'].includes(e.data.kind)) {
      errors.push(`${e.nodeId}: invalid kind`);
    }
    if (e.op === 'create' && getNode(e.nodeId)) errors.push(`${e.nodeId}: already exists`);
    if (e.op === 'edit' && !getNode(e.nodeId)) errors.push(`${e.nodeId}: does not exist`);
    if (e.op === 'edit' && !e.baseRev) errors.push(`${e.nodeId}: baseRev is required`);
    const lineIds = new Set<string>();
    for (const l of e.data.bom ?? []) {
      if (!Number.isInteger(l.qty) || l.qty < 1) {
        errors.push(`${e.nodeId}: quantity for ${l.id} must be a positive integer`);
      }
      if (lineIds.has(l.id)) errors.push(`${e.nodeId}: duplicate BOM line ${l.id}`);
      lineIds.add(l.id);
      if (l.id === e.nodeId) errors.push(`${e.nodeId}: cannot contain itself`);
      if (!getNode(l.id) && !created.has(l.id)) {
        errors.push(`${e.nodeId}: unknown component ${l.id}`);
      }
    }
  }

  // Cycle check: walk down from each edited node through the proposed graph.
  const childIds = (id: string): string[] => {
    const bom = proposedBom.get(id) ?? getNode(id)?.bom ?? [];
    return bom.map((l) => l.id);
  };
  for (const e of edits) {
    const stack = [...childIds(e.nodeId)];
    const visited = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === e.nodeId) {
        errors.push(`${e.nodeId}: change would create a cycle`);
        break;
      }
      if (visited.has(cur)) continue;
      visited.add(cur);
      stack.push(...childIds(cur));
    }
  }
  return errors;
}

export async function createChangeset(
  authorId: number,
  edits: ProposedEdit[],
  summary?: string,
): Promise<{ id?: number; errors?: string[] }> {
  const errors = validateEdits(edits);
  if (errors.length) return { errors };

  const client = await pool.connect();
  try {
    await client.query('begin');
    const cs = await client.query(
      'insert into changesets (author_id, summary) values ($1, $2) returning id',
      [authorId, summary ?? null],
    );
    for (const e of edits) {
      const base = e.op === 'edit' ? snapshotOf(getNode(e.nodeId)!) : null;
      const lines = semanticDiff(base, e.data);
      await client.query(
        'insert into changeset_edits (changeset_id, node_id, op, base_rev, data, summary) values ($1, $2, $3, $4, $5, $6)',
        [cs.rows[0].id, e.nodeId, e.op, e.baseRev ?? null, JSON.stringify(e.data), lines.join('\n')],
      );
    }
    await client.query('commit');
    return { id: cs.rows[0].id };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function listPending(): Promise<PendingChangeset[]> {
  const res = await pool.query(
    `select c.id, u.handle as author, c.created_at, c.summary,
            json_agg(json_build_object('nodeId', e.node_id, 'op', e.op, 'baseRev', e.base_rev, 'summary', e.summary) order by e.id) as edits
     from changesets c
     join users u on u.id = c.author_id
     join changeset_edits e on e.changeset_id = c.id
     where c.status = 'pending'
     group by c.id, u.handle
     order by c.id`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    author: r.author,
    createdAt: r.created_at.toISOString(),
    summary: r.summary,
    edits: r.edits,
  }));
}

export async function decideChangeset(
  id: number,
  reviewerId: number,
  decision: 'accepted' | 'rejected',
): Promise<{ ok: boolean; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const cs = await client.query(
      "select id from changesets where id = $1 and status = 'pending' for update",
      [id],
    );
    if (cs.rows.length === 0) {
      await client.query('rollback');
      return { ok: false, error: 'changeset is not pending' };
    }

    if (decision === 'accepted') {
      const edits = await client.query(
        'select node_id, op, base_rev, data, summary from changeset_edits where changeset_id = $1 order by id',
        [id],
      );
      for (const e of edits.rows) {
        if (e.op === 'create') {
          await client.query(
            "insert into nodes (id, kind, pos) values ($1, $2, nextval('node_pos_seq'))",
            [e.node_id, e.data.kind],
          );
        } else {
          const cur = await client.query('select current_rev from nodes where id = $1 for update', [
            e.node_id,
          ]);
          if (cur.rows.length === 0) {
            await client.query('rollback');
            return { ok: false, error: `${e.node_id} no longer exists` };
          }
          if (Number(cur.rows[0].current_rev) !== Number(e.base_rev)) {
            await client.query('rollback');
            return {
              ok: false,
              error: `${e.node_id} changed since this was proposed (rev ${cur.rows[0].current_rev} vs base ${e.base_rev}); reject and re-propose`,
            };
          }
        }
        const rev = await client.query(
          'insert into revisions (node_id, changeset_id, data, summary) values ($1, $2, $3, $4) returning rev',
          [e.node_id, id, JSON.stringify(e.data), e.summary],
        );
        await client.query('update nodes set current_rev = $1 where id = $2', [
          rev.rows[0].rev,
          e.node_id,
        ]);
      }
    }

    await client.query(
      'update changesets set status = $2, reviewer_id = $3, decided_at = now() where id = $1',
      [id, decision, reviewerId],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  if (decision === 'accepted') await loadGraph(loadedDatabaseUrl());
  return { ok: true };
}

/** Restore a node to an old revision via an auto-accepted changeset. */
export async function revertNode(
  nodeId: string,
  toRev: number,
  userId: number,
): Promise<{ ok: boolean; error?: string }> {
  const old = await pool.query('select data from revisions where rev = $1 and node_id = $2', [
    toRev,
    nodeId,
  ]);
  if (old.rows.length === 0) return { ok: false, error: 'no such revision' };
  const node = getNode(nodeId);
  if (!node) return { ok: false, error: 'no such node' };
  const cur = await pool.query('select current_rev from nodes where id = $1', [nodeId]);
  const created = await createChangeset(
    userId,
    [{ op: 'edit', nodeId, baseRev: Number(cur.rows[0].current_rev), data: old.rows[0].data }],
    `Revert ${node.name} to r${toRev}`,
  );
  if (created.errors) return { ok: false, error: created.errors.join('; ') };
  return decideChangeset(created.id!, userId, 'accepted');
}
