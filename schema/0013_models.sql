-- 3D model layer: user-contributed CAD files attached to item pages.
--
-- Files live on disk under MODELS_DIR (content-addressed by sha256, immutable);
-- these tables hold the metadata and the moderation state. A file becomes
-- publicly served only when an accepted submission references its sha — the
-- quarantine for pending uploads is this DB gate at the serving route, not a
-- directory move.
--
-- model_files: one row per distinct uploaded file (dedup by content hash).
-- model_submissions: the moderation unit, mirroring changesets' trust model
--   (autoconfirmed submitters are accepted immediately with themselves as
--   reviewer). `kind` is derived server-side from the sniffed format:
--   STL renders in the browser ('display'), STEP/FreeCAD/OpenSCAD are
--   downloadable source files ('source').
-- node_models: which accepted display submission an item page shows.
create table model_files (
  sha256      text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
  ext         text not null check (ext in ('stl','step','stp','fcstd','scad')),
  format      text not null check (format in ('stl-binary','stl-ascii','step','freecad','openscad')),
  bytes       bigint not null,
  triangles   integer,
  uploader_id bigint not null references users(id),
  created_at  timestamptz not null default now()
);

create table model_submissions (
  id          bigserial primary key,
  node_id     text not null references nodes(id),
  sha256      text not null references model_files(sha256),
  kind        text not null check (kind in ('display','source')),
  license     text not null check (license in ('CC0','CC-BY','CC-BY-SA')),
  attribution text not null,
  note        text,
  status      text not null default 'pending' check (status in ('pending','accepted','rejected')),
  uploader_id bigint not null references users(id),
  reviewer_id bigint references users(id),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index model_subs_pending on model_submissions (status) where status = 'pending';
create index model_subs_by_node on model_submissions (node_id, status);
create index model_subs_by_uploader on model_submissions (uploader_id, created_at desc);
create index model_subs_by_sha on model_submissions (sha256, status);

create table node_models (
  node_id       text primary key references nodes(id),
  submission_id bigint not null references model_submissions(id),
  updated_at    timestamptz not null default now()
);
