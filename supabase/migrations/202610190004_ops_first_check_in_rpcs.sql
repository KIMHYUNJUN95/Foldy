-- 첫 체크인 읽기 두 가지를 DB 한 번으로 (2026-10-19 속도).
--
-- 1) 판매 캘린더 「매출 요약」 전년 동기의 건물별 첫 손님(`readFirstStays`, src/lib/ops-sales-summary-server.ts)
--    전에는 건물마다 `reservations` 를 `property_name = ? and status <> 'cancelled' order by check_in_date limit 1` 로
--    따로 물었다(건물 11개 = 11번). `property_name` 이 앞에 오는 인덱스가 없어 예약이 없는 건물은 표 전체(1.7만 행 ·
--    3,904페이지, 258ms)를 훑었다 — 평균 667ms, 8초 시간 초과 14건. 아래 부분 인덱스 + 함수 하나로 건물마다
--    인덱스 한 칸만 읽는다.
--    - 보안: invoker — 부르는 사용자의 예약 RLS 가 그대로 걸린다(전과 같은 클라이언트로 부른다).
--
-- 2) 매출 비교 「객실 첫 판매일」(`getOpsRevenueCompareData`, src/lib/ops-revenue-server.ts)
--    전에는 집계 표(`ops_room_month_stats`)를 예약 기록 첫 달부터 약 48개월 `select *`(~3,200행) 받아 앱에서 최솟값을
--    구했다. 객실마다 최솟값만(~100행) 돌려준다.
--    - 보안: 집계 표는 RLS 정책이 없는 서버 전용 표다 — service_role 만 실행할 수 있다.
--
-- 앱은 이 함수가 아직 없으면(적용 전) 예전 방식으로 읽는다 — 적용 순서와 상관없이 숫자는 같다.

create index if not exists reservations_org_property_checkin_live_idx
  on public.reservations (organization_id, property_name, check_in_date)
  where status <> 'cancelled';

create or replace function public.reservation_first_check_ins(
  p_organization_id uuid,
  p_property_names text[]
)
returns table (property_name text, first_check_in date)
language sql
stable
security invoker
set search_path = ''
as $$
  select names.name,
    (
      select min(r.check_in_date)
      from public.reservations r
      where r.organization_id = p_organization_id
        and r.property_name = names.name
        and r.status <> 'cancelled'
    )
  from unnest(p_property_names) as names(name)
$$;

revoke all on function public.reservation_first_check_ins(uuid, text[]) from public, anon;
grant execute on function public.reservation_first_check_ins(uuid, text[]) to authenticated, service_role;

create or replace function public.ops_room_first_check_ins(
  p_organization_id uuid,
  p_from_month date,
  p_to_month_exclusive date
)
returns table (room_key text, first_check_in date)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.room_key, min(s.first_check_in)
  from public.ops_room_month_stats s
  where s.organization_id = p_organization_id
    and s.month >= p_from_month
    and s.month < p_to_month_exclusive
    and s.first_check_in is not null
  group by s.room_key
$$;

revoke all on function public.ops_room_first_check_ins(uuid, date, date) from public, anon, authenticated;
grant execute on function public.ops_room_first_check_ins(uuid, date, date) to service_role;
