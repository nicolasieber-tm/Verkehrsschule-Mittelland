-- Password reset tokens (single-use, time-limited)
alter table admins add column if not exists reset_token_hash text;
alter table admins add column if not exists reset_token_expires_at timestamptz;

create index if not exists admins_reset_token_hash_idx on admins (reset_token_hash)
  where reset_token_hash is not null;
