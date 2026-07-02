-- Milestone 4: machine findings from the bomwiki-intelligence sidecar,
-- attached to changesets and shown in the review queue.
alter table changesets add column analysis jsonb;
