-- Profiles grow a public website link; accounts grow an email layer:
-- a welcome note, notifications (changeset decisions, talk replies), and a
-- weekly digest. Every non-signin email carries a one-click unsubscribe
-- token, so the token lives on the user, not the message.

alter table users add column website text;

-- One long random token per user authorizes unsubscribe links without a
-- session (email clients follow them signed out). Null until first needed.
alter table users add column email_token text unique;

alter table users add column welcomed_at timestamptz;
alter table users add column digest text not null default 'weekly'
  check (digest in ('off', 'weekly'));
alter table users add column notify_decisions boolean not null default true;
alter table users add column notify_replies boolean not null default true;
alter table users add column digest_sent_at timestamptz;

-- Everything sent, for auditing and the per-user daily cap that keeps a
-- reply storm from becoming an email storm.
create table email_log (
  id bigserial primary key,
  user_id bigint not null references users(id),
  kind text not null check (kind in ('welcome', 'decision', 'reply', 'digest')),
  created_at timestamptz not null default now()
);

create index email_log_by_user on email_log (user_id, created_at desc);
