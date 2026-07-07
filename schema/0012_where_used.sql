-- Materialized transitive "where-used" index: for each non-product item, the
-- products whose build tree transitively contains it. Recomputed on every FFS
-- export (scripts/export-ffs.ts) by a single in-process graph walk, replacing
-- the per-request ffsd traversal that scanned the whole catalog (~6.7s cold)
-- for every /item/ page. Lookup here is a single indexed primary-key read.
--
-- `count` is the total number of containing products; `top` is a JSON array of
-- up to 8 {id,name} rows (name-sorted) for display. The full list is not stored
-- because the item page only ever shows the count plus the first few.
create table if not exists where_used (
  item_id text primary key,
  count   integer not null,
  top     jsonb   not null default '[]'::jsonb,
  built_at timestamptz not null default now()
);
