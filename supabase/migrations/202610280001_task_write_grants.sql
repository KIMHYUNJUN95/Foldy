-- 할 일 · 프로젝트 표 — 사용자 쓰기 권한 회수 + 업무일지 예약 「살아 있는 예약 하나」 인덱스에 조직 넣기 (2026-10-28).
--
-- ① 쓰기 권한 회수
--   202606100003(tasks · task_participants · task_updates) · 202606150002(projects · project_participants · project_sections)
--   가 authenticated 에 INSERT · UPDATE · DELETE 를 줬고, 운영 DB 에서는 TRUNCATE 까지 붙어 있었다(2026-10-28 읽기 전용 조회로 확인).
--   쓰기 RLS 정책은 「만든 사람 = 본인 + 같은 조직」만 보고 project_id · image_urls · deleted_at 은 거르지 않는다.
--   그래서 직원 누구나(알바 포함) 자기 로그인 토큰 + 공개 anon 키로 PostgREST 를 바로 부르면
--     - 다른 팀 프로젝트에 자기 할 일을 넣고,
--     - 사진 5장 / 프로젝트 20장 제한과 저장 경로 검사를 건너뛰고,
--     - 소프트 삭제(deleted_at)를 건너뛰어 아예 지우고,
--     - task_updates 에 update_type = 'completed' · 임의 created_at 을 넣어 업무일지 완료 기록을 꾸밀 수 있었다.
--   앱의 쓰기는 이미 전부 서버 액션의 service role 로만 한다(src/app/mobile/tasks/** · src/app/admin/tasks/actions.ts ·
--   src/lib/task-occurrences.ts · src/actions/task-report-schedule.ts — 2026-10-28 코드 확인, 사용자 세션 쓰기 없음).
--   service role 은 GRANT 와 RLS 를 모두 우회하므로 이 회수로 앱 동작은 바뀌지 않는다. 읽기(SELECT)는 그대로 두고 RLS 로 거른다.
--   task_occurrence_state · task_occurrence_order · task_report_schedules 는 처음부터 SELECT 만 줬지만,
--   기본 권한이 붙어 있을 수도 있어 같이 회수한다(이미 없으면 아무 일도 안 한다 — 여러 번 돌려도 같음).
--   쓰기 RLS 정책은 지우지 않고 둔다: 권한이 없으면 정책까지 가지 않아 해가 없고, 이름이 여러 마이그레이션에서 바뀌어 와서
--   지우다 빠뜨리는 것보다 그대로 두는 편이 안전하다. 나중에 사용자 쓰기를 다시 열 일이 생기면 정책부터 다시 볼 것.
--   문서: docs/engineering/05-rls-permissions.md → 할 일(Todo) · 프로젝트.

revoke insert, update, delete, truncate on table
  public.tasks,
  public.task_participants,
  public.task_updates,
  public.task_occurrence_state,
  public.task_occurrence_order,
  public.task_report_schedules,
  public.projects,
  public.project_participants,
  public.project_sections
from anon, authenticated;

-- ② 업무일지 예약 — 「한 사람 · 한 날짜에 살아 있는 예약 하나」를 조직별로
--   202610200005 의 task_report_schedules_one_active 가 (user_id, report_date) 만 묶어서, 두 조직에 속한 사람이
--   같은 날짜를 두 조직에서 각각 예약할 수 없었다(23505 → 「busy」). 서버 액션은 이미 조직별로 이전 예약을 취소하므로
--   인덱스에 organization_id 를 넣어 맞춘다. 같은 부분 조건(WHERE)을 그대로 쓴다.
--   새 인덱스는 옛 인덱스보다 느슨해서(열이 하나 더) 지금 있는 행으로 만들다 실패할 수 없다. 표가 작아 CONCURRENTLY 는 쓰지 않는다.

create unique index if not exists task_report_schedules_one_active_per_org
  on public.task_report_schedules (organization_id, user_id, report_date)
  where status in ('scheduled', 'sending');

drop index if exists public.task_report_schedules_one_active;
