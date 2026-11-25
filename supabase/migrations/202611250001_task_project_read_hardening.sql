-- 할 일 · 프로젝트 직접 읽기 보강 (2026-11-25) — 앱을 거치지 않고 PostgREST · Realtime 으로 직접 읽을 때의 빈틈을 닫는다.
-- 문서: docs/engineering/05-rls-permissions.md 「할 일 · 프로젝트 직접 읽기 보강(2026-11-25)」
-- 두 번 돌려도 같은 결과가 되게 썼다(revoke · grant · drop policy if exists → create policy). 전체를 begin; … commit; 한 거래로 감싸 반쯤 적용되지 않게 한다(202611200003 · 202611190001 과 같은 방식).
--
-- 누가 무엇을 볼 수 있는지(권한 규칙)는 바꾸지 않는다. 지금 활성 멤버인 사용자에게 보이는 행은 그대로다.
-- 달라지는 것은 「그 조직에서 나간(멤버십이 활성이 아닌) 사람」과 로그인하지 않은 호출자(anon)뿐이다 — 앱 세션은
-- 활성 멤버십(또는 플랫폼 관리자)이 없으면 만들어지지 않으므로(src/lib/session.ts) 앱 화면은 바뀌지 않는다.
--
-- ── 사용자 세션으로 이 표들을 쓰는 곳 (2026-11-25 src 전수 grep) ──────────────────────────────────────────────
--   쓰기: 없음. tasks · task_participants · task_updates · task_occurrence_state · task_occurrence_order ·
--         task_report_schedules · projects · project_participants · project_sections 의 insert · update · delete 는 전부
--         getSupabaseServiceClient()(service role) — src/app/mobile/tasks/** · src/app/admin/tasks/actions.ts ·
--         src/lib/task-create.ts · src/lib/task-occurrences.ts · src/lib/task-images.ts · src/actions/task-report-schedule.ts ·
--         src/actions/guest-message-tasks.ts · src/app/api/tasks/**. 지운 할 일 되살리기(restoreTask · restoreConsoleTask)도 service role.
--   읽기(사용자 세션 getSupabaseServerClient): src/lib/tasks.ts · src/lib/projects.ts · src/actions/task-report.ts.
--   실시간 구독(브라우저 · 로그인 토큰): src/components/shared/live-refresh.tsx ← src/lib/live-sources.ts
--         (tasks · task_occurrence_state · task_participants · task_updates).
--
-- ── 일부러 건드리지 않는 것 ─────────────────────────────────────────────────────────────────────────────────────
--   tasks 읽기 정책에 `deleted_at is null` 을 넣지 않는다. 사용자 세션이 소프트 삭제된 행을 읽는 곳이 있다:
--     ① 실시간 — 할 일을 지우면 deleted_at 을 채우는 UPDATE 신호로 다른 사람 화면이 다시 읽는다(202610290001 머리 주석).
--        Realtime 은 바뀐 뒤 행에 select RLS 를 걸므로, 조건을 넣으면 삭제 신호가 아예 오지 않는다.
--     ② src/lib/tasks.ts loadTaskScope — task_participants → tasks(project_id) 끼워 읽기 · 프로젝트 할 일 id 읽기에
--        deleted_at 조건이 없다(가시 범위 계산이 지운 행을 포함한 채로 돈다).
--   그래서 「참여자는 자기가 참여한 지운 할 일을 직접 읽을 수 있다」는 그대로 둔다(05 문서 「Soft delete」 — 의도된 동작).
--   쓰기 RLS 정책(작성자 insert · update · delete, 참여자 메모 insert)은 지우지 않는다 — 202610280001 이 표 권한을 거뒀으므로
--   정책까지 가지 않는다(그 파일과 같은 판단).
--   프로젝트 멤버가 남의 할 일을 완료 · 다시 열기 · 건너뛰기 하는 문제는 서버 액션 쪽 권한 결정이라 여기서 다루지 않는다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 표 권한 — anon 은 모두 거두고, authenticated 는 읽기만.
--    anon: 로그인하지 않은 호출자가 이 표를 읽을 이유가 없다(RLS 가 auth.uid() null 로 빈 결과를 주지만 권한 자체를 거둔다).
--          앱의 실시간 구독은 로그인 토큰(authenticated)으로 붙는다(live-refresh.tsx 의 realtime.setAuth).
--    202611130100 과 다른 이유: 그 파일은 anon 이 «읽어도 되는» 표의 정책 헬퍼 함수 EXECUTE 를 남겼다 — 회수하면 그 표를 읽는
--          anon 이 빈 결과 대신 42501 로 깨지기 때문이다. 이 9개 표는 anon 으로 읽는 곳이 없다(2026-11-25 grep: 읽기는
--          쿠키 세션 getSupabaseServerClient · service role 뿐, 브라우저 클라이언트로 이 표를 .from() 하는 곳 없음). 토큰 없이 붙은
--          실시간 구독은 지금도 거절된다(live-refresh.tsx 72-74줄 — `invalid column for filter organization_id`, 2026-10-15 실측).
--          같은 방식의 선례: 202611200003 의 reservations `revoke all ... from anon`. 헬퍼 함수 EXECUTE 는 여기서 건드리지 않는다.
--    authenticated: 202610280001 이 거둔 쓰기를 한 번 더 거두고(뒤에 기본 권한으로 다시 붙었을 수 있음),
--          쓰지 않는 references · trigger 도 거둔다. select 는 남긴다(위 읽기 · 실시간 경로).
--    service_role 은 그대로(GRANT · RLS 모두 우회).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

revoke all on table
  public.tasks,
  public.task_participants,
  public.task_updates,
  public.task_occurrence_state,
  public.task_occurrence_order,
  public.task_report_schedules,
  public.projects,
  public.project_participants,
  public.project_sections
from anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.tasks,
  public.task_participants,
  public.task_updates,
  public.task_occurrence_state,
  public.task_occurrence_order,
  public.task_report_schedules,
  public.projects,
  public.project_participants,
  public.project_sections
from authenticated;

grant select on table
  public.tasks,
  public.task_participants,
  public.task_updates,
  public.task_occurrence_state,
  public.task_occurrence_order,
  public.task_report_schedules,
  public.projects,
  public.project_participants,
  public.project_sections
to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) task_participants · task_updates 읽기 — 부모 할 일의 조직에 지금 활성 멤버일 때만.
--    예전(202609040001:64-77)은 `is_task_participant(task_id)` 만 봐서, 조직에서 나간 사람도 참여자 행이 남아 있는 한
--    그 할 일의 참여자 명단과 메모 · 완료 기록(task_updates.body)을 직접 읽을 수 있었다. 이 표들엔 organization_id 칸이 없어
--    202609030002 · 202610160003 의 조직 조건이 닿지 않았다. tasks 읽기 정책은 이미 활성 멤버를 본다 — 같은 조건을 맞춘다.
--    하위 조회의 tasks 는 tasks 읽기 RLS 를 함께 탄다: 참여자 + 활성 멤버면 늘 보이므로 결과가 넓어지지 않는다
--    (프로젝트 멤버에게 남의 할 일 기록을 새로 열지 않는다 — is_task_participant 를 그대로 먼저 건다).
--    재귀 없음: tasks 정책은 SECURITY DEFINER 헬퍼(is_task_participant · is_project_participant)로만 하위 표를 본다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "participants can read participant rows" on public.task_participants;
create policy "participants can read participant rows" on public.task_participants
  for select to authenticated using (
    (select auth.uid()) is not null
    and (
      (select public.is_platform_admin())
      or (
        public.is_task_participant(task_id)
        and exists (
          select 1
          from public.tasks t
          where t.id = task_participants.task_id
            and t.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
        )
      )
    )
  );

drop policy if exists "participants can read task updates" on public.task_updates;
create policy "participants can read task updates" on public.task_updates
  for select to authenticated using (
    (select auth.uid()) is not null
    and (
      (select public.is_platform_admin())
      or (
        public.is_task_participant(task_id)
        and exists (
          select 1
          from public.tasks t
          where t.id = task_updates.task_id
            and t.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
        )
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) project_participants · project_sections 읽기 — 프로젝트의 조직에 지금 활성 멤버일 때만.
--    예전(202609080001:82-94)은 `is_project_participant(project_id)` 만 봤다(organization_id 칸이 없어 조직 조건을 걸지 않음).
--    조직에서 나간 사람이 프로젝트 멤버 명단 · 섹션 이름을 계속 읽을 수 있었다. projects 읽기 정책과 같은 조건으로 맞춘다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "participants can read project participant rows" on public.project_participants;
create policy "participants can read project participant rows" on public.project_participants
  for select to authenticated using (
    (select auth.uid()) is not null
    and (
      (select public.is_platform_admin())
      or (
        public.is_project_participant(project_id)
        and exists (
          select 1
          from public.projects p
          where p.id = project_participants.project_id
            and p.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
        )
      )
    )
  );

drop policy if exists "participants can read project sections" on public.project_sections;
create policy "participants can read project sections" on public.project_sections
  for select to authenticated using (
    (select auth.uid()) is not null
    and (
      (select public.is_platform_admin())
      or (
        public.is_project_participant(project_id)
        and exists (
          select 1
          from public.projects p
          where p.id = project_sections.project_id
            and p.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
        )
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) task_report_schedules 읽기 — 본인 것 + 그 조직에 지금 활성 멤버일 때만.
--    예전(202610200005:57-61)은 `auth.uid() = user_id` 만 봤다. 앱은 이 표를 service role 로만 읽는다
--    (src/actions/task-report-schedule.ts · src/app/api/tasks/report-tick/route.ts) — 이 정책은 직접 읽기용 방어선이다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "task report schedules: read own" on public.task_report_schedules;
create policy "task report schedules: read own" on public.task_report_schedules
  for select to authenticated using (
    user_id = (select auth.uid())
    and organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
  );

commit;
