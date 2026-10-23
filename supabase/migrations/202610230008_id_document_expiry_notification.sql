-- 재류카드 만료 알림: notification_type 에 `id_document_expiring` 추가 (2026-10-23).
--
-- 매일 `/api/tasks/reminders` 크론이 지금 재류카드(확인 대기 · 확인함)의 만료일을 보고 90일 전 · 30일 전 · 만료(만료일 다음 날)에
-- 본인 · `staff_documents.view` 가진 같은 조직 사람에게 알림을 만든다 — `src/lib/notifications/id-document-reminders.ts`.
-- 중복은 notifications 의 unique (recipient_user_id, dedupe_key) 로 막는다(`id_doc_expiring:<서류id>:<단계>`).
--
-- 원래 이름은 202610230007 이었지만 그 번호를 `membership_default_team` 이 먼저 썼다.
-- 문서: docs/product/41-residence-card-workflow.md 「만료 표시 · 만료 알림」 · docs/product/14-notification-design.md
--
-- `add value if not exists` 는 다시 돌려도 안전하다. enum 값은 지울 수 없다(되돌리려면 타입을 다시 만들어야 함) — 형제 마이그레이션과 같은 한 방향 변경.

alter type public.notification_type add value if not exists 'id_document_expiring';
