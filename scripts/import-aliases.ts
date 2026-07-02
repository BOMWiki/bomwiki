// One-time: fold the static site's ALIASES into the live wiki as a
// steward-bot changeset (fresh imports get them in revision 1 via the
// exporter; this backfills a database imported before aliases existed).
// RUN WITH THE SERVER STOPPED.
import { proposeChangeset, snapshotOf, type ProposedEdit } from '../src/changesets.ts';
import { pool } from '../src/db.ts';
import { currentRev, getNode, loadGraph } from '../src/nodes.ts';
import { ALIASES } from '../../src/data/aliases.ts';

await loadGraph(process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev');
const botRow = await pool.query("select id from users where handle = 'steward-bot'");
const bot = { userId: Number(botRow.rows[0].id), role: 'reviewer' };

const edits: ProposedEdit[] = [];
for (const [id, aliases] of Object.entries(ALIASES)) {
  const node = getNode(id);
  if (!node || !aliases.length) continue;
  if ((node.aliases ?? []).join('|') === aliases.join('|')) continue;
  edits.push({
    op: 'edit',
    nodeId: id,
    baseRev: currentRev(id)!,
    data: { ...snapshotOf(node), aliases },
  });
}

if (!edits.length) {
  console.log('nothing to import');
} else {
  const result = await proposeChangeset(bot, edits, `Import ${edits.length} product alias lists from the static site`);
  console.log(result.applied ? `imported aliases for ${edits.length} products` : `failed: ${result.errors?.join('; ') ?? result.applyError}`);
}
await pool.end();
