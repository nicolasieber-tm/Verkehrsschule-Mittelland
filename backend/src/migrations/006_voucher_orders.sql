-- Voucher orders (Gutschein-Bestellungen)
-- Eigener Lifecycle: new -> contacted -> shipped -> closed, plus cancelled.
-- Kein course_id, kein File-Upload.

create table if not exists voucher_orders (
  id                       serial primary key,
  betrag_chf               integer not null check (betrag_chf > 0 and betrag_chf <= 100000),
  fuer                     text not null,
  von                      text not null,
  -- Lieferadresse (optional — falls leer wird an Rechnungsadresse versendet)
  lvname                   text,
  lnname                   text,
  lstrasse                 text,
  lhnr                     text,
  lplz                     text,
  lort                     text,
  -- Rechnungsadresse (Pflicht)
  rvname                   text not null,
  rnname                   text not null,
  rstrasse                 text not null,
  rhnr                     text not null,
  rplz                     text not null,
  rort                     text not null,
  email                    text not null,
  telefon                  text,
  consent_privacy          boolean not null,
  consent_terms            boolean not null,
  status                   text not null default 'new'
                           check (status in ('new','contacted','shipped','closed','cancelled')),
  paid                     boolean not null default false,
  shipped_at               timestamptz,
  admin_notes              text,
  customer_mail_status     text not null default 'pending'
                           check (customer_mail_status in ('pending','sent','failed')),
  customer_mail_error      text,
  school_mail_status       text not null default 'pending'
                           check (school_mail_status in ('pending','sent','failed')),
  school_mail_error        text,
  submitted_ip_hash        text,
  user_agent               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists voucher_orders_status_created_idx
  on voucher_orders (status, created_at desc);
