-- 청소 점검 C1 — 2인 방은 각자 기록 · 같은 순간 중복 시작 막기 · 취소한 날 배정 막기 (2026-11-02)
--
-- 도메인 계약: docs/product/07-cleaning-workflow.md 「2인 방 — 각자 기록」 · docs/product/37-cleaning-shift-assignment.md 「4-2-e」
--
-- 사용자 결정(2026-11-02): 한 방에 두 사람이 배정되면 **둘 다 각자** 청소를 시작 · 끝내고 기록도 각자 남는다.
-- 예전엔 「그 방에 오늘 기록이 하나라도 있으면」 시작을 막아서 두 번째 사람은 시작할 수 없었고, 그 막기도 앱이 읽고 → 넣는
-- 두 단계라 두 사람이 같은 순간 누르면 둘 다 들어갈 수 있었다(문서 07 「남은 것 — DB 유니크 인덱스」).
--
-- ① `room_key` — 기록이 어느 **실제 방**인지(배정 `cleaning_assignments.room_key` 와 같은 모양). 아라키초는 한 방에 계정 라벨이
--    둘(`401` · `401_2_2`)이라 `room_label` 만으로는 같은 방을 못 묶는다. 앱이 넣는다 — 비어 있으면(예전 기록 · 예전 앱) `room_label`.
-- ② 한 사람은 그날 한 방에 기록(진행 중 · 완료) 하나 — 부분 유니크 인덱스. 운영 데이터 확인: 해당 중복 0건(2026-11-02).
-- ③ 누가 그 방에 기록을 넣을 수 있나 — 트리거가 방마다 advisory lock 을 잡고 본다(같은 순간 두 번째 시작도 막힘):
--    - 그날 그 방에 **배정된 사람**: 자기 기록이 없으면 언제나(배정된 자리는 그 사람 몫 — 남이 먼저 해도 빼앗기지 않는다).
--    - **배정 안 된 사람**(배정 없는 방 포함): 그 방에 아직 아무 기록이 없을 때만 — 배정 없는 방은 예전처럼 한 사람.
--    - 「처리 끝」 기록이 있는 방은 아무도. 「처리 끝」 기록 자체는 검사하지 않지만 같은 잠금은 잡는다 — 처리 끝 **뒤의** 시작은 꼭 막힌다.
--      이미 누가 청소 중인 방을 관리자가 처리 끝으로 두는 것은 막지 않는다(그 사람은 오늘 내 방에서 「끝내기」를 그대로 누를 수 있다 — 문서 37).
--    `room_key` 가 빈 기록(이 마이그레이션 전 · 예전 앱)은 라벨로만 묶는다 — 아라키초 쉬는 계정 라벨(`401_2_2`)은 그때 못 묶어서,
--    적용과 앱 배포를 청소 없는 밤에 이어서 한다(문서 04 「배포 순서」). 지난 날 기록은 앱 판정이 라벨에서 키를 만들어 묶는다.
--    같은 방 묶기: `coalesce(room_key, room_label)` 이 같거나 `room_label` 이 같으면 같은 방(room_key 없는 예전 기록도 라벨로 맞춤).
--    담당 · 날짜 · 상태가 바뀔 때만 다시 본다 — 라벨 정리 스크립트(`cleaning:normalize-room-labels`)가 지난 기록 라벨을 고칠 때는 안 본다.
-- ④ 관리자가 그날 일정을 취소한 사람(`cleaning_shift_applications.cancelled_at`)에게 배정을 넣지 않는다 — 살리는 길은 「다시 넣기」
--    (취소를 먼저 푼다) 하나뿐. 앱도 먼저 막고(점검 A4), 이건 마지막 방어선.

-- ① 실제 방 키
alter table public.cleaning_sessions
  add column if not exists room_key text check (room_key is null or char_length(room_key) between 1 and 120);

comment on column public.cleaning_sessions.room_key is
  '실제 방 키(배정 room_key 와 같은 모양) — 2인 방 · 중복 확인용. 비어 있으면 room_label 로 본다.';

-- ② 한 사람 · 하루 · 한 방 = 기록 하나(진행 중 · 완료). 처리 끝 기록은 청소가 아니라 뺀다.
create unique index if not exists cleaning_sessions_one_per_user_room_day_idx
  on public.cleaning_sessions (organization_id, cleaning_date, (coalesce(room_key, room_label)), staff_user_id)
  where status in ('in_progress', 'completed') and not closed_without_cleaning;

-- ③ 누가 그 방에 기록을 넣을 수 있나
create or replace function public.cleaning_sessions_enforce_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_key text := coalesce(new.room_key, new.room_label);
  v_assigned boolean;
  v_taken integer;
begin
  if new.status not in ('in_progress', 'completed') then
    return new;
  end if;
  -- 같은 사람 · 같은 날 안에서 상태만 바뀌는 경우(끝내기 · 되돌리기 · 시각 채우기)는 다시 보지 않는다.
  if tg_op = 'UPDATE'
     and old.status in ('in_progress', 'completed')
     and old.closed_without_cleaning = new.closed_without_cleaning
     and old.staff_user_id = new.staff_user_id
     and old.cleaning_date = new.cleaning_date then
    return new;
  end if;

  -- 같은 방(조직 · 날짜 · 방)을 동시에 넣는 트랜잭션을 줄 세운다 — 앞 사람이 커밋한 뒤에 센다.
  -- 「처리 끝」 기록도 잠금은 잡는다 — 관리자 처리 끝과 직원 시작이 같은 순간이면 뒤 사람이 앞 기록을 보게(검사는 안 한다).
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || '|' || new.cleaning_date::text || '|' || v_key, 0));
  if new.closed_without_cleaning then
    return new;
  end if;

  if exists (
    select 1 from public.cleaning_sessions s
    where s.organization_id = new.organization_id
      and s.cleaning_date = new.cleaning_date
      and (coalesce(s.room_key, s.room_label) = v_key or s.room_label = new.room_label)
      and s.status = 'completed'
      and s.closed_without_cleaning
  ) then
    raise exception 'cleaning_room_full' using errcode = 'P0001', detail = 'resolved';
  end if;

  select exists (
    select 1 from public.cleaning_assignments a
    where a.organization_id = new.organization_id
      and a.work_date = new.cleaning_date
      and a.room_key = v_key
      and a.user_id = new.staff_user_id
  ) into v_assigned;
  if v_assigned then
    return new;
  end if;

  select count(*) into v_taken
  from public.cleaning_sessions s
  where s.organization_id = new.organization_id
    and s.cleaning_date = new.cleaning_date
    and (coalesce(s.room_key, s.room_label) = v_key or s.room_label = new.room_label)
    and s.status in ('in_progress', 'completed')
    and not s.closed_without_cleaning
    and s.staff_user_id <> new.staff_user_id
    and s.id <> new.id;

  if v_taken > 0 then
    raise exception 'cleaning_room_full' using errcode = 'P0001', detail = 'taken';
  end if;
  return new;
end;
$function$;

revoke all on function public.cleaning_sessions_enforce_room_capacity() from public, anon, authenticated;

drop trigger if exists cleaning_sessions_room_capacity on public.cleaning_sessions;
create trigger cleaning_sessions_room_capacity
  before insert or update of status, staff_user_id, cleaning_date, closed_without_cleaning
  on public.cleaning_sessions
  for each row execute function public.cleaning_sessions_enforce_room_capacity();

-- ④ 취소한 날 배정 막기
create or replace function public.cleaning_assignments_block_cancelled_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if exists (
    select 1 from public.cleaning_shift_applications a
    where a.organization_id = new.organization_id
      and a.user_id = new.user_id
      and a.work_date = new.work_date
      and a.cancelled_at is not null
  ) then
    raise exception 'cleaning_day_cancelled' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function public.cleaning_assignments_block_cancelled_day() from public, anon, authenticated;

drop trigger if exists cleaning_assignments_cancelled_day on public.cleaning_assignments;
create trigger cleaning_assignments_cancelled_day
  before insert or update of user_id, work_date
  on public.cleaning_assignments
  for each row execute function public.cleaning_assignments_block_cancelled_day();
