-- 손님 메시지 3 · 4단계 — 건물 정보(손님용 칸) · 정해 둔 문구. docs/product/47-guest-messaging.md §6-3 · §10
--
-- 1) `property_operation_infos` 넓히기 — 손님에게 보내도 되는 칸을 **한 jsonb 칸**(`guest_info`)에 둔다.
--    모양: { wifiName, wifiPassword, checkIn:{ko,ja,en}, checkOut:{…}, luggage:{…}, parking:{…}, trash:{…}, directions:{…}, freeText:{…} }
--    (와이파이 이름 · 비밀번호는 언어마다 같은 값이라 한 칸). 앱이 모양을 다듬어 넣는다(`guest-info-model.ts`) — DB 는 「객체인가」만 본다.
--    직원용 칸(공용 · 객실 출입 코드 · 운영 메모)은 그대로 따로 있다. 손님용 칸만의 버전 `guest_info_updated_at` 을 둬서
--    출입 코드를 고친 저장과 손님용 칸 저장이 서로를 「충돌」로 막지 않게 한다(두 저장은 서로 다른 칸만 쓴다).
--    읽기 · 쓰기 정책은 기존 그대로(읽기 = 조직 멤버, 쓰기 = `property_info.edit`). 앱은 서버 액션(service_role)으로 쓴다.
-- 2) `guest_message_saved_replies` — 정해 둔 문구(조직마다). 읽기 = `guest_messages.view`, 쓰기 정책 없음(서버 액션이
--    `guest_messages.manage` 를 확인하고 service_role 로 쓴다).
--
-- 다시 돌려도 안전하게 `if not exists` · `drop policy if exists`. 202611120002(운영 적용됨)는 고치지 않는다.
-- 이 파일은 아직 운영에 적용되지 않았다(사용자 허락 뒤 대시보드 SQL 편집기로).

-- ── 1) 건물 정보 손님용 칸 ────────────────────────────────────────────────
alter table public.property_operation_infos
  add column if not exists guest_info jsonb not null default '{}'::jsonb,
  add column if not exists guest_info_updated_at timestamptz,
  -- 직원용 칸(주소 · 출입 코드 · 메모)을 사람이 저장한 적이 있나. 손님용 정보 저장이 줄을 **처음 만들면** false(기본 출입 코드만 들어 있음) —
  -- 그 뒤 「줄 없음」 화면에서 연 출입 코드 저장이 23505 로 막히지 않고 이 줄을 고친다(`staff_info_saved = false` 조건).
  -- 직원 칸이 한 번 바뀌면 트리거가 true 로 바꾼다. 기존 줄은 모두 사람이 저장한 줄이라 기본 true.
  add column if not exists staff_info_saved boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_operation_infos_guest_info_object'
      and conrelid = 'public.property_operation_infos'::regclass
  ) then
    alter table public.property_operation_infos
      add constraint property_operation_infos_guest_info_object
      check (jsonb_typeof(guest_info) = 'object' and pg_column_size(guest_info) <= 65536);
  end if;
end $$;

-- 버전 칸 두 개를 DB 가 고친다: 직원용 칸이 바뀔 때만 `updated_at`, 손님용 칸이 바뀔 때만 `guest_info_updated_at`.
-- (예전 트리거는 어떤 칸이 바뀌어도 `updated_at` 을 올려서, 손님용 칸 저장 뒤 열어 둔 출입 코드 편집이 「충돌」로 막혔다.)
create or replace function public.property_operation_infos_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := coalesce(new.updated_at, now());
    if new.guest_info is not null and new.guest_info <> '{}'::jsonb then
      new.guest_info_updated_at := now();
    else
      new.guest_info_updated_at := null;
    end if;
    return new;
  end if;
  if (new.canonical_name, new.address_ko, new.address_ja, new.address_en, new.shared_access, new.room_access, new.note)
     is distinct from
     (old.canonical_name, old.address_ko, old.address_ja, old.address_en, old.shared_access, old.room_access, old.note) then
    new.updated_at := now();
    new.staff_info_saved := true;
  else
    new.updated_at := old.updated_at;
  end if;
  if new.guest_info is distinct from old.guest_info then
    new.guest_info_updated_at := now();
  else
    new.guest_info_updated_at := old.guest_info_updated_at;
  end if;
  return new;
end;
$$;

revoke all on function public.property_operation_infos_touch() from public, anon, authenticated;

drop trigger if exists property_operation_infos_set_updated_at on public.property_operation_infos;
drop trigger if exists property_operation_infos_touch on public.property_operation_infos;
create trigger property_operation_infos_touch
before insert or update on public.property_operation_infos
for each row execute function public.property_operation_infos_touch();

comment on column public.property_operation_infos.guest_info is
  '손님에게 보내도 되는 건물 정보(언어별). 답장 칸 「건물 정보 넣기」 · 자동 안내 변수가 쓴다. 출입 코드 · 운영 메모는 여기 넣지 않는다. docs/product/47-guest-messaging.md §6-3';
comment on column public.property_operation_infos.guest_info_updated_at is
  '손님용 칸만의 버전(저장할 때 화면이 본 값과 같을 때만 고친다). 직원용 칸 저장은 이 값을 바꾸지 않는다.';

-- ── 2) 정해 둔 문구 ───────────────────────────────────────────────────────
create table if not exists public.guest_message_saved_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 직원이 고를 때 보는 이름(한 언어). 손님에게는 나가지 않는다.
  title text not null check (char_length(btrim(title)) between 1 and 80),
  -- 손님 언어별 본문. 비어 있으면 그 언어 손님에게는 영어 본문을 넣는다(없으면 「비어 있음」).
  body_ko text not null default '' check (char_length(body_ko) <= 2000),
  body_ja text not null default '' check (char_length(body_ja) <= 2000),
  body_en text not null default '' check (char_length(body_en) <= 2000),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(body_ko)) + char_length(btrim(body_ja)) + char_length(btrim(body_en)) > 0)
);

comment on table public.guest_message_saved_replies is
  '손님 메시지 「정해 둔 문구」(조직마다). 변수 {guest_name} {checkin_date} {checkout_date} {building} {room} {nights} 는 넣을 때 대화 값으로 채운다. docs/product/47-guest-messaging.md §6-3';

create index if not exists guest_message_saved_replies_org_sort_idx
  on public.guest_message_saved_replies (organization_id, sort_order, created_at);
create index if not exists guest_message_saved_replies_created_by_idx
  on public.guest_message_saved_replies (created_by) where created_by is not null;

-- `updated_at` = 글의 버전(고치기 저장이 이 값일 때만 — 앱). 순서만 바뀌면 올리지 않는다 — 순서를 바꾼 뒤 열어 둔 편집이 「충돌」로 막히지 않게.
create or replace function public.guest_message_saved_replies_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.title, new.body_ko, new.body_ja, new.body_en) is distinct from (old.title, old.body_ko, old.body_ja, old.body_en) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function public.guest_message_saved_replies_touch() from public, anon, authenticated;

drop trigger if exists guest_message_saved_replies_set_updated_at on public.guest_message_saved_replies;
drop trigger if exists guest_message_saved_replies_touch on public.guest_message_saved_replies;
create trigger guest_message_saved_replies_touch
before update on public.guest_message_saved_replies
for each row execute function public.guest_message_saved_replies_touch();

alter table public.guest_message_saved_replies enable row level security;

-- 읽기: 그 조직에서 메시지함을 볼 수 있는 사람(+ 플랫폼 개발자). 넣기 · 고치기 · 지우기 정책은 일부러 두지 않는다.
drop policy if exists "guest saved replies: viewers can read" on public.guest_message_saved_replies;
create policy "guest saved replies: viewers can read"
on public.guest_message_saved_replies
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
);

revoke all on table public.guest_message_saved_replies from public, anon, authenticated;
grant select on table public.guest_message_saved_replies to authenticated;
grant all on table public.guest_message_saved_replies to service_role;

-- ── 3) 서버 전용 함수 — 동시에 눌러도 서로 덮지 않게 한 번에 ─────────────────────
-- 모두 `security definer` · `search_path = ''` · 실행은 service_role 만(서버 액션이 권한 · 조직을 먼저 본다).

-- 「지금 확인하기」 — 마지막으로 누른 시각 확인 + 기록을 한 줄 잠금 안에서. 간격 안이면 false(기록 안 함).
create or replace function public.guest_message_claim_manual_check(
  p_organization_id uuid,
  p_now timestamptz default now(),
  p_interval_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_last timestamptz;
begin
  insert into public.guest_message_channel_state (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select coalesce(settings, '{}'::jsonb) into v_settings
  from public.guest_message_channel_state
  where organization_id = p_organization_id
  for update;

  begin
    v_last := (v_settings ->> 'lastManualCheckAt')::timestamptz;
  exception when others then
    v_last := null;
  end;

  if v_last is not null and v_last > p_now - make_interval(secs => greatest(1, least(p_interval_seconds, 3600))) then
    return false;
  end if;

  update public.guest_message_channel_state
  set settings = v_settings || jsonb_build_object('lastManualCheckAt', to_jsonb(p_now))
  where organization_id = p_organization_id;
  return true;
end;
$$;

-- 설정 저장 — `settings` 는 응답 목표 키만 바꾸고(다른 키 · 동시에 쓴 키를 남김), 나머지는 칸.
create or replace function public.guest_message_save_settings(
  p_organization_id uuid,
  p_response_targets jsonb,
  p_night_pause boolean,
  p_credit_reserve integer,
  p_stall_hours integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_response_targets) is distinct from 'object' then
    raise exception 'invalid response targets' using errcode = '22023';
  end if;
  insert into public.guest_message_channel_state (organization_id, settings, night_pause, credit_reserve, stall_hours)
  values (p_organization_id, jsonb_build_object('responseTargetMinutes', p_response_targets), p_night_pause, p_credit_reserve, p_stall_hours)
  on conflict (organization_id) do update
  set settings = coalesce(public.guest_message_channel_state.settings, '{}'::jsonb)
                 || jsonb_build_object('responseTargetMinutes', p_response_targets),
      night_pause = excluded.night_pause,
      credit_reserve = excluded.credit_reserve,
      stall_hours = excluded.stall_hours;
end;
$$;

-- 정해 둔 문구 순서 — 받은 id 순서대로 10 간격, 한 번의 update. 이 조직 줄만 · 바뀐 줄 수를 돌려준다.
create or replace function public.guest_message_saved_replies_reorder(
  p_organization_id uuid,
  p_ids uuid[]
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with ordered as (
    select id, ((ord - 1) * 10)::integer as sort_order
    from unnest(p_ids) with ordinality as t(id, ord)
    where ord <= 10001
  ), changed as (
    update public.guest_message_saved_replies r
    set sort_order = ordered.sort_order
    from ordered
    where r.id = ordered.id
      and r.organization_id = p_organization_id
    returning r.id
  )
  select count(*)::integer from changed;
$$;

revoke all on function public.guest_message_claim_manual_check(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.guest_message_save_settings(uuid, jsonb, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.guest_message_saved_replies_reorder(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.guest_message_claim_manual_check(uuid, timestamptz, integer) to service_role;
grant execute on function public.guest_message_save_settings(uuid, jsonb, boolean, integer, integer) to service_role;
grant execute on function public.guest_message_saved_replies_reorder(uuid, uuid[]) to service_role;
