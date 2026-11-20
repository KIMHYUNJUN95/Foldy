-- 예약 원본 · 알림 만들기 권한 좁히기 — 2026-11-20 (보안 점검).
--
-- 권한:       docs/engineering/05-rls-permissions.md → reservations · notifications
-- 데이터 모델: docs/engineering/04-data-model.md → reservations
--
-- 1. reservations 칸 권한 — `raw_payload`(Beds24 원본: 손님 전화 · 이메일 · 주소 · 금액 · 메모) 와 `last_known_amount` 를
--    일반 사용자(PostgREST · Realtime) 읽기에서 뺀다. 예전 `grant select on public.reservations to authenticated`(202605220001)
--    는 표 전체 읽기라, 조직 구성원 누구나(알바 포함) 브라우저에서 API 로 원본을 통째로 꺼낼 수 있었다.
--    화면은 이제 원본이 필요한 예약 조회를 서버 키(service_role) + `organization_id` 조건으로 읽는다
--    (ops-calendar · 판매 요약 · 모바일 캘린더 · 건물 지도 · 관리자 캘린더 · 청소 대상 · 홈). 나머지 칸은 그대로 읽히고
--    RLS 정책(「members can read organization reservations」)도 그대로다.
--    - `excludePendingInquiries()` 의 `raw_payload` 거르기, `raw_payload->키` 고르기도 이 칸 권한이 있어야 한다 —
--      그래서 그런 조회는 모두 서버 키로 옮겼다.
--    - Realtime(postgres_changes)은 구독자마다 `has_column_privilege` 로 칸을 걸러 보낸다(walrus). 기본 키 `id` 는 남아
--      있어 구독이 401 로 끊기지 않는다. 지금 앱은 이 표를 postgres_changes 로 구독하지 않는다(private broadcast 사용).
--    **새 칸을 이 표에 더하면 authenticated 에 그 칸 select 를 따로 줘야 사용자 클라이언트에서 읽힌다**
--    (`grant select (새칸) on public.reservations to authenticated;`). 서버 키 경로는 영향 없다.
--    쓰기는 처음부터 service_role 만 한다(웹훅 · 동기화 · 수기 예약). 「platform admins can manage reservations」 정책은
--    남겨 두지만 authenticated 에 쓰기 권한이 없어 이제 쓰이지 않는다.
-- 2. notifications 만들기 — 일반 사용자 INSERT 정책 「org members can create notifications for org recipients」 를 없애고
--    INSERT 권한도 거둔다. 앱의 알림은 모두 서버 키로 만든다(`src/lib/notifications/create.ts` 의 `createNotification`,
--    체크인 호출은 `checkin.notify_staff` SECURITY DEFINER). 조직 구성원이 다른 직원에게 가짜 알림(아무 제목 · 링크)을
--    넣을 수 있던 길이 막힌다. 읽기 · 읽음 표시(`read_at` 칸만) · 지우기는 그대로다.
-- 3. 둘 다 쓰지 않는 권한(TRUNCATE · TRIGGER · REFERENCES)을 anon · authenticated 에서 거둔다. service_role 은 그대로.
--
-- 배포 순서: 코드 먼저(서버 키로 옮긴 조회 · 주문 알림) → 이 마이그레이션. 코드는 적용 전 · 후 둘 다 동작한다.
-- 다시 돌려도 같은 결과다(revoke · grant · drop policy if exists · comment 만 쓴다).
--
-- 되돌리기(1분 안에, 필요할 때만) — Dashboard SQL editor 에 그대로 붙인다.
-- 앱이 쓰는 권한만 원래대로 돌린다 — truncate · references · trigger 등 쓰지 않는 기본 권한은 다시 주지 않는다.
--   grant select on public.reservations to authenticated;
--   create policy "org members can create notifications for org recipients"
--   on public.notifications for insert with check (
--     (select auth.uid()) is not null
--     and organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
--     and exists (select 1 from public.memberships m
--                 where m.organization_id = notifications.organization_id
--                   and m.user_id = notifications.recipient_user_id and m.status = 'active')
--     and type::text not in ('checkin_staff_call', 'checkin_call_missed', 'checkin_staff_check')
--   );
--   grant insert on public.notifications to authenticated;
--
-- 확인(읽기 전용):
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('reservations', 'notifications')
--      and grantee in ('anon', 'authenticated') order by table_name, grantee, privilege_type;
--     → reservations: 없음 · notifications: authenticated 의 SELECT · DELETE 만
--   select table_name, column_name, privilege_type from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'reservations'
--      and grantee = 'authenticated' order by column_name;
--     → SELECT 13칸(raw_payload · last_known_amount 없음)
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('reservations', 'notifications') order by tablename, cmd;
--     → notifications 에 INSERT 정책 없음
--
-- lock_timeout 5초 — DROP POLICY · REVOKE 는 표에 AccessExclusiveLock 을 잡는다. 앞선 긴 트랜잭션 뒤에 줄 서서 그동안 알림 · 예약
-- 읽기까지 막지 않게, 잠금을 못 잡으면 실패한다. 실패하면 트랜잭션 전체가 취소돼 아무것도 바뀌지 않는다 — 나중에 다시 돌리면 된다.

begin;
set local lock_timeout = '5s';

-- ────────────────────────────────────────────────────────────
-- 1. reservations — 칸 단위 읽기 권한
-- ────────────────────────────────────────────────────────────
-- Supabase 기본 권한이 anon · authenticated 에 표 전체 권한을 줬을 수 있어 표 단위 권한을 모두 거둔다(칸 권한도 함께 지워진다).
revoke all on table public.reservations from anon;
revoke all on table public.reservations from authenticated;

grant select (
  id,
  organization_id,
  source,
  source_reservation_id,
  original_reservation_id,
  property_name,
  room_label,
  guest_name,
  check_in_date,
  check_out_date,
  status,
  created_at,
  updated_at
) on public.reservations to authenticated;

grant all on table public.reservations to service_role;

comment on column public.reservations.raw_payload is
  'Server-only Beds24 payload copy (guest contact, price, notes). Not readable by authenticated (column grant withheld, 2026-11-20) — app reads it with service_role filtered by organization_id.';
comment on column public.reservations.last_known_amount is
  'Last seen booking amount for automation change detection. Not readable by authenticated (column grant withheld, 2026-11-20).';

-- ────────────────────────────────────────────────────────────
-- 2. notifications — 만들기는 서버만
-- ────────────────────────────────────────────────────────────
drop policy if exists "org members can create notifications for org recipients" on public.notifications;

revoke insert, truncate, references, trigger on table public.notifications from authenticated;
revoke all on table public.notifications from anon;

-- 남기는 것: authenticated 의 SELECT(정책: 받는 사람 본인) · UPDATE(read_at 칸만) · DELETE(정책: 받는 사람 본인).
grant all on table public.notifications to service_role;

commit;
