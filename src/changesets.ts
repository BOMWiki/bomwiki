// The write path: propose -> validate -> pending -> accept/reject -> revisions.
// Proposed snapshots live in changeset_edits until a reviewer accepts; apply
// is transactional with optimistic concurrency against base_rev.
import { pool } from './db.ts';
import {
  applyAcceptedEdits,
  currentRev,
  getNode,
  lineCount,
  type AppliedEdit,
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
  analysis: { severity: string; text: string }[] | null;
  edits: { nodeId: string; op: string; baseRev: number | null; summary: string }[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** The editable snapshot of a node: everything except its id. Used by the
 *  diff/merge paths and by the editor embed, so client and server agree on
 *  exactly which fields round-trip through an edit. */
export function snapshotOf(node: NodeData): Snapshot {
  const { id, ...data } = node;
  return data;
}

// The scalar (non-BOM) fields of a snapshot, in one place so the diff and the
// merge agree on exactly which fields to compare. Add a field here and both
// the change summary and three-way merge pick it up.
const SCALAR_FIELDS = ['name', 'kind', 'domain', 'summary', 'standard', 'material'] as const;

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
  for (const field of SCALAR_FIELDS) {
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
  // Ignore malformed edits (missing/blank id, missing data) up front so the
  // checks below never dereference undefined. A malformed payload is a client
  // bug; report it as a validation error rather than a 500.
  const wellFormed = edits.filter((e) => e && typeof e.nodeId === 'string' && e.data);
  for (const e of edits) {
    if (!e || typeof e.nodeId !== 'string' || !e.data) {
      errors.push('malformed edit: each edit needs a nodeId and a data object');
    }
  }
  const created = new Set(wellFormed.filter((e) => e.op === 'create').map((e) => e.nodeId));
  const proposedBom = new Map<string, BomLine[]>();
  for (const e of wellFormed) proposedBom.set(e.nodeId, e.data.bom ?? []);

  if (edits.length === 0) errors.push('changeset has no edits');
  const seen = new Set<string>();
  for (const e of wellFormed) {
    if (seen.has(e.nodeId)) errors.push(`${e.nodeId}: appears twice in one changeset`);
    seen.add(e.nodeId);
    // Only newly-created ids must match the strict slug form. Edits target
    // existing nodes (checked below via getNode); some imported ids predate
    // this rule and legitimately contain other characters.
    if (e.op === 'create' && !ID_RE.test(e.nodeId)) errors.push(`${e.nodeId}: invalid id`);
    if (e.op !== 'edit' && e.op !== 'create') errors.push(`${e.nodeId}: invalid op`);
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

const AUTOCONFIRM_EDITS = Number(process.env.AUTOCONFIRM_EDITS ?? 4);
// Days an account must exist before autoconfirm. 0 by default so local dev
// and the smoke suites exercise the crossing; production sets 3+ (see the
// env checklist) so edit-farming an afternoon of typo fixes earns nothing.
const AUTOCONFIRM_DAYS = Number(process.env.AUTOCONFIRM_DAYS ?? 0);
const MAX_PENDING_PER_USER = 10;
const MAX_PROPOSALS_PER_HOUR = 20;
const MAX_PROPOSALS_PER_HOUR_AUTOCONFIRMED = 120;

/** The trust ladder: admins and reviewers always publish directly; a
 *  contributor earns it with enough accepted changesets AND account age.
 *  Both are required — edits alone can be farmed in an afternoon, age alone
 *  proves nothing. */
export async function isAutoconfirmed(userId: number, role: string): Promise<boolean> {
  if (role === 'admin' || role === 'reviewer') return true;
  const res = await pool.query(
    `select
       (select count(*)::int from changesets where author_id = $1 and status = 'accepted') as accepted,
       (select created_at < now() - make_interval(days => $2) from users where id = $1) as aged`,
    [userId, AUTOCONFIRM_DAYS],
  );
  return res.rows[0].accepted >= AUTOCONFIRM_EDITS && res.rows[0].aged === true;
}

/** Rate limits scale with trust: new contributors get the tight caps, the
 *  autoconfirmed get room for real cleanup sessions, reviewers and admins
 *  (who staff the queue and revert vandalism) are exempt. */
async function rateLimitError(userId: number, autoconfirmed: boolean): Promise<string | null> {
  const res = await pool.query(
    `select
       count(*) filter (where status = 'pending')::int as pending,
       count(*) filter (where created_at > now() - interval '1 hour')::int as lastHour
     from changesets where author_id = $1`,
    [userId],
  );
  if (!autoconfirmed && res.rows[0].pending >= MAX_PENDING_PER_USER) {
    return 'You have too many changes waiting for review; please wait for those first.';
  }
  const hourly = autoconfirmed ? MAX_PROPOSALS_PER_HOUR_AUTOCONFIRMED : MAX_PROPOSALS_PER_HOUR;
  if (res.rows[0].lasthour >= hourly) {
    return 'Rate limit: too many proposals in the last hour.';
  }
  return null;
}

/** Three-way merge of node snapshots. Structured data makes this far more
 *  forgiving than text: scalars merge per field, BOM lines merge per child
 *  id. Only genuinely overlapping changes (both sides touched the same
 *  field or the same line, differently) are conflicts. */
export function mergeSnapshots(
  base: Snapshot,
  mine: Snapshot,
  current: Snapshot,
): { merged?: Snapshot; conflicts?: string[] } {
  const conflicts: string[] = [];
  const merged: Snapshot = { ...current };

  for (const f of SCALAR_FIELDS) {
    const b = base[f] ?? '';
    const m = mine[f] ?? '';
    const c = current[f] ?? '';
    if (m === b) continue; // I didn't touch it; current stands.
    if (c === b || c === m) {
      const target = merged as unknown as Record<string, unknown>;
      if (m) target[f] = mine[f];
      else delete target[f];
    } else {
      conflicts.push(`${f}: you and a newer revision changed it differently`);
    }
  }

  const key = (l: BomLine) => `${l.qty} ${l.note ?? ''}`;
  const bBom = new Map((base.bom ?? []).map((l) => [l.id, l]));
  const mBom = new Map((mine.bom ?? []).map((l) => [l.id, l]));
  const cBom = new Map((current.bom ?? []).map((l) => [l.id, l]));
  const out: BomLine[] = [];

  const ids = new Set<string>([...bBom.keys(), ...mBom.keys(), ...cBom.keys()]);
  for (const id of cBom.keys()) ids.delete(id);
  const ordered = [...cBom.keys(), ...ids]; // current's order, then additions

  for (const id of ordered) {
    const b = bBom.get(id);
    const m = mBom.get(id);
    const c = cBom.get(id);
    const mineChanged = (b && !m) || (!b && m) || (b && m && key(b) !== key(m));
    const curChanged = (b && !c) || (!b && c) || (b && c && key(b) !== key(c));
    if (!mineChanged) {
      if (c) out.push(c);
      continue;
    }
    if (!curChanged) {
      if (m) out.push(m);
      continue;
    }
    // Both sides touched this line. Agreement is not a conflict: both removed
    // it (m and c both absent) or both set it to the same value.
    if (!m && !c) {
      continue;
    }
    if (m && c && key(m) === key(c)) {
      out.push(c);
    } else {
      conflicts.push(`${id}: you and a newer revision changed this line differently`);
    }
  }

  if (out.length) merged.bom = out;
  else delete merged.bom;
  if (conflicts.length) return { conflicts };
  return { merged };
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
    const newId = Number(cs.rows[0].id);

    // Machine findings run detached: the propose response never waits on the
    // sidecar (its round-trip and timeout would otherwise be added to every
    // save), and a failed or absent sidecar just leaves analysis null.
    void attachAnalysis(newId, edits);
    return { id: newId };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Run the sidecar over a changeset's edits and store findings on the row.
 *  Best-effort: any failure (no sidecar, timeout, bad response) is swallowed. */
async function attachAnalysis(changesetId: number, edits: ProposedEdit[]): Promise<void> {
  try {
    const { analyzeEdits } = await import('./analysis.ts');
    const findings = await analyzeEdits(edits);
    if (findings) {
      await pool.query('update changesets set analysis = $2 where id = $1', [
        changesetId,
        JSON.stringify(findings),
      ]);
    }
  } catch {
    // Findings are best-effort by design.
  }
}

export async function listPending(): Promise<PendingChangeset[]> {
  const res = await pool.query(
    `select c.id, u.handle as author, c.created_at, c.summary, c.analysis,
            json_agg(json_build_object('nodeId', e.node_id, 'op', e.op, 'baseRev', e.base_rev, 'summary', e.summary) order by e.id) as edits
     from changesets c
     join users u on u.id = c.author_id
     join changeset_edits e on e.changeset_id = c.id
     where c.status = 'pending'
     group by c.id, u.handle
     order by c.id`,
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    author: r.author,
    createdAt: r.created_at.toISOString(),
    summary: r.summary,
    analysis: r.analysis,
    edits: r.edits,
  }));
}

export async function decideChangeset(
  id: number,
  reviewerId: number,
  decision: 'accepted' | 'rejected',
): Promise<{ ok: boolean; error?: string }> {
  const client = await pool.connect();
  const applied: AppliedEdit[] = [];
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

      // Phase 1 — resolve each edit's final data against the *current* graph,
      // locking edited rows and three-way-merging any that moved since the
      // proposal. Creates that now collide are caught here as a clean error.
      const resolved: { nodeId: string; op: 'edit' | 'create'; data: Snapshot; summary: string }[] =
        [];
      for (const e of edits.rows) {
        if (e.op === 'create') {
          const existing = await client.query('select 1 from nodes where id = $1', [e.node_id]);
          if (existing.rows.length) {
            await client.query('rollback');
            return {
              ok: false,
              error: `${e.node_id} was created by another change already — reject and re-propose`,
            };
          }
          resolved.push({ nodeId: e.node_id, op: 'create', data: e.data, summary: e.summary });
          continue;
        }
        const cur = await client.query('select current_rev from nodes where id = $1 for update', [
          e.node_id,
        ]);
        if (cur.rows.length === 0) {
          await client.query('rollback');
          return { ok: false, error: `${e.node_id} no longer exists` };
        }
        const curRev = Number(cur.rows[0].current_rev);
        let data: Snapshot = e.data;
        let summary: string = e.summary;
        if (curRev !== Number(e.base_rev)) {
          const revs = await client.query(
            'select rev, data from revisions where rev = any($1::bigint[])',
            [[e.base_rev, curRev]],
          );
          const baseData = revs.rows.find((r) => Number(r.rev) === Number(e.base_rev))?.data;
          const curData = revs.rows.find((r) => Number(r.rev) === curRev)?.data;
          if (!baseData || !curData) {
            await client.query('rollback');
            return { ok: false, error: `${e.node_id}: missing revisions for merge` };
          }
          const m = mergeSnapshots(baseData, e.data, curData);
          if (!m.merged) {
            await client.query('rollback');
            return {
              ok: false,
              error: `${e.node_id} conflicts with r${curRev}: ${m.conflicts!.join('; ')} — reject and re-propose`,
            };
          }
          data = m.merged;
          summary = `${e.summary}\n(merged over r${curRev})`;
        }
        resolved.push({ nodeId: e.node_id, op: 'edit', data, summary });
      }

      // Phase 2 — re-validate the resolved snapshots against the current graph.
      // Propose-time validation can be stale: two separately-valid changesets
      // may combine into a cycle, and a merge may produce a snapshot that was
      // never validated as a whole. This is the gate that keeps the live graph
      // a valid DAG no matter the acceptance order.
      const recheck = validateEdits(
        resolved.map((r) => ({
          op: r.op,
          nodeId: r.nodeId,
          baseRev: r.op === 'edit' ? (currentRev(r.nodeId) ?? 1) : undefined,
          data: r.data,
        })),
      );
      if (recheck.length) {
        await client.query('rollback');
        return { ok: false, error: `no longer applies: ${recheck.join('; ')} — reject and re-propose` };
      }

      // Phase 3 — write revisions, remembering each new rev so the in-memory
      // graph can be patched in place after commit.
      for (const r of resolved) {
        if (r.op === 'create') {
          await client.query(
            "insert into nodes (id, kind, pos) values ($1, $2, nextval('node_pos_seq'))",
            [r.nodeId, r.data.kind],
          );
        }
        const rev = await client.query(
          'insert into revisions (node_id, changeset_id, data, summary) values ($1, $2, $3, $4) returning rev',
          [r.nodeId, id, JSON.stringify(r.data), r.summary],
        );
        await client.query('update nodes set current_rev = $1 where id = $2', [
          rev.rows[0].rev,
          r.nodeId,
        ]);
        applied.push({
          nodeId: r.nodeId,
          op: r.op,
          rev: Number(rev.rows[0].rev),
          data: r.data,
        });
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

  // Patch the in-memory graph in place: an edit that touched two nodes costs
  // two map updates, not a 192k-row reload. (Full loadGraph remains only for
  // boot.)
  if (decision === 'accepted') {
    applyAcceptedEdits(applied);
    // Re-analyze what actually shipped: a three-way merge can differ from the
    // proposal the sidecar saw, so the stored findings must describe the
    // applied content. Detached, best-effort, same as at propose.
    void attachAnalysis(
      id,
      applied.map((a) => ({ op: a.op, nodeId: a.nodeId, data: a.data as Snapshot })),
    );
  }
  return { ok: true };
}

/** The one entry point for a user proposing a change. Encapsulates the trust
 *  ladder so every caller (HTTP API, import tools, future bulk edits) gets the
 *  same behavior: autoconfirmed authors publish immediately, everyone else
 *  lands in the review queue. */
export async function proposeChangeset(
  author: { userId: number; role: string },
  edits: ProposedEdit[],
  summary?: string,
): Promise<{ id?: number; errors?: string[]; applied: boolean; applyError?: string }> {
  const autoconfirmed = await isAutoconfirmed(author.userId, author.role);
  if (author.role !== 'admin' && author.role !== 'reviewer') {
    const limited = await rateLimitError(author.userId, autoconfirmed);
    if (limited) return { errors: [limited], applied: false };
  }
  const created = await createChangeset(author.userId, edits, summary);
  if (created.errors) return { errors: created.errors, applied: false };
  if (autoconfirmed) {
    const applied = await decideChangeset(created.id!, author.userId, 'accepted');
    return { id: created.id, applied: applied.ok, applyError: applied.error };
  }
  return { id: created.id, applied: false };
}

/** Rollback: revert every node whose CURRENT revision was authored by the
 *  given user, restoring each to its newest revision by someone else. The
 *  vandal-cleanup tool — one action undoes a spree. Returns per-node results;
 *  nodes whose only revision is the target author's are reported, not
 *  deleted (deletion is not yet a supported operation). */
export async function massRevert(
  targetUserId: number,
  reviewerId: number,
): Promise<{ reverted: string[]; skipped: string[] }> {
  const rows = await pool.query(
    `select n.id as node_id,
            (select r2.rev from revisions r2
              join changesets c2 on c2.id = r2.changeset_id
              where r2.node_id = n.id and c2.author_id <> $1
              order by r2.rev desc limit 1) as restore_rev
     from nodes n
     join revisions r on r.rev = n.current_rev
     join changesets c on c.id = r.changeset_id
     where c.author_id = $1 and not n.deleted`,
    [targetUserId],
  );
  const reverted: string[] = [];
  const skipped: string[] = [];
  for (const row of rows.rows) {
    if (!row.restore_rev) {
      skipped.push(row.node_id);
      continue;
    }
    const result = await revertNode(row.node_id, Number(row.restore_rev), reviewerId);
    (result.ok ? reverted : skipped).push(row.node_id);
  }
  return { reverted, skipped };
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
