-- 보안 점검 1 · 13 (2026-11-26). 문서: docs/engineering/05-rls-permissions.md 「청소 시각 서버 고정 · organization_id 잠금(2026-11-26)」
--
-- 1) 청소 시각 서버 고정 — cleaning_sessions.started_at · completed_at · duration_seconds
--    authenticated 는 자기 기록을 칸 제한 없이 insert/update 할 수 있다(202605210001 grant + RLS 는 상태 · 담당자만 본다).
--    그래서 작업자가 PostgREST 로 바로 `started_at` 을 앞당겨 넣거나, 끝낼 때 `duration_seconds` 를 부풀려 넣을 수 있었다
--    (청소 기록 · 사람별 달력 · 급여 내보내기의 근거 값).
--
--    정상 흐름(src/lib/cleaning-session-ops.ts)은 사용자 클라이언트로 이 칸을 쓴다 — 그래서 「막기」가 아니라 「서버가 정하기」:
--    - 시작(startSessionCore, insert): 앱은 started_at 을 보내지 않는다(기본값 now()). → 트리거가 started_at := now() 로 덮는다.
--      completed_at · duration_seconds 가 들어오면 막는다(RLS 도 막지만 한 번 더).
--    - 끝내기 · 취소 · 지난 기록 닫기(completeSessionCore · cancelCleaningSession · closeStaleSessionCore, update):
--      앱이 `sessionCloseFields`(src/lib/cleaning-assign/room-rules.ts) 로 값을 만들어 보낸다. → 진행 중 → 완료/취소 전이 때만
--      트리거가 같은 규칙으로 다시 계산해 덮는다(보낸 값은 쓰지 않는다):
--        · 지난 날(cleaning_date < 도쿄 오늘) 완료 → completed_at = started_at, duration 0(「끝낸 시각 모름」)
--        · 지난 날 취소 → completed_at = now(), duration 0
--        · 오늘 → completed_at = now(), duration = round(now() - started_at 초), 0 아래는 0
--    - 그 밖 update(전이가 아닌 경우): started_at · completed_at · duration_seconds 를 바꾸면 막는다.
--    - started_at 은 어떤 update 로도 바꾸지 못한다.
--    - 기록 주인 · 날짜 · 방 · 종류(staff_user_id · cleaning_date · room_label · room_key · task_label · closed_without_cleaning)도
--      작업자 update 로 바꾸지 못한다(42501, 2026-11-26 독립 감사). 정상 흐름은 이 칸을 보내지 않는다.
--    허용 목록은 202611250003 과 같다 — service_role(관리자 강제 완료 · 완료 취소 · 처리 끝 · 2분 되돌리기 · 개발자 남의 청소 취소)
--    · postgres · supabase_admin 은 그대로 통과. 앱에서 이 칸을 서비스 키 밖에서 고치는 관리자 경로는 없다.
--    주의: 이 표에 쓰는 SECURITY DEFINER 함수를 만들면 이 트리거를 다시 볼 것(함수 안 current_user = 주인 → 통과).
--
-- 2) organization_id 잠금 — 202610280002 의 forbid_organization_id_change() 를 표 7개에 같은 방식(before update of organization_id)으로.
--    조직을 옮기는 기능은 없다. 모든 역할(서비스 키 포함)에 적용된다.
--
-- 재실행 안전: create or replace · drop trigger if exists. 표 다시 쓰기 · 잠금 오래 잡기 없음(트리거만).

begin;

create or replace function public.enforce_cleaning_session_timing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tokyo_today date;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.completed_at is not null or new.duration_seconds is not null then
      raise exception 'cleaning timing fields are written by the server only' using errcode = '42501';
    end if;
    new.started_at := now();
    return new;
  end if;

  if new.started_at is distinct from old.started_at then
    raise exception 'cleaning timing fields are written by the server only' using errcode = '42501';
  end if;

  -- 기록의 주인 · 날짜 · 방 · 종류는 시작 뒤 작업자가 바꾸지 못한다(2026-11-26 독립 감사). 정상 흐름(끝내기 · 닫기 · 취소)은
  -- 이 칸을 보내지 않는다 — status · completed_at · duration_seconds · notes 만.
  if new.staff_user_id is distinct from old.staff_user_id
     or new.cleaning_date is distinct from old.cleaning_date
     or new.room_label is distinct from old.room_label
     or new.room_key is distinct from old.room_key
     or new.task_label is distinct from old.task_label
     or new.closed_without_cleaning is distinct from old.closed_without_cleaning then
    raise exception 'cleaning session identity fields are written by the server only' using errcode = '42501';
  end if;

  if old.status = 'in_progress' and new.status in ('completed', 'cancelled') then
    tokyo_today := (now() at time zone 'Asia/Tokyo')::date;
    if old.cleaning_date < tokyo_today then
      new.completed_at := case when new.status = 'completed' then old.started_at else now() end;
      new.duration_seconds := 0;
    else
      new.completed_at := now();
      new.duration_seconds := greatest(0, round(extract(epoch from (now() - old.started_at))))::integer;
    end if;
    return new;
  end if;

  if new.completed_at is distinct from old.completed_at
     or new.duration_seconds is distinct from old.duration_seconds then
    raise exception 'cleaning timing fields are written by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_cleaning_session_timing() from public, anon, authenticated;

drop trigger if exists cleaning_sessions_timing_guard on public.cleaning_sessions;
create trigger cleaning_sessions_timing_guard
  before insert or update on public.cleaning_sessions
  for each row
  execute function public.enforce_cleaning_session_timing();

-- 2) organization_id 잠금
drop trigger if exists announcements_forbid_org_change on public.announcements;
create trigger announcements_forbid_org_change
  before update of organization_id on public.announcements
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists cleaning_sessions_forbid_org_change on public.cleaning_sessions;
create trigger cleaning_sessions_forbid_org_change
  before update of organization_id on public.cleaning_sessions
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists tasks_forbid_org_change on public.tasks;
create trigger tasks_forbid_org_change
  before update of organization_id on public.tasks
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists guest_conversations_forbid_org_change on public.guest_conversations;
create trigger guest_conversations_forbid_org_change
  before update of organization_id on public.guest_conversations
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists guest_message_channel_state_forbid_org_change on public.guest_message_channel_state;
create trigger guest_message_channel_state_forbid_org_change
  before update of organization_id on public.guest_message_channel_state
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists property_operation_infos_forbid_org_change on public.property_operation_infos;
create trigger property_operation_infos_forbid_org_change
  before update of organization_id on public.property_operation_infos
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists reservation_internal_notes_forbid_org_change on public.reservation_internal_notes;
create trigger reservation_internal_notes_forbid_org_change
  before update of organization_id on public.reservation_internal_notes
  for each row execute function public.forbid_organization_id_change();

commit;
