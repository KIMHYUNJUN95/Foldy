-- =====================================================================================
-- 03-verify.sql — 02 적용(commit) 뒤 확인. 읽기 전용. 블록을 하나씩 선택해서 실행.
-- =====================================================================================

-- [블록 1] 마스터 · 객실 · Airbnb 링크 — 205165 = Okubo_B, 294552 = Okubo_A 이고, 링크가 같은 room_id 에 그대로 붙어 있어야 한다
--   (Airbnb 952403875937085488 → 205165 의 객실, 1517052329343209381 → 294552 의 객실)
select p.external_property_id, p.name, p.display_name_ko, p.display_name_ja, p.display_name_en, p.updated_at,
       r.external_room_id, r.room_label, r.name as room_name,
       (select string_agg(l.channel || ' ' || coalesce(l.listing_id, '-'), ', ') from public.room_listing_links l where l.room_id = r.id) as listing_links
from public.properties p
left join public.rooms r on r.property_id = p.id
where p.organization_id = 'f393a735-eb57-4f95-8b82-361ba46b81a5'
  and p.external_property_id in ('205165', '294552', '211056')
order by p.external_property_id, r.room_label;


-- [블록 2] 값별 건수 — f393 에 `Okubo_A (B棟)` · `Okubo_B (A棟)` 가 하나도 없어야 하고(객실 라벨 칸 제외), 다른 조직은 02 전과 같아야 한다
-- 값별 건수. scope = 'target'(f393) / 'other'(다른 조직 — 바뀌면 안 됨). 칸 · 표가 없으면 건너뛴다.
create or replace function pg_temp.okubo_scan()
returns table (scope text, src text, v text, n bigint)
language plpgsql as $f$
declare
  it record;
  real_col text;
begin
  for it in
    select * from (values
      ('public.properties', 'name', 'name', false),
      ('public.properties', 'display_names', '(coalesce(display_name_ko,'''') || '' '' || coalesce(display_name_ja,'''') || '' '' || coalesce(display_name_en,''''))', true),
      ('public.rooms', 'room_label', 'room_label', false),
      ('public.rooms', 'name', 'name', false),
      ('public.reservations', 'property_name', 'property_name', false),
      ('public.reservations', 'room_label', 'room_label', false),
      ('public.room_blocks', 'property_name', 'property_name', false),
      ('public.room_blocks', 'room_label', 'room_label', false),
      ('public.beds24_block_logs', 'property_name', 'property_name', false),
      ('public.price_change_logs', 'room_label', 'room_label', false),
      ('public.cleaning_sessions', 'room_label', 'room_label', false),
      ('public.cleaning_sessions', 'room_key', 'room_key', false),
      ('public.cleaning_assignments', 'property_name', 'property_name', false),
      ('public.cleaning_assignments', 'room_label', 'room_label', false),
      ('public.cleaning_assignments', 'room_key', 'room_key', false),
      ('public.cleaning_room_holds', 'property_name', 'property_name', false),
      ('public.cleaning_room_holds', 'room_key', 'room_key', false),
      ('public.cleaning_list_extra_rooms', 'property_name', 'property_name', false),
      ('public.cleaning_list_extra_rooms', 'room_key', 'room_key', false),
      ('public.cleaning_list_assignees', 'room_key', 'room_key', false),
      ('public.maintenance_reports', 'property_name', 'property_name', false),
      ('public.maintenance_reports', 'room_label', 'room_label', false),
      ('public.lost_items', 'property_name', 'property_name', false),
      ('public.lost_items', 'room_label', 'room_label', false),
      ('public.order_requests', 'building_name', 'building_name', false),
      ('public.order_requests', 'room_label', 'room_label', false),
      ('public.linen_return_records', 'building_name', 'building_name', false),
      ('public.linen_items', 'building_name', 'building_name', false),
      ('public.staff_suggestions', 'property_name', 'property_name', false),
      ('public.staff_suggestions', 'room_label', 'room_label', false),
      ('public.customer_complaints', 'property_name', 'property_name', false),
      ('public.customer_complaints', 'room_label', 'room_label', false),
      ('public.external_reviews', 'property_name', 'property_name', false),
      ('public.external_reviews', 'room_label', 'room_label', false),
      ('public.transport_reimbursement_items', 'work_context', 'work_context::text', true),
      ('public.cleaning_fixed_staff', 'property_name', 'property_name', false),
      ('public.cleaning_room_settings', 'room_key', 'room_key', false),
      ('public.cleaning_staff_profiles', 'main_properties', 'main_properties::text', true),
      ('public.automation_jobs', 'settings', 'settings::text', true),
      ('public.building_listing_links', 'canonical_name', 'canonical_name', false),
      ('public.room_link_rooms', 'canonical_name', 'canonical_name', false),
      ('public.property_operation_infos', 'canonical_name', 'canonical_name', false),
      ('public.property_operation_infos', 'access_texts', '(shared_access::text || '' '' || room_access::text || '' '' || coalesce(address_ko,'''') || '' '' || coalesce(address_ja,'''') || '' '' || coalesce(address_en,'''') || '' '' || note)', true),
      ('public.room_link_buildings', 'name', 'name', false),
      ('checkin.stays', 'property_key', 'property_key', false),
      ('checkin.staff_calls', 'property_key', 'property_key', false),
      ('checkin.property_settings', 'property_key', 'property_key', false),
      ('checkin.devices', 'property_key', 'property_key', false),
      ('checkin.enrollment_codes', 'property_key', 'property_key', false)
    ) as t(tbl, col, expr, is_container)
  loop
    continue when to_regclass(it.tbl) is null;
    real_col := case it.col when 'display_names' then 'display_name_ko' when 'access_texts' then 'shared_access' else it.col end;
    continue when not exists (
      select 1 from information_schema.columns
      where table_schema = split_part(it.tbl, '.', 1) and table_name = split_part(it.tbl, '.', 2) and column_name = real_col);
    return query execute format(
      $q$select s.scope, s.src, s.v, count(*)::bigint
         from (
           select case when organization_id = 'f393a735-eb57-4f95-8b82-361ba46b81a5'::uuid then 'target' else 'other' end as scope,
                  %L::text as src,
                  case when %L::boolean
                       then 'contains:' || coalesce((select string_agg(distinct m[1], ',' order by m[1])
                                                     from regexp_matches(%s, '(오쿠보 ?[AB]|大久保 ?[AB]|okubo_[ab]|Okubo_[AB](?: \([AB]棟\))?)', 'g') as m), '?')
                       else (%s)::text end as v
           from %s where (%s)::text ~* '(오쿠보|okubo|大久保)'
         ) s
         group by 1, 2, 3$q$,
      it.tbl || '.' || it.col, it.is_container, it.expr, it.expr, it.tbl, it.expr);
  end loop;
end
$f$;

select * from pg_temp.okubo_scan() order by scope desc, src, v;


-- [블록 3] 남은 옛 원문 · 두 단계 표시 — 결과 0줄이어야 한다(객실 라벨 칸은 일부러 안 바꿨으니 제외)
select 'reservations' as tbl, count(*) as n from public.reservations
 where organization_id = 'f393a735-eb57-4f95-8b82-361ba46b81a5' and property_name in ('Okubo_A (B棟)', 'Okubo_B (A棟)')
having count(*) > 0
union all
select 'room_blocks', count(*) from public.room_blocks
 where organization_id = 'f393a735-eb57-4f95-8b82-361ba46b81a5' and property_name in ('Okubo_A (B棟)', 'Okubo_B (A棟)')
having count(*) > 0
union all
select 'properties(표시 남음)', count(*) from public.properties where left(name, 1) = chr(1)
having count(*) > 0
union all
select 'cleaning_sessions(표시 남음)', count(*) from public.cleaning_sessions
 where left(room_label, 1) = chr(1) or left(coalesce(room_key, ''), 1) = chr(1)
having count(*) > 0;


-- [블록 4] 실제 집 ↔ 이름 — 예약을 Beds24 집 id 별로. 205165 는 Okubo_B 만, 294552 는 Okubo_A 만 보여야 한다
select coalesce(raw_payload->>'propertyId', raw_payload->>'propId', '(없음)') as beds24_property_id,
       property_name, count(*) as n, max(updated_at) as last_updated
from public.reservations
where organization_id = 'f393a735-eb57-4f95-8b82-361ba46b81a5' and property_name ~* '(오쿠보|okubo|大久保)'
group by 1, 2 order by 1, 2;


-- [블록 5] 집계 다시 계산 — 몇 분 뒤 dirty 가 0 으로 내려가야 한다
select count(*) filter (where dirty) as dirty_months, count(*) as months, max(dirty_at) as last_marked
from public.ops_stats_months where organization_id = 'f393a735-eb57-4f95-8b82-361ba46b81a5';
