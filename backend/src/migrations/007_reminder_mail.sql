-- Reminder mail (24h vor Kursbeginn) — Status-Tracking analog participant_mail_status
alter table registrations
  add column if not exists reminder_mail_status text not null default 'pending'
    check (reminder_mail_status in ('pending','sent','failed','skipped')),
  add column if not exists reminder_mail_error  text,
  add column if not exists reminder_mail_sent_at timestamptz;

-- Index für den stündlichen Cron-Query (Kurse 23.5–24.5h vor Start, noch nicht erinnert)
create index if not exists registrations_reminder_pending_idx
  on registrations (reminder_mail_status)
  where reminder_mail_status = 'pending';
