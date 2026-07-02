-- Anti-spam hardening: account blocking and comment rate limiting.

alter table users add column blocked boolean not null default false;

create index comments_by_author_time on comments (author_id, created_at);
