-- Hot lookups by author: rate-limit and autoconfirm checks run on every
-- propose, and profile/contribution views filter changesets by author.
-- Without this they seq-scan the whole changesets table.
create index changesets_by_author on changesets (author_id);

-- Recent-changes and review-queue both filter by status.
create index changesets_by_status on changesets (status);
