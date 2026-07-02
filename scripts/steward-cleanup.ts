// The steward's content pass: one sweep over every node, applying the fixes
// a machine can defend and flagging everything it can't.
//
// FIXES (applied as steward-bot changesets through the normal write path —
// validated, attributed, revertable, visible in recent changes):
//   - duplicate BOM lines (same child twice): merged, quantities summed
//   - self-referencing BOM lines: removed
//   - invalid quantities (non-integer or < 1): rounded / floored to 1
//   - whitespace damage in text fields and notes: trimmed, doubles collapsed
//   - duplicate spec labels: first occurrence kept
//
// FLAGS (report only — these need human or better-data judgment):
//   - article wiki-links to nonexistent nodes (red links)
//   - orphan assemblies/parts (no parents; unreachable except by URL)
//   - boilerplate summaries repeated across 5+ nodes
//   - sidecar: products whose function profile includes unknown-function items
//   - graph-wide cycle and dangling-reference verification (should be zero)
//
// RUN WITH THE SERVER STOPPED: this writes through the module layer, and a
// running server's in-memory graph would go stale.
import { writeFileSync } from 'node:fs';
import { proposeChangeset, type ProposedEdit, type Snapshot } from '../src/changesets.ts';
import { pool } from '../src/db.ts';
import { allNodes, currentRev, getNode, loadGraph, parents } from '../src/nodes.ts';

const OUT = process.argv[2] ?? 'reports/steward-cleanup.md';
const APPLY = process.argv.includes('--apply');
const BATCH = 40;

await loadGraph(process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev');
const botRow = await pool.query("select id from users where handle = 'steward-bot'");
if (!botRow.rows.length) {
  console.error('steward-bot missing; run migrations');
  process.exit(1);
}
const bot = { userId: Number(botRow.rows[0].id), role: 'reviewer' };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Fix {
  nodeId: string;
  kinds: string[];
  data: Snapshot;
}

const fixes: Fix[] = [];
const flags = {
  redLinks: [] as string[],
  orphans: [] as string[],
  boilerplate: new Map<string, number>(),
  dangling: [] as string[],
  cycles: [] as string[],
};

// --- pass 1: per-node scan ---
const summaryCount = new Map<string, number>();
for (const node of allNodes()) {
  if (node.summary) {
    const key = clean(node.summary).toLowerCase().replace(/\d+/g, '#');
    summaryCount.set(key, (summaryCount.get(key) ?? 0) + 1);
  }
}

for (const node of allNodes()) {
  const kinds: string[] = [];
  const next: Snapshot = JSON.parse(JSON.stringify((({ id, ...d }) => d)(node)));

  for (const field of ['name', 'summary', 'material', 'standard'] as const) {
    const v = next[field];
    if (typeof v === 'string') {
      const c = clean(v);
      if (c !== v) {
        if (c) next[field] = c;
        else delete next[field];
        kinds.push(`whitespace:${field}`);
      }
    }
  }

  if (next.bom?.length) {
    const seen = new Map<string, { id: string; qty: number; note?: string }>();
    let changed = false;
    for (const line of next.bom) {
      if (line.id === node.id) {
        kinds.push('self-reference');
        changed = true;
        continue;
      }
      if (!getNode(line.id)) {
        flags.dangling.push(`${node.id} -> ${line.id}`);
        continue;
      }
      let qty = line.qty;
      if (typeof qty !== 'number' || !Number.isFinite(qty)) qty = 1;
      if (!Number.isInteger(qty) || qty < 1) {
        qty = Math.max(1, Math.round(qty));
        kinds.push('quantity');
        changed = true;
      }
      const note = line.note !== undefined ? clean(line.note) : undefined;
      if (note !== line.note) {
        kinds.push('whitespace:note');
        changed = true;
      }
      const existing = seen.get(line.id);
      if (existing) {
        existing.qty += qty;
        kinds.push('duplicate-line');
        changed = true;
      } else {
        seen.set(line.id, { id: line.id, qty, ...(note ? { note } : {}) });
      }
    }
    if (changed) next.bom = [...seen.values()];
  }

  if (next.specs?.length) {
    const seenSpec = new Set<string>();
    const specs = next.specs.filter(([k]) => {
      if (seenSpec.has(k)) return false;
      seenSpec.add(k);
      return true;
    });
    if (specs.length !== next.specs.length) {
      kinds.push('duplicate-spec');
      next.specs = specs;
    }
  }

  if (kinds.length) {
    fixes.push({ nodeId: node.id, kinds: [...new Set(kinds)], data: next });
  }

  // Flags
  if (node.kind !== 'product' && parents(node.id).length === 0) flags.orphans.push(node.id);
  if (node.article) {
    for (const m of node.article.matchAll(/\[\[([A-Za-z0-9._-]+)(?:\|[^\]]+)?\]\]/g)) {
      if (!getNode(m[1])) flags.redLinks.push(`${node.id} -> [[${m[1]}]]`);
    }
  }
}

for (const [key, count] of summaryCount) {
  if (count >= 5) flags.boilerplate.set(key, count);
}

// --- pass 2: whole-graph cycle check (DFS with colors) ---
{
  const color = new Map<string, 1 | 2>(); // 1=in-stack, 2=done
  const stack: { id: string; idx: number }[] = [];
  for (const root of allNodes()) {
    if (color.get(root.id)) continue;
    stack.push({ id: root.id, idx: 0 });
    color.set(root.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const bom = getNode(top.id)?.bom ?? [];
      if (top.idx >= bom.length) {
        color.set(top.id, 2);
        stack.pop();
        continue;
      }
      const child = bom[top.idx++].id;
      const c = color.get(child);
      if (c === 1) flags.cycles.push(`${top.id} -> ${child}`);
      else if (!c && getNode(child)) {
        color.set(child, 1);
        stack.push({ id: child, idx: 0 });
      }
    }
  }
}

// --- summarize scan ---
const byKind = new Map<string, number>();
for (const f of fixes) for (const k of f.kinds) byKind.set(k, (byKind.get(k) ?? 0) + 1);
console.log(`fixable nodes: ${fixes.length}`);
for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
console.log(
  `flags: ${flags.redLinks.length} red links, ${flags.orphans.length} orphans, ${flags.boilerplate.size} boilerplate summaries, ${flags.dangling.length} dangling, ${flags.cycles.length} cycle edges`,
);

// --- apply fixes as steward changesets ---
let applied = 0;
let failed = 0;
if (APPLY && fixes.length) {
  for (let i = 0; i < fixes.length; i += BATCH) {
    const batch = fixes.slice(i, i + BATCH);
    const edits: ProposedEdit[] = batch.map((f) => ({
      op: 'edit',
      nodeId: f.nodeId,
      baseRev: currentRev(f.nodeId)!,
      data: f.data,
    }));
    const kindsInBatch = [...new Set(batch.flatMap((f) => f.kinds))].join(', ');
    const result = await proposeChangeset(
      bot,
      edits,
      `Steward cleanup: ${kindsInBatch} (${batch.length} pages)`,
    );
    if (result.applied) applied += batch.length;
    else {
      failed += batch.length;
      console.error(`batch at ${i} failed: ${result.errors?.join('; ') ?? result.applyError}`);
    }
    if ((i / BATCH) % 25 === 0) console.log(`applied ${applied}/${fixes.length}`);
  }
  console.log(`applied ${applied}, failed ${failed}`);
}

// --- report ---
const lines = [
  '# Steward content pass',
  '',
  `Scanned every node. Fixable defects on ${fixes.length} nodes${APPLY ? `; ${applied} fixed via steward-bot changesets${failed ? `, ${failed} failed` : ''}` : ' (dry run — pass --apply)'}.`,
  '',
  '## Fixed (or fixable) counts by defect',
  '',
  ...[...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`),
  '',
  '## Flags needing human judgment',
  '',
  `- Red links (article references to nonexistent nodes): ${flags.redLinks.length}`,
  ...flags.redLinks.slice(0, 30).map((s) => `  - ${s}`),
  `- Orphan assemblies/parts (no parents, unreachable by browsing): ${flags.orphans.length}`,
  ...flags.orphans.slice(0, 30).map((s) => `  - \`${s}\``),
  `- Boilerplate summaries (identical text on 5+ nodes): ${flags.boilerplate.size} distinct strings`,
  ...[...flags.boilerplate.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([s, n]) => `  - (${n}×) ${s.slice(0, 110)}`),
  `- Dangling references: ${flags.dangling.length}`,
  ...flags.dangling.slice(0, 20).map((s) => `  - ${s}`),
  `- Cycle edges: ${flags.cycles.length}`,
  ...flags.cycles.slice(0, 20).map((s) => `  - ${s}`),
  '',
];
writeFileSync(OUT, lines.join('\n'));
console.log(`report -> ${OUT}`);
await pool.end();
