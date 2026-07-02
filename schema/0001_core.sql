-- BOMwiki engine core schema.
--
-- The wiki unit is the node: one product, assembly, or part. Every edit
-- produces a new revision holding the node's complete JSON snapshot, so
-- history, diff, revert, and "page as of a date" are single-row reads.
-- Edits are grouped into changesets, which is what reviewers accept or
-- reject and what a rollback undoes atomically.

create table users (
  id bigserial primary key,
  email text unique,
  handle text not null unique,
  role text not null default 'contributor'
    check (role in ('system', 'contributor', 'reviewer', 'admin')),
  created_at timestamptz not null default now()
);

create table changesets (
  id bigserial primary key,
  author_id bigint not null references users(id),
  summary text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  reviewer_id bigint references users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table nodes (
  id text primary key,
  kind text not null check (kind in ('product', 'assembly', 'part')),
  current_rev bigint,
  -- Stable catalog order (import order for seeded nodes, then append-only).
  -- Parent lists, breadcrumbs, and "used in" render in this order, matching
  -- the authored order of the original static site.
  pos bigint not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create sequence node_pos_seq owned by nodes.pos;

create table revisions (
  rev bigserial primary key,
  node_id text not null references nodes(id),
  changeset_id bigint not null references changesets(id),
  -- Complete node snapshot: { name, kind, domain?, summary?, standard?,
  -- material?, bom?: [{ id, qty, note? }] }
  data jsonb not null,
  -- Human-readable line for history and review ("Leg bolt quantity 4 -> 6").
  summary text,
  created_at timestamptz not null default now()
);

create index revisions_by_node on revisions (node_id, rev desc);
create index revisions_by_changeset on revisions (changeset_id);

alter table nodes
  add constraint nodes_current_rev_fk
  foreign key (current_rev) references revisions (rev);

-- Merged duplicates keep resolving at their old id.
create table redirects (
  from_id text primary key,
  to_id text not null references nodes(id),
  created_at timestamptz not null default now()
);

insert into users (email, handle, role) values (null, 'import', 'system');
