-- VSM initial schema

create table if not exists courses (
  id                    serial primary key,
  category              text not null default 'nothelfer',
  variant               text not null check (variant in ('classic','elearning')),
  location              text not null,
  course_no             text not null unique,
  price_chf             integer not null check (price_chf >= 0),
  max_seats             integer not null check (max_seats > 0),
  booked_seats          integer not null default 0,
  starts_at             timestamptz not null,
  registration_deadline timestamptz,
  sessions              jsonb not null,
  status                text not null default 'open'
                        check (status in ('open','closed','archived')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint courses_seats_bounds check (booked_seats >= 0 and booked_seats <= max_seats)
);

create index if not exists courses_status_loc_cat_starts_idx
  on courses (status, location, category, starts_at);
create index if not exists courses_starts_idx on courses (starts_at);

create table if not exists registrations (
  id                       serial primary key,
  course_id                integer not null references courses(id) on delete restrict,
  vname                    text not null,
  nname                    text not null,
  strasse                  text not null,
  hnr                      text not null,
  plz                      text not null,
  ort                      text not null,
  geburt                   date not null,
  email                    text not null,
  telefon                  text,
  consent_privacy          boolean not null,
  consent_terms            boolean not null,
  status                   text not null default 'confirmed'
                           check (status in ('confirmed','cancelled')),
  paid                     boolean not null default false,
  admin_notes              text,
  participant_mail_status  text not null default 'pending'
                           check (participant_mail_status in ('pending','sent','failed')),
  participant_mail_error   text,
  school_mail_status       text not null default 'pending'
                           check (school_mail_status in ('pending','sent','failed')),
  school_mail_error        text,
  submitted_ip_hash        text,
  user_agent               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  cancelled_at             timestamptz
);

create index if not exists registrations_course_status_idx
  on registrations (course_id, status);

-- DB-enforced duplicate guard
create unique index if not exists registrations_unique_confirmed_email_course
  on registrations (course_id, lower(email))
  where status = 'confirmed';

create table if not exists admins (
  id                  serial primary key,
  email               text not null unique,
  password_hash       text not null,
  totp_secret         text,
  totp_enrolled_at    timestamptz,
  recovery_codes_hash text[] not null default '{}',
  must_change_password boolean not null default true,
  role                text not null default 'admin',
  last_login_at       timestamptz,
  disabled_at         timestamptz,
  created_at          timestamptz not null default now()
);

create table if not exists login_attempts (
  id         bigserial primary key,
  email      text,
  ip_hash    text,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_time_idx
  on login_attempts (email, created_at desc);
create index if not exists login_attempts_ip_time_idx
  on login_attempts (ip_hash, created_at desc);

-- Session store table for connect-pg-simple compatible layout
create table if not exists "session" (
  "sid"    varchar not null collate "default",
  "sess"   json not null,
  "expire" timestamp(6) not null,
  constraint "session_pkey" primary key ("sid") not deferrable initially immediate
);
create index if not exists "IDX_session_expire" on "session" ("expire");
