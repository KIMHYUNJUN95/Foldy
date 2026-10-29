-- 운영 화면 실시간 신호 (2026-10-29) — 할 일 · 주문/수리/분실물 요청 · 알림 · 근태 대기열.
--
-- 다른 사람이 바꾸면 열어 둔 PC 대시보드 · 모바일 화면이 새로고침 없이 바뀌어야 한다. 이 테이블들을
-- realtime publication 에 넣어 브라우저가 변경 신호를 받게 한다.
--
-- 신호만 쓴다(`src/components/shared/live-refresh.tsx` → 서버 렌더 다시 받기). 행 데이터는 화면에 쓰지 않는다.
-- 구독은 각 테이블의 select RLS 를 그대로 통과해야 하므로, 볼 수 없는 행(남의 비공개 할 일 · 남의 정정 요청)의
-- 신호는 오지 않는다. 삭제 신호는 오지 않는다(replica identity 기본값) — 할 일은 소프트 삭제라 UPDATE 로 오고,
-- 주문 · 수리 · 분실물의 하드 삭제는 다음 갱신 때 빠진다(채용 · 연차와 같은 결정).
do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks',
    'task_occurrence_state',
    'task_participants',
    'task_updates',
    'order_requests',
    'maintenance_reports',
    'lost_items',
    'notifications',
    'attendance_correction_requests',
    'transport_reimbursement_reports',
    'attendance_sessions'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- 삭제 신호 대신 부모 할 일을 건드린다.
--
-- 반복 할 일의 완료 되돌리기 · 「건너뛴 날」 되살리기(`task_occurrence_state` 행 삭제)와 참여자 빼기(`task_participants`
-- 행 삭제)는 DELETE 라 신호가 오지 않는다(위 설명). 지운 행의 할 일 `updated_at` 을 새로 써서 `tasks` UPDATE 신호를 대신 보낸다
-- — 그 할 일을 볼 수 있는 사람(RLS)의 화면이 다시 읽는다. `updated_at` 은 화면에 쓰이지 않는다(정렬 · 표시 없음).
-- 문장 단위 트리거라 여러 행을 한 번에 지워도 할 일마다 한 번. 할 일 자체를 하드 삭제해 따라 지워질 때는 부모가 이미 없어 0행.
-- 직원 세션의 직접 쓰기 권한이 없어도(2026-10-28 회수) 돌도록 security definer.
create or replace function public.touch_task_after_child_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks t
     set updated_at = now()
   where t.id in (select distinct o.task_id from old_rows o);
  return null;
end;
$$;

revoke all on function public.touch_task_after_child_delete() from public, anon, authenticated;

drop trigger if exists task_occurrence_state_touch_task on public.task_occurrence_state;
create trigger task_occurrence_state_touch_task
  after delete on public.task_occurrence_state
  referencing old table as old_rows
  for each statement
  execute function public.touch_task_after_child_delete();

drop trigger if exists task_participants_touch_task on public.task_participants;
create trigger task_participants_touch_task
  after delete on public.task_participants
  referencing old table as old_rows
  for each statement
  execute function public.touch_task_after_child_delete();
