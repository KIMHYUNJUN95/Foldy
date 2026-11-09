-- =====================================================================================
-- 01-inspect.sql — 오쿠보A ↔ 오쿠보B 이름 맞바꿈 전 확인 (읽기 전용)
--
-- Supabase SQL Editor 에서 [블록 1] ~ [블록 7] 을 **하나씩** 선택해서 실행한다(에디터는 마지막 결과만 보여 준다).
-- 블록마다 pg_temp 함수를 다시 만든다 — 세션 임시 함수라 데이터 · 스키마에는 아무것도 남지 않는다.
-- 데이터는 SELECT 만 한다.
-- =====================================================================================


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 1] 건물 마스터 — properties · rooms (Beds24 id 가 「실제 집」의 정체성이다)
--   볼 것: 두 행의 name 이 **지금 Beds24 의 새 이름**인가?  (이름이 아직 옛 이름이면 README 「먼저 확인」)
--          external_property_id · rooms.external_room_id 를 적어 둔다 — 02 의 이름표(okubo_name_map)에 쓴다.
-- ─────────────────────────────────────────────────────────────────────────────────────
select p.organization_id, p.id, p.external_provider, p.external_property_id, p.name,
       p.display_name_ko, p.display_name_ja, p.display_name_en, p.status, p.created_at, p.updated_at,
       (select jsonb_agg(jsonb_build_object('id', r.id, 'external_room_id', r.external_room_id, 'room_label', r.room_label,
                                            'name', r.name, 'status', r.status, 'updated_at', r.updated_at) order by r.room_label)
          from public.rooms r where r.property_id = p.id) as rooms
from public.properties p
where p.name ~* '(오쿠보|okubo|大久保)'
   or exists (select 1 from public.rooms r where r.property_id = p.id and r.room_label ~* '(오쿠보|okubo|大久保)')
order by p.name;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 2] 표마다 · 저장된 값마다 건수와 처음 · 마지막 시각
--   볼 것: 각 표에서 새 이름이 처음 나타난 시각(first_at) → 이름이 바뀐 순간(rename_at) 후보.
--          contains:… 줄은 jsonb · 배열 안에 들어 있는 이름(자동화 설정 · 메인 건물 · 교통비 근무 내용 등).
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.okubo_letter(t text) returns text
language sql immutable as $f$
  -- room-label-normalization.ts 의 isOkuboA / isOkuboB 와 같은 판정(공백 · _ · ( ) · - 지우고 소문자, A 먼저)
  select case
    when t is null then null
    when lower(regexp_replace(t, '[[:space:]_()-]', '', 'g')) ~ '(오쿠보a|okuboa|大久保a)' then 'A'
    when lower(regexp_replace(t, '[[:space:]_()-]', '', 'g')) ~ '(오쿠보b|okubob|大久保b)' then 'B'
  end
$f$;

create or replace function pg_temp.okubo_scan()
returns table (src text, v text, n bigint, first_at timestamptz, last_at timestamptz)
language plpgsql as $f$
declare
  it record;
  ts text;
begin
  for it in
    select * from (values
      ('public.properties', 'name', 'name', 'updated_at'),
      ('public.rooms', 'room_label', 'room_label', 'updated_at'),
      ('public.reservations', 'property_name', 'property_name', 'created_at'),
      ('public.reservations', 'room_label', 'room_label', 'created_at'),
      ('public.room_blocks', 'property_name', 'property_name', 'created_at'),
      ('public.room_blocks', 'room_label', 'room_label', 'created_at'),
      ('public.beds24_block_logs', 'property_name', 'property_name', 'created_at'),
      ('public.beds24_block_logs', 'room_label', 'room_label', 'created_at'),
      ('public.price_change_logs', 'room_label', 'room_label', 'created_at'),
      ('public.cleaning_sessions', 'room_label', 'room_label', 'created_at'),
      ('public.cleaning_sessions', 'room_key', 'room_key', 'created_at'),
      ('public.cleaning_assignments', 'property_name', 'property_name', 'created_at'),
      ('public.cleaning_assignments', 'room_label', 'room_label', 'created_at'),
      ('public.cleaning_assignments', 'room_key', 'room_key', 'created_at'),
      ('public.cleaning_room_holds', 'property_name', 'property_name', 'created_at'),
      ('public.cleaning_room_holds', 'room_label', 'room_label', 'created_at'),
      ('public.cleaning_room_holds', 'room_key', 'room_key', 'created_at'),
      ('public.cleaning_list_extra_rooms', 'property_name', 'property_name', 'created_at'),
      ('public.cleaning_list_extra_rooms', 'room_label', 'room_label', 'created_at'),
      ('public.cleaning_list_extra_rooms', 'room_key', 'room_key', 'created_at'),
      ('public.cleaning_list_assignees', 'room_key', 'room_key', 'updated_at'),
      ('public.maintenance_reports', 'property_name', 'property_name', 'created_at'),
      ('public.maintenance_reports', 'room_label', 'room_label', 'created_at'),
      ('public.lost_items', 'property_name', 'property_name', 'created_at'),
      ('public.lost_items', 'room_label', 'room_label', 'created_at'),
      ('public.order_requests', 'building_name', 'building_name', 'created_at'),
      ('public.order_requests', 'room_label', 'room_label', 'created_at'),
      ('public.linen_return_records', 'building_name', 'building_name', 'created_at'),
      ('public.staff_suggestions', 'property_name', 'property_name', 'created_at'),
      ('public.staff_suggestions', 'room_label', 'room_label', 'created_at'),
      ('public.customer_complaints', 'property_name', 'property_name', 'created_at'),
      ('public.customer_complaints', 'room_label', 'room_label', 'created_at'),
      ('public.external_reviews', 'property_name', 'property_name', 'created_at'),
      ('public.external_reviews', 'room_label', 'room_label', 'created_at'),
      ('public.transport_reimbursement_items', 'work_context', 'work_context::text', 'created_at'),
      ('public.ops_room_month_stats', 'property_name', 'property_name', null),
      ('public.ops_room_month_stats', 'room_key', 'room_key', null),
      ('checkin.stays', 'property_key', 'property_key', 'created_at'),
      ('checkin.stay_rooms', 'room_label', 'room_label', null),
      ('checkin.staff_calls', 'property_key', 'property_key', 'created_at'),
      ('public.cleaning_fixed_staff', 'property_name', 'property_name', null),
      ('public.cleaning_room_settings', 'room_key', 'room_key', 'updated_at'),
      ('public.cleaning_staff_profiles', 'main_properties', 'main_properties::text', 'updated_at'),
      ('public.automation_jobs', 'settings', 'settings::text', 'updated_at'),
      ('public.building_listing_links', 'canonical_name', 'canonical_name', 'updated_at'),
      ('public.room_link_rooms', 'canonical_name', 'canonical_name', 'updated_at'),
      ('public.room_link_buildings', 'name', 'name', 'updated_at'),
      ('public.linen_items', 'building_name', 'building_name', 'updated_at'),
      ('checkin.property_settings', 'property_key', 'property_key', 'updated_at'),
      ('checkin.property_settings', 'texts', '(welcome_text::text || '' '' || terms_text::text || '' '' || support_contacts::text)', 'updated_at'),
      ('checkin.devices', 'property_key', 'property_key', 'registered_at'),
      ('checkin.enrollment_codes', 'property_key', 'property_key', 'created_at')
    ) as t(tbl, col, expr, tscol)
  loop
    -- 운영에 아직 없는 표 · 칸은 건너뛴다
    continue when to_regclass(it.tbl) is null;
    continue when it.col <> 'texts' and not exists (
      select 1 from information_schema.columns
      where table_schema = split_part(it.tbl, '.', 1) and table_name = split_part(it.tbl, '.', 2) and column_name = it.col);
    ts := case when it.tscol is not null and exists (
      select 1 from information_schema.columns
      where table_schema = split_part(it.tbl, '.', 1) and table_name = split_part(it.tbl, '.', 2) and column_name = it.tscol)
      then it.tscol else 'null::timestamptz' end;
    return query execute format(
      $q$select %L::text,
                case when %L in ('work_context','main_properties','settings','texts')
                     then 'contains:' || coalesce((select string_agg(distinct m[1], ',') from regexp_matches(%s, '(오쿠보 ?[AB]|大久保 ?[AB]|okubo_[ab]|Okubo_[AB][^",}]*)', 'g') as m), '?')
                     else (%s)::text end,
                count(*)::bigint, min(%s)::timestamptz, max(%s)::timestamptz
         from %s where (%s)::text ~* '(오쿠보|okubo|大久保)' group by 2$q$,
      it.tbl || '.' || it.col, it.col, it.expr, it.expr, ts, ts, it.tbl, it.expr);
  end loop;
end
$f$;

select * from pg_temp.okubo_scan() order by src, v;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 3] 예약 — 실제 집(Beds24 propertyId)별로 저장된 property_name
--   한 propertyId 에 옛 이름 · 새 이름이 섞여 있으면 정상(옛 예약은 옛 이름).
--   새 이름 줄의 min(updated_at) ≈ Foldy 가 새 이름을 쓰기 시작한 순간.
--   matches_master = false 인 줄이 02 에서 바뀔 예약이다.
-- ─────────────────────────────────────────────────────────────────────────────────────
select coalesce(r.raw_payload->>'propertyId', r.raw_payload->>'propId', r.raw_payload->>'property_id',
                r.raw_payload#>>'{booking,propertyId}', '(없음)') as beds24_property_id,
       p.name as master_name_now,
       r.property_name, r.source,
       r.property_name = p.name as matches_master,
       count(*) as n,
       min(r.created_at) as first_created, max(r.created_at) as last_created,
       min(r.updated_at) as first_updated, max(r.updated_at) as last_updated,
       min(r.check_in_date) as first_check_in, max(r.check_in_date) as last_check_in
from public.reservations r
left join public.properties p
  on p.organization_id = r.organization_id and p.external_provider = 'beds24'
 and p.external_property_id = coalesce(r.raw_payload->>'propertyId', r.raw_payload->>'propId',
                                       r.raw_payload->>'property_id', r.raw_payload#>>'{booking,propertyId}')
where r.property_name ~* '(오쿠보|okubo|大久保)'
group by 1, 2, 3, 4, 5
order by 1, 3, 4;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 4] 날짜별 대조 — 청소 세션 · 배정의 라벨 vs 그날 체크아웃한 실제 집(최근 90일, 도쿄 날짜)
--   어느 날부터 「같은 propertyId 인데 라벨이 바뀌었는지」가 보이면 그날이 rename_at 경계다.
-- ─────────────────────────────────────────────────────────────────────────────────────
with since as (select (now() at time zone 'Asia/Tokyo')::date - 90 as d),
s as (
  select cleaning_date as d, 'session' as kind, room_label as label, count(*) as n, min(created_at) as first_created
  from public.cleaning_sessions, since
  where room_label ~* '(오쿠보|大久保|okubo)' and cleaning_date >= since.d
  group by 1, 2, 3
  union all
  select work_date, 'assignment', property_name, count(*), min(created_at)
  from public.cleaning_assignments, since
  where property_name ~* '(오쿠보|大久保|okubo)' and work_date >= since.d
  group by 1, 2, 3
),
c as (
  select r.check_out_date as d,
         string_agg(distinct coalesce(r.raw_payload->>'propertyId', r.raw_payload->>'propId', '?') || ' = ' || r.property_name, ' | ') as checkouts
  from public.reservations r, since
  where r.status::text <> 'cancelled' and r.property_name ~* '(오쿠보|大久保|okubo)' and r.check_out_date >= since.d
  group by 1
)
select coalesce(s.d, c.d) as day, s.kind, s.label, s.n, s.first_created, c.checkouts
from s full join c on c.d = s.d
order by 1 desc, 2, 3;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 5] 실제 집 id 로 판단할 수 있는 표 — 지금 이름이 집과 어긋난 행 수(= 02 에서 바뀔 수)
--   fk_missing 은 집 id 가 없어 rename_at 기준으로 판단할 행.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.okubo_letter(t text) returns text
language sql immutable as $f$
  -- room-label-normalization.ts 의 isOkuboA / isOkuboB 와 같은 판정(공백 · _ · ( ) · - 지우고 소문자, A 먼저)
  select case
    when t is null then null
    when lower(regexp_replace(t, '[[:space:]_()-]', '', 'g')) ~ '(오쿠보a|okuboa|大久保a)' then 'A'
    when lower(regexp_replace(t, '[[:space:]_()-]', '', 'g')) ~ '(오쿠보b|okubob|大久保b)' then 'B'
  end
$f$;

with p as (
  select id, organization_id, external_property_id, pg_temp.okubo_letter(name) as l
  from public.properties where pg_temp.okubo_letter(name) in ('A', 'B')
)
select 'staff_suggestions' as tbl,
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) <> p.l) as mismatched,
       count(*) filter (where t.property_id is null) as fk_missing, count(*) as okubo_rows
from public.staff_suggestions t left join p on p.id = t.property_id
where pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) in ('A', 'B')
union all
select 'customer_complaints',
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) <> p.l),
       count(*) filter (where t.property_id is null), count(*)
from public.customer_complaints t left join p on p.id = t.property_id
where pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) in ('A', 'B')
union all
select 'external_reviews',
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) <> p.l),
       count(*) filter (where t.property_id is null), count(*)
from public.external_reviews t left join p on p.id = t.property_id
where pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) in ('A', 'B')
union all
select 'room_blocks',
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(t.property_name) <> p.l),
       count(*) filter (where p.l is null), count(*)
from public.room_blocks t
left join public.rooms ro on ro.organization_id = t.organization_id and ro.external_room_id = t.external_room_id
left join p on p.id = ro.property_id
where pg_temp.okubo_letter(t.property_name) in ('A', 'B')
union all
select 'price_change_logs',
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(t.room_label) <> p.l),
       count(*) filter (where p.l is null), count(*)
from public.price_change_logs t
left join public.rooms ro on ro.id = t.room_id
left join p on p.id = ro.property_id
where pg_temp.okubo_letter(t.room_label) in ('A', 'B')
union all
select 'beds24_block_logs',
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) <> p.l),
       count(*) filter (where p.l is null), count(*)
from public.beds24_block_logs t
left join public.rooms ro on ro.organization_id = t.organization_id and ro.external_room_id = t.external_room_ids[1]
left join p on p.id = ro.property_id
where pg_temp.okubo_letter(coalesce(t.property_name, t.room_label)) in ('A', 'B')
union all
select 'transport_reimbursement_items',
       count(*) filter (where p.l is not null and pg_temp.okubo_letter(t.work_context::text) <> p.l),
       count(*) filter (where p.l is null), count(*)
from public.transport_reimbursement_items t left join p on p.id = t.property_id
where pg_temp.okubo_letter(t.work_context::text) in ('A', 'B')
union all
select 'checkin.stays (예약으로 판단)',
       count(*) filter (where exists (
         select 1 from checkin.stay_rooms sr join public.reservations r on r.id = sr.reservation_id
         join p on p.organization_id = r.organization_id
              and p.external_property_id = coalesce(r.raw_payload->>'propertyId', r.raw_payload->>'propId')
         where sr.stay_id = s.id and p.l <> pg_temp.okubo_letter(s.property_key))),
       null, count(*)
from checkin.stays s
where pg_temp.okubo_letter(s.property_key) in ('A', 'B');


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 6] 설정 — 건물 이름으로 묶인 설정 원문(시간 구분 없이 02 에서 한 번 전부 맞바꾼다)
--   각 줄의 updated_at 이 rename 뒤라면 이미 누가 새 이름으로 다시 넣은 것일 수 있다 → 02 의 해당 줄을 빼야 한다.
-- ─────────────────────────────────────────────────────────────────────────────────────
select 'automation_jobs.settings' as what, job_key as k, settings::text as value, updated_at
from public.automation_jobs where settings::text ~* '(오쿠보|okubo|大久保)'
union all
select 'cleaning_staff_profiles.main_properties', user_id::text || ' / owner ' || owner_id::text, main_properties::text, updated_at
from public.cleaning_staff_profiles where main_properties::text ~* '(오쿠보|okubo|大久保)'
union all
select 'cleaning_fixed_staff', owner_id::text || ' / ' || user_id::text || ' tier ' || tier, property_name, null
from public.cleaning_fixed_staff where property_name ~* '(오쿠보|okubo|大久保)'
union all
select 'cleaning_room_settings', room_key, usual_headcount::text, updated_at
from public.cleaning_room_settings where room_key ~* '(오쿠보|okubo|大久保)'
union all
select 'building_listing_links', canonical_name || ' ' || channel, coalesce(listing_id, '') || ' ' || coalesce(guest_url, ''), updated_at
from public.building_listing_links where canonical_name ~* '(오쿠보|okubo|大久保)'
union all
select 'room_link_rooms', canonical_name, name, updated_at
from public.room_link_rooms where canonical_name ~* '(오쿠보|okubo|大久保)'
union all
select 'linen_items', building_name, name, updated_at
from public.linen_items where building_name ~* '(오쿠보|okubo|大久保)'
union all
select 'checkin.property_settings', property_key, verification_method::text, updated_at
from checkin.property_settings where property_key ~* 'okubo'
union all
select 'checkin.devices', property_key, name || case when revoked_at is null then '' else ' (해지됨)' end, registered_at
from checkin.devices where property_key ~* 'okubo'
order by 1, 2;


-- ─────────────────────────────────────────────────────────────────────────────────────
-- [블록 7] (선택) 놓친 곳 찾기 — public · checkin 의 모든 text / varchar / jsonb / 배열 칸에서 오쿠보 A/B 를 찾는다
--   블록 2 · 6 에 없는 표가 나오면 알려 줄 것(알림 본문 · 감사 로그 · raw_payload 같은 「그때의 기록」은 일부러 안 바꾼다).
--   큰 표를 전부 훑으므로 몇 초 ~ 수십 초 걸릴 수 있다.
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.okubo_find_all()
returns table (tbl text, col text, n bigint)
language plpgsql as $f$
declare c record;
begin
  for c in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema in ('public', 'checkin')
      and (data_type in ('text', 'character varying', 'jsonb', 'json') or data_type = 'ARRAY')
      and table_name in (select table_name from information_schema.tables t
                         where t.table_schema = columns.table_schema and t.table_type = 'BASE TABLE')
  loop
    return query execute format(
      'select %L::text, %L::text, count(*)::bigint from %I.%I where %I::text ~ %L having count(*) > 0',
      c.table_schema || '.' || c.table_name, c.column_name, c.table_schema, c.table_name, c.column_name,
      '(오쿠보 ?[AB]|大久保 ?[AB]|[Oo]kubo_?[AB]|okubo_[ab])');
  end loop;
end
$f$;

select * from pg_temp.okubo_find_all() order by 1, 2;
