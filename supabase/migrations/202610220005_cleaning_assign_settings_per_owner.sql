-- 청소 배정 설정 — 배정 담당 사람마다 따로(2026-10-22). docs/product/37-cleaning-shift-assignment.md 「설정은 사람마다」
--
-- 배정 설정 화면의 모든 값(제안 규칙 · 비교표 기준 · 건물별 고정 인력 · 사람별 · 큰 방)은 회사 공용이 아니라
-- 설정한 배정 담당(owner_id)의 것이다. 담당마다 기준이 달라서 — A 가 바꿔도 B 의 제안 · 표시는 그대로.
-- 메인 건물은 원래 본인 줄(user_id = 본인)에 있었으므로 owner_id = user_id = 본인 줄로 그대로 남는다.
-- 기존 줄은 마지막에 바꾼 사람(updated_by)의 것으로 옮긴다. 주인을 알 수 없는 줄은 지운다(운영 데이터 0~3줄).

-- ① 제안 규칙 · 비교표 기준 — 조직 하나에 한 벌 → 담당 한 사람에 한 벌
alter table public.cleaning_assign_settings add column if not exists owner_id uuid references auth.users(id) on delete cascade;
update public.cleaning_assign_settings set owner_id = updated_by where owner_id is null;
delete from public.cleaning_assign_settings where owner_id is null;
alter table public.cleaning_assign_settings alter column owner_id set not null;
alter table public.cleaning_assign_settings drop constraint if exists cleaning_assign_settings_pkey;
alter table public.cleaning_assign_settings add primary key (organization_id, owner_id);

-- ② 건물별 고정 인력(updated_by 가 없어 주인을 알 수 없다 — 운영 0줄)
alter table public.cleaning_fixed_staff add column if not exists owner_id uuid references auth.users(id) on delete cascade;
delete from public.cleaning_fixed_staff where owner_id is null;
alter table public.cleaning_fixed_staff alter column owner_id set not null;
alter table public.cleaning_fixed_staff drop constraint if exists cleaning_fixed_staff_pkey;
alter table public.cleaning_fixed_staff add primary key (organization_id, owner_id, property_name, user_id);

-- ③ 사람별(우선 · 견습 · 견습 담당 · 기본 출근 시각 · 메모) + 내 메인 건물(owner = user = 본인 줄)
alter table public.cleaning_staff_profiles add column if not exists owner_id uuid references auth.users(id) on delete cascade;
update public.cleaning_staff_profiles set owner_id = coalesce(updated_by, user_id) where owner_id is null;
alter table public.cleaning_staff_profiles alter column owner_id set not null;
alter table public.cleaning_staff_profiles drop constraint if exists cleaning_staff_profiles_pkey;
alter table public.cleaning_staff_profiles add primary key (organization_id, owner_id, user_id);

-- ④ 큰 방(객실 보통 인원)
alter table public.cleaning_room_settings add column if not exists owner_id uuid references auth.users(id) on delete cascade;
update public.cleaning_room_settings set owner_id = updated_by where owner_id is null;
delete from public.cleaning_room_settings where owner_id is null;
alter table public.cleaning_room_settings alter column owner_id set not null;
alter table public.cleaning_room_settings drop constraint if exists cleaning_room_settings_pkey;
alter table public.cleaning_room_settings add primary key (organization_id, owner_id, room_key);

comment on column public.cleaning_assign_settings.owner_id is '이 설정의 주인(배정 담당). 설정은 담당마다 따로다.';
comment on column public.cleaning_fixed_staff.owner_id is '이 고정 인력 순위를 정한 배정 담당.';
comment on column public.cleaning_staff_profiles.owner_id is '이 사람별 설정을 정한 배정 담당. 메인 건물은 owner_id = user_id(본인) 줄.';
comment on column public.cleaning_room_settings.owner_id is '이 큰 방 인원을 정한 배정 담당.';
