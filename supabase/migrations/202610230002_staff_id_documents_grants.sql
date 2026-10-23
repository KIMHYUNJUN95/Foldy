-- staff_id_documents 표 권한(GRANT) — 202610230001 에서 빠져 서버 등록이 42501(권한 없음)로 실패했다(2026-10-23 사용자 제보 「등록하지 못했어요」).
-- 이 프로젝트는 새 표에 기본 권한이 붙지 않는다(202610200006 task_report_schedules 와 같은 실수). 쓰기는 서버(service role)만, 읽기는 RLS 정책대로.
grant all on public.staff_id_documents to service_role;
grant select on public.staff_id_documents to authenticated;
