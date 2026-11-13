-- 보안 점검 (2026-11-13) — 익명(anon) 이 RPC 로 부를 수 있던 SECURITY DEFINER 함수 닫기 + search_path 고정.
--
-- 배경. Postgres 는 함수를 만들면 PUBLIC 에 EXECUTE 를 준다. Supabase 는 anon 에게도 따로 준다(default privileges).
-- 그래서 로그인하지 않은 호출자가 /rest/v1/rpc/<함수> 로 부를 수 있었다(advisor `anon_security_definer_function_executable`).
--
-- 운영 pg_policies 를 읽어 확인한 결과(2026-11-13), 역할 지정 없는(PUBLIC/anon) 정책에서 쓰이는 함수는 9개다:
--   can_manage_attendance_payroll · can_view_payroll · can_view_staff_suggestion · current_user_active_organization_ids ·
--   has_active_membership · has_org_role · is_platform_admin · is_project_participant · is_task_participant
-- 이 9개는 anon EXECUTE 를 **일부러 남긴다.** 익명이면 auth.uid() 가 null 이라 false/빈 값만 돌려줘 피해가 없고,
-- 회수하면 anon 이 그 정책이 걸린 표를 읽을 때 «빈 결과» 대신 permission denied(42501) 로 깨진다.
--
-- 1) PUBLIC/anon 정책에서 쓰이지 않는 3개 — public · anon 회수, authenticated · service_role 유지:
--    can_manage_transport · has_permission_override · is_leave_approver
--    (has_permission_override 는 202609040002 에서 properties/rooms ALL 정책 때문에 회수 대신 가드로 막았지만,
--     지금 운영의 PUBLIC/anon 정책에서는 쓰이지 않아 회수해도 안전하다.)
-- 2) 트리거 함수 ops_stats_mark_* 3개 — 트리거는 발동 때 EXECUTE 를 검사하지 않는다(만들 때만).
--    RPC 로 부를 이유가 없으니 public · anon · authenticated 모두 회수.
-- 3) default_team_kind_for_role — search_path 고정(advisor `function_search_path_mutable`).
--    본문은 `in (...)` 과 `'field'::public.team_kind` 뿐이라 '' 로 안전하다.
--
-- 멱등: revoke · grant · alter function set 은 반복해도 안전하다.
--
-- 되돌리기:
--   grant execute on function public.can_manage_transport(uuid) to anon, public;
--   grant execute on function public.has_permission_override(uuid, uuid, text) to anon, public;
--   grant execute on function public.is_leave_approver(uuid) to anon, public;
--   grant execute on function public.ops_stats_mark_property() to anon, authenticated, public;  (reservation · room 도 같게; 필요 없음)
--   alter function public.default_team_kind_for_role(text) reset search_path;
--
-- 적용 필요: 운영 Supabase 에 아직 적용 전.

-- 1) 정책에서 안 쓰이는 헬퍼
revoke execute on function public.can_manage_transport(uuid) from public, anon;
revoke execute on function public.has_permission_override(uuid, uuid, text) from public, anon;
revoke execute on function public.is_leave_approver(uuid) from public, anon;

grant execute on function public.can_manage_transport(uuid) to authenticated, service_role;
grant execute on function public.has_permission_override(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.is_leave_approver(uuid) to authenticated, service_role;

-- 2) 트리거 함수
revoke execute on function public.ops_stats_mark_property() from public, anon, authenticated;
revoke execute on function public.ops_stats_mark_reservation() from public, anon, authenticated;
revoke execute on function public.ops_stats_mark_room() from public, anon, authenticated;

-- 3) search_path 고정
alter function public.default_team_kind_for_role(text) set search_path = '';
