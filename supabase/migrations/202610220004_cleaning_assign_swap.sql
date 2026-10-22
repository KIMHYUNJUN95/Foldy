-- 청소 배정 — 담당 바꾸기(2026-10-22). docs/product/37-cleaning-shift-assignment.md 「담당 교체」
--
-- ① 권한 키 `cleaning.assign_swap` — 배정된 사람끼리 방 · 건물을 서로 바꾸기, 방 없는 신청자에게 넘기기.
--    역할 기본값 없음(`roles: []`) — 사용자 관리에서 사람마다 켜 준 사람만 쓴다. 배정 화면 자체는 `cleaning.assign` 이 있어야 열린다.
--    판정은 앱 서버(레지스트리 `src/config/capabilities.ts`) — 이 표는 DB 사본.
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('cleaning.assign_swap', true, false, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

-- ② 한 번에 옮기기 — 여러 방의 담당을 한 트랜잭션으로 바꾼다(서로 바꾸기 = 양쪽 방향 이동 묶음, 실행 취소 = 거꾸로 이동).
--    이동 하나 = { room_key, from_user_id, to_user_id }. 옮길 줄이 없거나(이미 누가 바꿈) 받는 사람이 이미 그 방에 있으면
--    'conflict' 로 전부 되돌린다 — 반만 바뀐 상태가 남지 않는다. 옮긴 줄은 「누가 · 언제」를 바꾼 사람 · 지금으로 고친다.
--    service-role 전용(권한 확인은 서버 액션 `reassignRooms`).
create or replace function public.cleaning_reassign_rooms(
  p_organization_id uuid,
  p_work_date date,
  p_moves jsonb,
  p_actor uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  move jsonb;
  moved integer := 0;
  changed integer;
begin
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) = 0 or jsonb_array_length(p_moves) > 80 then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  for move in select * from jsonb_array_elements(p_moves) loop
    if exists (
      select 1 from public.cleaning_assignments
      where organization_id = p_organization_id and work_date = p_work_date
        and room_key = move->>'room_key' and user_id = (move->>'to_user_id')::uuid
    ) then
      raise exception 'conflict' using errcode = 'P0001';
    end if;
    update public.cleaning_assignments
      set user_id = (move->>'to_user_id')::uuid, created_by = p_actor, created_at = now()
      where organization_id = p_organization_id and work_date = p_work_date
        and room_key = move->>'room_key' and user_id = (move->>'from_user_id')::uuid;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'conflict' using errcode = 'P0001';
    end if;
    moved := moved + 1;
  end loop;
  return moved;
end;
$$;

revoke all on function public.cleaning_reassign_rooms(uuid, date, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.cleaning_reassign_rooms(uuid, date, jsonb, uuid) to service_role;

comment on function public.cleaning_reassign_rooms(uuid, date, jsonb, uuid) is
  '청소 배정 담당 바꾸기 — 이동 묶음을 한 트랜잭션으로. 충돌이면 conflict 로 전부 되돌림. service-role 전용(권한은 앱 cleaning.assign + cleaning.assign_swap).';
