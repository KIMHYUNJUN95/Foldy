-- 예약 내부 메모 쓰기 권한 = 관리자 웹 권한 키(`admin_web.access`) (2026-11-12 예약 캘린더 점검 · 사용자 결정).
--
-- 문서: docs/engineering/05-rls-permissions.md 「예약 내부 메모 — 쓰기 권한(2026-11-12)」, docs/planning/01-decision-log.md
--
-- 앱은 관리자 웹에 들어올 수 있는 사람(`admin_web.access`, 역할 기본 + 개인 부여 · 차단)에게 메모 칸을 보여 주는데,
-- DB 규칙은 202607090003 의 역할 목록(owner · office_admin · cs_staff · field_manager)이었다. 그래서 권한을 개인으로 받은
-- 사람(예: 전무 · 개인 부여)은 칸이 보이는데 저장이 DB 에서 막혔고, 개인 차단된 사람은 직접 요청으로 쓸 수 있었다.
-- 읽기 규칙(「active members can read reservation internal notes」, 202607100001 — 활성 멤버 전원, 모바일 상세가 읽는다)은 그대로.
--
-- 두 번 돌려도 같은 결과(drop policy if exists → create). 앱의 조건부 저장(updated_at 일치)은 이 규칙과 별개다.

begin;

drop policy if exists "admin members can insert reservation internal notes" on public.reservation_internal_notes;
drop policy if exists "admin members can update reservation internal notes" on public.reservation_internal_notes;
drop policy if exists "admin members can delete reservation internal notes" on public.reservation_internal_notes;

create policy "admin members can insert reservation internal notes"
on public.reservation_internal_notes
for insert
with check (
  ((select auth.uid()) is not null)
  and updated_by_user_id = (select auth.uid())
  and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'admin_web.access'))
);

create policy "admin members can update reservation internal notes"
on public.reservation_internal_notes
for update
using (
  ((select auth.uid()) is not null)
  and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'admin_web.access'))
)
with check (
  ((select auth.uid()) is not null)
  and updated_by_user_id = (select auth.uid())
  and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'admin_web.access'))
);

create policy "admin members can delete reservation internal notes"
on public.reservation_internal_notes
for delete
using (
  ((select auth.uid()) is not null)
  and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'admin_web.access'))
);

commit;
