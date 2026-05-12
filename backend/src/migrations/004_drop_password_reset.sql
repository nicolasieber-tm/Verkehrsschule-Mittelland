-- Cleanup: remove password-reset columns (feature was reverted)
drop index if exists admins_reset_token_hash_idx;
alter table admins drop column if exists reset_token_hash;
alter table admins drop column if exists reset_token_expires_at;

-- Remove stale migration entry pointing to a deleted file
delete from _migrations where name = '003_password_reset.sql';
