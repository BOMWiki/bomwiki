-- Who decides the homepage, and who is the machine?
--
-- site_settings holds curated editorial content (featured pool, did-you-know
-- facts) with attribution — reviewers edit it, and the row says who last did.
-- The steward bot is a first-class account: every automated action (catalog
-- triage, machine verification marks) is attributed to it, so machine work
-- has a face, a history, and can be reviewed or reverted like anyone's.

create table site_settings (
  key text primary key,
  value jsonb not null,
  updated_by bigint not null references users(id),
  updated_at timestamptz not null default now()
);

insert into users (email, handle, role, display_name, bio)
values (
  null,
  'steward-bot',
  'reviewer',
  'Steward (bot)',
  'The site''s automation account. Runs the catalog triage (machine-checked marks come from it), attaches analysis findings to changesets, and performs scheduled maintenance. Operated by the site admins; misbehavior can be reverted and the account blocked like any other.'
);
