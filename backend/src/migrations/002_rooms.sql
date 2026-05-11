-- Rooms (locations where courses take place)

create table if not exists rooms (
  id            serial primary key,
  name          text not null,
  address_line1 text not null,
  address_line2 text,
  postal_code   text not null,
  city          text not null,
  capacity      integer check (capacity is null or capacity > 0),
  notes         text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rooms_city_idx on rooms (city);
create index if not exists rooms_archived_idx on rooms (archived_at) where archived_at is null;

-- Course → Room link. Null = no room assigned (e.g. legacy data).
-- ON DELETE SET NULL: deleting a room doesn't cascade to courses.
alter table courses
  add column if not exists room_id integer references rooms(id) on delete set null;

create index if not exists courses_room_idx on courses (room_id);
