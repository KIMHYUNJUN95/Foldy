-- 주문 처리 권한 키 `order_processor` 의 역할 기본값에서 field_manager 를 뺀다 (2026-10-20).
--
-- 문서 10번 「Status Change Permission」 · 앱 게이트 `canProcessOrders` · 트리거 `enforce_order_request_processing`(202610190006)
-- 은 이미 「현장 관리자는 주문 처리 불가」였고, 권한 레지스트리(`src/config/capabilities.ts`)와 이 사본만 field_manager 를 넣고 있었다
-- (사용자 화면에 「역할로 받음 · 켜짐」으로 잘못 보임). 레지스트리 생성 구간(202609100001)도 같이 고쳤다 — 그 파일은 이미 적용돼
-- 다시 돌지 않으므로 기존 DB 에서는 이 파일이 행을 지운다(202610060002 와 같은 방식). 개인 부여(`order_processor` 예외)는 그대로 통한다.

delete from public.capability_roles
where capability = 'order_processor'
  and role = 'field_manager'::public.organization_role;
