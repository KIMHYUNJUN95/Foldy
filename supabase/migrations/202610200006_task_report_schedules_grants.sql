-- 업무일지 예약 보내기 — 표 권한 보강 (2026-10-20).
--
-- 202610200005 가 표를 만들며 GRANT 를 빠뜨려 service_role 에 SELECT · INSERT · UPDATE 가 없었다(TRIGGER · REFERENCES ·
-- TRUNCATE 뿐). 그래서 예약이 저장되지 않고 「Slack 으로 보내지 못했습니다」가 떴다(로그: permission denied for table
-- task_report_schedules). 다른 표들(202609290001 등)과 같이 명시적으로 준다. 쓰기는 서버만, 사용자는 RLS 로 본인 것만 읽는다.

grant all on public.task_report_schedules to service_role;
grant select on public.task_report_schedules to authenticated;
