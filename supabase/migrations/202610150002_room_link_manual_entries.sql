-- 룸 링크 — 건물 · 객실 직접 추가 (2026-10-15).
--
-- 문서: docs/product/35-room-links.md → 「건물 · 객실 직접 추가」
--       docs/engineering/04-data-model.md → room_link_buildings · room_link_rooms
--       docs/engineering/05-rls-permissions.md → 「2026-10-15 룸 링크 직접 추가」
--
-- Beds24 에 없는 건물 · 객실도 룸 링크 화면에서 링크를 붙여 두고 싶다(사용자 결정, 2026-10-15).
-- **룸 링크에만 생긴다** — 캘린더 · 청소 · 가동률 · 매출은 `properties` / `rooms` 를 읽으므로 거기에 넣지 않고
-- 새 표 두 개를 둔다. 그래서 다른 화면은 이 표를 모른다.
--
-- - `room_link_buildings` — 직접 추가한 건물. 이름은 조직 안에서 유일, Beds24 건물 이름과 겹치면 안 된다
--   (서버 액션이 `CALENDAR_BUILDING_ORDER` · 실제 객실 건물 이름과 대조).
-- - `room_link_rooms` — 직접 추가한 객실. Beds24 건물(`canonical_name`) **또는** 직접 추가한 건물
--   (`manual_building_id`) 중 정확히 하나에 붙는다. 이름은 그 건물 안에서 유일.
-- - 링크는 기존 표를 넓혀 쓴다 — 리스팅 ID 중복 경고 · 입력 검증 · 화면 모양을 그대로 공유한다.
--   · `room_listing_links.manual_room_id`(Airbnb): `room_id` 와 정확히 하나.
--   · `building_listing_links.manual_building_id`(Booking.com): `canonical_name` 과 정확히 하나. 이름이 아니라 id 로
--     붙여서 건물 이름을 바꿔도 링크가 따라간다.
--   둘 다 `on delete cascade` — 직접 추가한 건물을 지우면 그 객실 · 링크가 함께 지워진다(hard delete, 확인 창).
--
-- 권한: 기존 룸 링크 표와 같다 — 읽기 `room_links.access`(RLS), 쓰기는 서버 액션(service-role)이 권한 · 조직을
-- 다시 보고 한다. 플랫폼 관리자 FOR ALL.

-- ── 직접 추가한 건물 ──────────────────────────────────────────────────
create table if not exists public.room_link_buildings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_link_buildings_org_name_key unique (organization_id, name),
  constraint room_link_buildings_name_len check (char_length(btrim(name)) between 1 and 40)
);

comment on table public.room_link_buildings is
  '룸 링크에서 직접 추가한 건물(Beds24 에 없음). 룸 링크 화면만 읽는다. 쓰기는 서버 액션(service-role), 읽기는 room_links.access.';

-- ── 직접 추가한 객실 ──────────────────────────────────────────────────
create table if not exists public.room_link_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manual_building_id uuid references public.room_link_buildings(id) on delete cascade,
  canonical_name text,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_link_rooms_one_building check (num_nonnulls(manual_building_id, canonical_name) = 1),
  constraint room_link_rooms_name_len check (char_length(btrim(name)) between 1 and 40)
);

comment on table public.room_link_rooms is
  '룸 링크에서 직접 추가한 객실 — Beds24 건물(canonical_name) 또는 직접 추가한 건물(manual_building_id) 중 하나에 붙는다.';

create unique index if not exists room_link_rooms_manual_building_name_key
  on public.room_link_rooms (manual_building_id, name) where manual_building_id is not null;
create unique index if not exists room_link_rooms_canonical_name_key
  on public.room_link_rooms (organization_id, canonical_name, name) where canonical_name is not null;
create index if not exists room_link_rooms_org_idx on public.room_link_rooms (organization_id);

-- ── 링크 표 넓히기 ────────────────────────────────────────────────────
alter table public.room_listing_links
  add column if not exists manual_room_id uuid references public.room_link_rooms(id) on delete cascade;
alter table public.room_listing_links alter column room_id drop not null;
alter table public.room_listing_links drop constraint if exists room_listing_links_one_room;
alter table public.room_listing_links
  add constraint room_listing_links_one_room check (num_nonnulls(room_id, manual_room_id) = 1);
alter table public.room_listing_links drop constraint if exists room_listing_links_manual_room_channel_key;
-- 부분 인덱스가 아니라 유일 제약 — upsert(on conflict (manual_room_id, channel))가 쓸 수 있게. null 은 서로 다르다.
alter table public.room_listing_links
  add constraint room_listing_links_manual_room_channel_key unique (manual_room_id, channel);

alter table public.building_listing_links
  add column if not exists manual_building_id uuid references public.room_link_buildings(id) on delete cascade;
alter table public.building_listing_links alter column canonical_name drop not null;
alter table public.building_listing_links drop constraint if exists building_listing_links_one_building;
alter table public.building_listing_links
  add constraint building_listing_links_one_building check (num_nonnulls(canonical_name, manual_building_id) = 1);
alter table public.building_listing_links drop constraint if exists building_listing_links_manual_building_channel_key;
alter table public.building_listing_links
  add constraint building_listing_links_manual_building_channel_key unique (manual_building_id, channel);

-- ── RLS — 기존 룸 링크 표와 같은 모양 ─────────────────────────────────
alter table public.room_link_buildings enable row level security;
alter table public.room_link_rooms enable row level security;

drop policy if exists "room links readers can read manual buildings" on public.room_link_buildings;
create policy "room links readers can read manual buildings"
  on public.room_link_buildings
  for select
  to authenticated
  using (organization_id = any ((select public.capability_organization_ids('room_links.access'))::uuid[]));

drop policy if exists "platform admins can manage manual buildings" on public.room_link_buildings;
create policy "platform admins can manage manual buildings"
  on public.room_link_buildings
  for all
  to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

drop policy if exists "room links readers can read manual rooms" on public.room_link_rooms;
create policy "room links readers can read manual rooms"
  on public.room_link_rooms
  for select
  to authenticated
  using (organization_id = any ((select public.capability_organization_ids('room_links.access'))::uuid[]));

drop policy if exists "platform admins can manage manual rooms" on public.room_link_rooms;
create policy "platform admins can manage manual rooms"
  on public.room_link_rooms
  for all
  to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

revoke all on public.room_link_buildings from anon;
revoke all on public.room_link_rooms from anon;
grant select on public.room_link_buildings to authenticated;
grant select on public.room_link_rooms to authenticated;
grant all on public.room_link_buildings to service_role;
grant all on public.room_link_rooms to service_role;
