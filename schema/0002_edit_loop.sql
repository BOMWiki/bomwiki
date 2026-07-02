-- Milestone 2: the edit loop. A pending changeset holds proposed node
-- snapshots in changeset_edits; nothing touches nodes/revisions until a
-- reviewer accepts, at which point each edit becomes a real revision.
-- base_rev records what the editor saw, for optimistic concurrency.

create table changeset_edits (
  id bigserial primary key,
  changeset_id bigint not null references changesets(id),
  node_id text not null,
  op text not null default 'edit' check (op in ('edit', 'create')),
  -- Revision the edit was based on; null when op = 'create'.
  base_rev bigint references revisions(rev),
  -- Proposed complete snapshot (same shape as revisions.data).
  data jsonb not null,
  -- Human-readable lines describing the change, computed server-side.
  summary text not null
);

create index changeset_edits_by_changeset on changeset_edits (changeset_id);
create index changeset_edits_by_node on changeset_edits (node_id);

create table sessions (
  token text primary key,
  user_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
