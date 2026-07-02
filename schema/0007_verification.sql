-- The honesty layer: every node carries a verification status, and the whole
-- imported catalog starts life labeled as machine-generated and unverified.
-- Status is content-adjacent metadata, not part of the revision snapshot:
-- it describes confidence in the page, and changes via a reviewer action
-- with its own audit trail.

alter table nodes add column verification text not null default 'unverified'
  check (verification in ('unverified', 'machine-checked', 'human-verified'));

create table verification_events (
  id bigserial primary key,
  node_id text not null references nodes(id),
  status text not null,
  user_id bigint not null references users(id),
  -- Why: citation URLs, standard designations, "had one apart", etc.
  note text,
  created_at timestamptz not null default now()
);

create index verification_events_by_node on verification_events (node_id, id);
create index nodes_by_verification on nodes (verification);
