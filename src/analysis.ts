// The machine patroller: projects the product subtree affected by a
// changeset into a bomwiki-intelligence snapshot, asks the sidecar to
// review it, and turns the response into reviewer-readable findings.
// Everything degrades gracefully: no sidecar, no findings, never a block.
import type { ProposedEdit } from './changesets.ts';
import { getNode, primaryPath, type BomLine } from './nodes.ts';

const INTEL_URL = process.env.INTEL_URL ?? 'http://127.0.0.1:8799';
const TIMEOUT_MS = Number(process.env.INTEL_TIMEOUT_MS ?? 4000);
const MAX_SUBTREE = 20000;

export interface Finding {
  severity: 'info' | 'note';
  text: string;
}

interface SnapshotItem {
  id: string;
  name: string;
  description: string;
  item_type: string;
}

/** Collect the subtree of `rootId` with proposed edits overlaid. */
export function projectSubtree(
  rootId: string,
  overlay: Map<string, ProposedEdit>,
): { items: SnapshotItem[]; bom_lines: { parent_id: string; child_id: string; quantity: number }[] } {
  const items: SnapshotItem[] = [];
  const bomLines: { parent_id: string; child_id: string; quantity: number }[] = [];
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length && seen.size < MAX_SUBTREE) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const edit = overlay.get(id);
    const live = getNode(id);
    const data = edit?.data ?? live;
    if (!data) continue;
    items.push({
      id,
      name: data.name,
      description: data.summary ?? '',
      item_type: data.kind,
    });
    const bom: BomLine[] = data.bom ?? [];
    for (const line of bom) {
      bomLines.push({ parent_id: id, child_id: line.id, quantity: line.qty });
      queue.push(line.id);
    }
  }
  return { items, bom_lines: bomLines };
}

/** Reviewer-facing lines from the sidecar's bom_review. With today's data
 *  (no specs, ports, costs, or suppliers) the engaged layers are the
 *  function taxonomy and structure; more fields unlock more checks. */
function toFindings(review: any, editedIds: Set<string>, rootName: string): Finding[] {
  const findings: Finding[] = [];

  for (const c of review?.complexity_candidates ?? []) {
    if (editedIds.has(c.item_id)) {
      findings.push({
        severity: 'note',
        text: `${c.name}: ${c.child_count} direct children (dominant function: ${c.dominant_function ?? 'unknown'}) — worth checking for integration or standardization`,
      });
    }
  }

  const profile = review?.function_profile?.functions ?? review?.requirement_traceability?.function_profile ?? [];
  const unknown = profile.find((f: any) => f.function_id === 'unknown' || f.function === 'Unknown');
  if (unknown?.item_count) {
    findings.push({
      severity: 'note',
      text: `${unknown.item_count} item(s) in ${rootName} map to no known function — possible orphan or misnamed parts`,
    });
  }

  const funcs = profile
    .filter((f: any) => f.function_id !== 'unknown')
    .slice(0, 3)
    .map((f: any) => f.function)
    .join(', ');
  if (funcs) {
    findings.push({ severity: 'info', text: `${rootName} functions after this change: ${funcs}` });
  }
  return findings;
}

/** Analyze a changeset's edits. Returns null when the sidecar is
 *  unreachable — the review queue simply shows no machine findings. */
export async function analyzeEdits(edits: ProposedEdit[]): Promise<Finding[] | null> {
  const overlay = new Map(edits.map((e) => [e.nodeId, e]));
  const roots = new Map<string, string>();
  for (const e of edits) {
    const trail = primaryPath(e.nodeId);
    const root = trail[0] ?? getNode(e.nodeId);
    if (root) roots.set(root.id, root.name);
    else if (e.op === 'create') roots.set(e.nodeId, e.data.name);
  }
  const editedIds = new Set(edits.map((e) => e.nodeId));

  const findings: Finding[] = [];
  try {
    for (const [rootId, rootName] of [...roots.entries()].slice(0, 3)) {
      const snapshot = projectSubtree(rootId, overlay);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(`${INTEL_URL}/api/analyze?product=${encodeURIComponent(rootId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: snapshot.items,
          products: [{ id: rootId, name: rootName, root_item_id: rootId }],
          bom_lines: snapshot.bom_lines,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = await res.json();
      findings.push(...toFindings(body.bom_review ?? body, editedIds, rootName));
    }
  } catch {
    return null;
  }
  return findings;
}
