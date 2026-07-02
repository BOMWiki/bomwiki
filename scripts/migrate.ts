// Applies engine/schema/*.sql in order, tracking applied files in a
// schema_migrations table. Idempotent; safe to run on every deploy.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', 'schema');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgres:///bomwiki_dev',
});

await client.connect();
await client.query(
  'create table if not exists schema_migrations (file text primary key, applied_at timestamptz not null default now())',
);

const applied = new Set(
  (await client.query('select file from schema_migrations')).rows.map((r) => r.file),
);

for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(schemaDir, file), 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migrations (file) values ($1)', [file]);
    await client.query('commit');
    console.log(`applied ${file}`);
  } catch (err) {
    await client.query('rollback');
    console.error(`failed ${file}`);
    throw err;
  }
}

await client.end();
