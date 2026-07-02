// Loads the exported graph into Postgres as revision 1 of every node,
// inside one 'accepted' changeset authored by the system 'import' user.
// Idempotent: refuses to run if any nodes already exist.
import { readFileSync } from 'node:fs';
import pg from 'pg';

interface BomLine {
  id: string;
  qty: number;
  note?: string;
}
interface ExportedNode {
  id: string;
  name: string;
  kind: 'product' | 'assembly' | 'part';
  domain?: string;
  summary?: string;
  standard?: string;
  material?: string;
  bom?: BomLine[];
}

const path = process.argv[2] ?? '/tmp/bomwiki-graph-export.json';
const nodes: ExportedNode[] = JSON.parse(readFileSync(path, 'utf8'));

const dangling: string[] = [];
const ids = new Set(nodes.map((n) => n.id));
for (const n of nodes) {
  for (const line of n.bom ?? []) {
    if (!ids.has(line.id)) dangling.push(`${n.id} -> ${line.id}`);
  }
}
if (dangling.length) {
  console.error(`refusing to import: ${dangling.length} dangling BOM references`);
  for (const d of dangling.slice(0, 20)) console.error(`  ${d}`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev',
});
await client.connect();

const existing = await client.query('select count(*)::int as c from nodes');
if (existing.rows[0].c > 0) {
  console.error(`refusing to import: nodes table already has ${existing.rows[0].c} rows`);
  process.exit(1);
}

await client.query('begin');

const importer = await client.query("select id from users where handle = 'import'");
const authorId = importer.rows[0].id;
const changeset = await client.query(
  "insert into changesets (author_id, summary, status, decided_at) values ($1, $2, 'accepted', now()) returning id",
  [authorId, `Initial import of ${nodes.length} nodes from the static site`],
);
const changesetId = changeset.rows[0].id;

const BATCH = 5000;
for (let i = 0; i < nodes.length; i += BATCH) {
  const batch = nodes.slice(i, i + BATCH);
  await client.query(
    "insert into nodes (id, kind, pos) select id, kind, nextval('node_pos_seq') from unnest($1::text[], $2::text[]) as t (id, kind)",
    [batch.map((n) => n.id), batch.map((n) => n.kind)],
  );
  await client.query(
    `insert into revisions (node_id, changeset_id, data, summary)
     select node_id, $2, data, 'Imported from the static site'
     from unnest($1::text[], $3::jsonb[]) as t (node_id, data)`,
    [
      batch.map((n) => n.id),
      changesetId,
      batch.map(({ id, ...data }) => JSON.stringify(data)),
    ],
  );
}
await client.query(
  'update nodes n set current_rev = r.rev from revisions r where r.node_id = n.id',
);

await client.query('commit');
const count = await client.query('select count(*)::int as c from revisions');
console.log(`imported ${count.rows[0].c} revisions in changeset ${changesetId}`);
await client.end();
