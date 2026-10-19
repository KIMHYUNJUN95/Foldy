-- 주문 처리 칸은 사무실 쪽만 바꾼다 (2026-10-19).
--
-- 문서: docs/product/10-order-request-workflow.md → "Status Change Permission", docs/engineering/05-rls-permissions.md
--
-- UPDATE 정책 「reporter or manager can update order requests」 는 행 단위라 **요청자 본인**과 **field_manager** 에게도
-- 모든 칸을 열어 둔다. 그래서 요청자가 앱을 거치지 않고 DB 에 직접 PATCH 하면 자기 주문을 `ordered` 로 바꾸거나
-- 배송일 · 관리자 메모를 쓸 수 있었다(문서상 처리는 owner · office_admin · cs_staff · 개발자 · `order_processor` 예외만).
-- 앱 게이트(`canProcessOrders`, src/lib/order-permissions.ts)와 같은 조건을 DB 에서도 건다.
--
-- - 처리 칸: status · delivery_date · delivery_start_date · delivery_end_date · admin_memo.
-- - 행의 소속(organization_id · reported_by_user_id)은 아무도 바꾸지 못한다.
-- - service_role(auth.uid() 가 없는 서버 경로)은 통과 — 서버 코드는 자체 게이트를 거친다.
-- - 요청자 · field_manager 의 다른 칸 수정과 삭제 정책은 그대로 둔다(동작 변경 최소화).

create or replace function public.enforce_order_request_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.reported_by_user_id is distinct from old.reported_by_user_id then
    raise exception 'order request ownership cannot change' using errcode = '42501';
  end if;

  if (new.status is distinct from old.status
      or new.delivery_date is distinct from old.delivery_date
      or new.delivery_start_date is distinct from old.delivery_start_date
      or new.delivery_end_date is distinct from old.delivery_end_date
      or new.admin_memo is distinct from old.admin_memo)
     and not (
       (select public.is_platform_admin())
       or public.has_org_role(
         old.organization_id,
         array['owner', 'office_admin', 'cs_staff']::public.organization_role[]
       )
       or public.has_permission_override(old.organization_id, (select auth.uid()), 'order_processor')
     ) then
    raise exception 'order request processing is office-level only' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_order_request_processing() from public, anon, authenticated;

drop trigger if exists order_requests_processing_guard on public.order_requests;
create trigger order_requests_processing_guard
  before update on public.order_requests
  for each row
  execute function public.enforce_order_request_processing();
