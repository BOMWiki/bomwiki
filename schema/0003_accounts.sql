-- Milestone 3: accounts and community. Public profiles live on users;
-- magic links replace the admin token for regular sign-in; comments carry
-- per-node discussions; watches back the watchlist.

alter table users add column display_name text;
alter table users add column affiliation text;
alter table users add column bio text;

create table magic_links (
  token text primary key,
  user_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table comments (
  id bigserial primary key,
  node_id text not null references nodes(id),
  -- Root comments are topics; one level of replies underneath.
  parent_id bigint references comments(id),
  author_id bigint not null references users(id),
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index comments_by_node on comments (node_id, id);

create table watches (
  user_id bigint not null references users(id),
  node_id text not null references nodes(id),
  created_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

create index watches_by_node on watches (node_id);
