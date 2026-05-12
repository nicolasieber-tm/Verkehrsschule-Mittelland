-- Package requests: 10er Fahrstunden-Paket (optional + VKU) und Starter-Box
-- Eigene Lifecycle (Lead -> Kontakt -> Abschluss), kein course_id, optionaler Datei-Anhang.

create table if not exists package_requests (
  id                       serial primary key,
  type                     text not null
                           check (type in ('fahrstunden_10','starterbox')),
  with_vku                 boolean not null default false,
  vname                    text not null,
  nname                    text not null,
  strasse                  text not null,
  hnr                      text not null,
  plz                      text not null,
  ort                      text not null,
  geburt                   date not null,
  email                    text not null,
  telefon                  text,
  location_pref            text,
  notes                    text,
  consent_privacy          boolean not null,
  consent_terms            boolean not null,
  status                   text not null default 'new'
                           check (status in ('new','contacted','closed','cancelled')),
  paid                     boolean not null default false,
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

create index if not exists package_requests_status_created_idx
  on package_requests (status, created_at desc);
create index if not exists package_requests_type_created_idx
  on package_requests (type, created_at desc);

create table if not exists package_request_files (
  id           serial primary key,
  request_id   integer not null references package_requests(id) on delete cascade,
  kind         text not null check (kind in ('lernfahrausweis')),
  filename     text not null,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  data         bytea not null,
  created_at   timestamptz not null default now()
);

create index if not exists package_request_files_request_idx
  on package_request_files (request_id);
