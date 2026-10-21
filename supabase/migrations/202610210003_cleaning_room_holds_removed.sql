-- 청소 배정 — 미루기 · 처리 끝 때 뺀 배정 기억 (2026-10-21)
--
-- 도메인 계약: docs/product/37-cleaning-shift-assignment.md 「미루기 · 처리 끝 되돌리기」
--
-- 미루거나 처리 끝으로 두면 그날 그 방 배정을 뺀다. 뺀 사람을 여기 남겨 두면 방 줄의 「되돌리기」(5초 실행 취소가 지난 뒤)도
-- 사람까지 다시 넣을 수 있다. 표는 그대로 service-role 전용(RLS 켜고 정책 없음).

alter table public.cleaning_room_holds
  add column if not exists removed_user_ids uuid[] not null default '{}';

comment on column public.cleaning_room_holds.removed_user_ids is
  '미루기 · 처리 끝 때 그날 배정에서 뺀 사람 — 되돌리기가 다시 넣는다.';
