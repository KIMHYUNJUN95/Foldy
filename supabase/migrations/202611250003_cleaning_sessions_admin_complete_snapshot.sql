-- 관리자 대리 완료 취소(2026-11-25 사용자 결정) — 강제 완료가 덮어쓰기 직전 값을 남긴다.
-- See docs/product/07-cleaning-workflow.md → 「대리 완료 취소」.
--
-- 값 모양(앱이 쓰고 읽는다 — src/lib/cleaning-force-complete-undo.ts):
--   { "v": 1, "created": true,  "applied": { staff_user_id, started_at, completed_at, notes } }   -- 관리자가 새로 만든 기록(취소 = 삭제)
--   { "v": 1, "created": false, status, staff_user_id, started_at, completed_at, duration_seconds, notes,
--     completed_by_admin, "applied": {...} }                                              -- 진행 중 · 시각 모름 기록을 덮어씀(취소 = 복원)
-- 취소하면 앱이 null 로 비운다. 담당자가 다시 열고 끝냈거나 다시 완료 처리된 기록은 값이 남아 있어도
-- applied(그때 쓴 담당 · 시각)와 지금 줄이 달라 「바뀜」으로 막힌다. 스냅샷 없는 예전 대리 완료는 취소하지 않는다.
--
-- No RLS / grant change (a guard trigger is added below): force complete and undo write through the service-role client after an
-- app-level capability check (cleaning.force_complete), same as completed_by_admin (202607150001).
-- Nullable with no default — adding it is a metadata-only change, no table rewrite.

alter table public.cleaning_sessions
  add column if not exists admin_complete_snapshot jsonb;

comment on column public.cleaning_sessions.admin_complete_snapshot is
  '관리자 강제 완료 직전 값(완료 취소용). 오늘 · 관리자 완료 기록만 취소할 수 있고, 취소하면 null. created=true 면 취소 시 기록을 지운다.';

-- 위조 방지(2026-11-25 독립 검사): authenticated 는 자기 기록을 칸 제한 없이 insert/update 할 수 있다(202605210001 grant).
-- 그대로 두면 작업자가 자기 행에 `completed_by_admin` · `admin_complete_snapshot` 을 지어 넣고, 관리자가 「완료 취소」를
-- 누를 때 서비스 키가 그 값으로 복원 · 삭제한다. 두 칸은 서비스 키(관리자 강제 완료 · 처리 끝)만 채운다.
-- - 허용 목록 밖 역할(authenticated 등)이 두 칸을 null 아닌 값으로 넣거나 다른 값으로 바꾸면 막는다.
-- - null 로 비우는 것과 손대지 않는 것은 허용한다(다른 칸만 고치는 정상 흐름, 담당자 2분 되돌리기가 대리 표시를 비우는 것).
-- 모바일 작업자 흐름(시작 · 완료 · 지난 기록 닫기)은 두 칸을 쓰지 않는다 — 앱에서 두 칸을 쓰는 곳은 모두 서비스 키다.
create or replace function public.enforce_cleaning_admin_complete_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 허용 목록(2차 점검 8): 서비스 키 · 마이그레이션 · 관리 계정만 그대로 통과한다. 그 밖의 역할(authenticated · anon ·
  -- 앞으로 생길 역할)은 모두 아래 검사를 받는다 — 「authenticated 만 막기」였을 때는 새 역할이 생기면 빠져나갔다.
  -- 주의: 이 표에 쓰는 SECURITY DEFINER 함수를 만들면 이 트리거를 다시 볼 것 — 그 함수 안에서는 current_user 가
  -- 함수 주인(보통 postgres)이라 여기서 통과한다. 작업자가 부르는 함수라면 두 칸을 직접 막아야 한다.
  -- (2026-11-25 기준 cleaning_sessions 에 쓰는 SECURITY DEFINER 함수는 없다.)
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.completed_by_admin is not null or new.admin_complete_snapshot is not null then
      raise exception 'admin completion fields are written by the server only' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.completed_by_admin is not null and new.completed_by_admin is distinct from old.completed_by_admin)
     or (new.admin_complete_snapshot is not null and new.admin_complete_snapshot is distinct from old.admin_complete_snapshot) then
    raise exception 'admin completion fields are written by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_cleaning_admin_complete_fields() from public, anon, authenticated;

drop trigger if exists cleaning_sessions_admin_complete_guard on public.cleaning_sessions;
create trigger cleaning_sessions_admin_complete_guard
  before insert or update on public.cleaning_sessions
  for each row
  execute function public.enforce_cleaning_admin_complete_fields();
