-- =====================================================================================
-- 02-swap.sql — 오쿠보A ↔ 오쿠보B 이름 맞바꾸기 (트랜잭션 하나, 조직 f393a735 만)
--
-- 사실(2026-11-09 운영 확인):
--   · Beds24 가 이름을 바꿨다: 205165 `Okubo_A (B棟)` → `Okubo_B`, 294552 `Okubo_B (A棟)` → `Okubo_A`.
--   · Foldy 마스터(properties)는 아직 옛 이름이다 — 웹훅에 propName 이 없어 마스터 이름을 그대로 쓰므로,
--     **지금 있는 기록은 전부 옛 이름**이다. 그래서 시각 구분 없이 전부 바꾸고, 마스터 이름도 같은 트랜잭션에서 바꾼다.
--   · 다른 조직(cfa0239d… 데모)은 건드리지 않는다 — 모든 UPDATE 에 organization_id 조건, 끝에서 「다른 조직 그대로」 검사.
--
-- ★ 기본은 「연습 실행」: 끝에서 일부러 오류를 내 전부 되돌리고, 오류 메시지에 바뀐 행 수 · 값별 전 → 후를 보여 준다.
--   결과가 맞으면 아래 apply 를 true 로 바꿔 **한 번만** 실행한다(두 번 돌리면 다시 맞바뀐다 — 맨 앞 검사가 막는다).
--
-- 바꾸는 것: 건물 이름 칸(property_name · building_name · canonical_name · property_key), 건물에서 만든 키 · 라벨
--   (청소 room_key · 청소 세션식 room_label 「오쿠보A」), 설정 jsonb · 배열 안의 이름.
-- 바꾸지 않는 것(이유):
--   · Beds24 원본 객실 라벨 — rooms.room_label/name, reservations.room_label, room_blocks.room_label,
--     beds24_block_logs.room_label, price_change_logs.room_label, checkin.stay_rooms.room_label, 리뷰 · 불만 · 제안의 room_label.
--     객실 이름의 주인은 Beds24 동기화이고, 예약 키(source_reservation_id = `<번호>::room::<객실 라벨>`)에 들어 있어서
--     여기서 바꾸면 다음 웹훅이 **같은 예약을 새 행으로 또 만든다.** 오쿠보는 객실을 건물 이름으로 읽으므로 화면엔 영향 없다.
--   · room_listing_links(Airbnb 링크) — room_id 로 묶여 있어 실제 집을 그대로 따라간다(03 에서 확인).
--   · ops_room_month_stats — 다시 계산 표시만([6]).
--   · raw_payload · 알림 · 감사 로그 · 변경 로그(그때의 기록).
--
-- 이름 칸은 두 단계로 바꾼다(① chr(1) 표시 + 새 값 → ② 표시 떼기) — 맞바꿈이 유니크 · 기본 키에 걸리지 않게.
-- 오류가 나면 전부 되돌아간다. 에디터가 「current transaction is aborted」를 내면 `rollback;` 한 번.
-- =====================================================================================

begin;

set local statement_timeout = '10min';

drop table if exists pg_temp.okubo_cfg, pg_temp.okubo_before, pg_temp.okubo_after, pg_temp.okubo_log;

create temp table okubo_cfg as select
  'f393a735-eb57-4f95-8b82-361ba46b81a5'::uuid as org,
  '4a50bc7a-ba12-4d62-8f67-08dcdaf5ff62'::uuid as prop_205165,   -- 옛 Okubo_A (B棟) → Okubo_B
  '1a7d5cc2-7ecd-4eb2-8cac-7c953ef0e9fb'::uuid as prop_294552,   -- 옛 Okubo_B (A棟) → Okubo_A
  false as apply;                                                  -- ★ 연습 실행 결과가 맞으면 true

create temp table okubo_log (step text, tbl text, n bigint);

-- room-label-normalization.ts 의 isOkuboA / isOkuboB 와 같은 판정(공백 · _ · ( ) · - 지우고 소문자, A 먼저)
create or replace function pg_temp.okubo_letter(t text) returns text
language sql immutable as $f$
  select case
    when t is null then null
    when lower(regexp_replace(t, '[[:space:]_()-]', '', 'g')) ~ '(오쿠보a|okuboa|大久保a)' then 'A'
    when lower(regexp_replace(t, '[[:space:]_()-]', '', 'g')) ~ '(오쿠보b|okubob|大久保b)' then 'B'
  end
$f$;

-- 값 하나를 맞바꾼다.
--   ① Beds24 옛 원문 이름 → 새 원문 이름(정확한 문자열, 글 속에 있어도): `Okubo_A (B棟)` → `Okubo_B`, `Okubo_B (A棟)` → `Okubo_A`
--   ② 그 밖의 표기는 글자 단위 A↔B: 오쿠보A ↔ 오쿠보B, 大久保A ↔ 大久保B, Okubo_A ↔ Okubo_B, okubo_a ↔ okubo_b
--      (「오쿠보A 201」 · 「오쿠보A_오쿠보A」 · {오쿠보A,…} · JSON 안 글자 포함. 오쿠보C 는 안 건드림)
create or replace function pg_temp.okubo_swap(t text) returns text
language plpgsql immutable as $f$
declare
  r text;
  -- 접두어 뒤 구분자는 TS normalizeKey 처럼 공백 · _ · ( ) · - 를 몇 개든 허용. 글자 뒤에 영문자가 오면 제외(Okubo Apartment 등).
  pre constant text := '((오쿠보|大久保|オクボ|オオクボ|[Oo][Kk][Uu][Bb][Oo])[[:space:]_()-]*)';
begin
  if t is null then return null; end if;
  r := replace(replace(t, 'Okubo_A (B棟)', chr(4)), 'Okubo_B (A棟)', chr(5));
  r := regexp_replace(r, pre || 'A(?![A-Za-z])', '\1' || chr(2), 'g');
  r := regexp_replace(r, pre || 'a(?![A-Za-z])', '\1' || chr(3), 'g');
  r := regexp_replace(r, pre || 'B(?![A-Za-z])', '\1A', 'g');
  r := regexp_replace(r, pre || 'b(?![A-Za-z])', '\1a', 'g');
  r := replace(replace(r, chr(2), 'B'), chr(3), 'b');
  r := replace(replace(r, chr(4), 'Okubo_B'), chr(5), 'Okubo_A');
  return r;
end
$f$;

-- 표 하나의 이름 칸들을 f393 조직 안에서 두 단계로 맞바꾼다. p_extra 는 추가 조건(없으면 'true').
create or replace function pg_temp.okubo_swap_rows(p_step text, p_table text, p_cols text[], p_extra text default 'true')
returns bigint language plpgsql as $f$
declare
  set1 text; set2 text; anycond text; marked text; flipfail text; n bigint; bad bigint;
  v_org constant text := quote_literal((select c.org from pg_temp.okubo_cfg c)::text) || '::uuid';
begin
  if to_regclass(p_table) is null then
    insert into pg_temp.okubo_log values (p_step, p_table || ' (표 없음 — 건너뜀)', 0);
    return 0;
  end if;
  -- 운영에 없는 칸은 빼고 진행
  p_cols := array(select c from unnest(p_cols) as c
                  where exists (select 1 from information_schema.columns
                                where table_schema = split_part(p_table, '.', 1) and table_name = split_part(p_table, '.', 2)
                                  and column_name = c));
  if cardinality(p_cols) = 0 then
    insert into pg_temp.okubo_log values (p_step, p_table || ' (칸 없음 — 건너뜀)', 0);
    return 0;
  end if;
  select string_agg(format('%1$I = case when pg_temp.okubo_letter(%1$I) in (''A'',''B'') then chr(1) || pg_temp.okubo_swap(%1$I) else %1$I end', c), ', '),
         string_agg(format('%1$I = case when left(%1$I, 1) = chr(1) then substr(%1$I, 2) else %1$I end', c), ', '),
         string_agg(format('pg_temp.okubo_letter(%I) in (''A'',''B'')', c), ' or '),
         string_agg(format('left(%I, 1) = chr(1)', c), ' or ')
    into set1, set2, anycond, marked
  from unnest(p_cols) as c;
  -- 오쿠보 A/B 로 읽히는데 맞바꿔도 A/B 가 그대로인 값(규칙이 못 잡는 표기)이 있으면 멈춘다
  select string_agg(format('(pg_temp.okubo_letter(%1$I) in (''A'',''B'') and pg_temp.okubo_letter(pg_temp.okubo_swap(%1$I)) is not distinct from pg_temp.okubo_letter(%1$I))', c), ' or ')
    into flipfail
  from unnest(p_cols) as c;
  execute format('select count(*) from %s where organization_id = %s and (%s) and (%s)', p_table, v_org, flipfail, p_extra) into bad;
  if bad > 0 then
    raise exception '% : 맞바꿔도 A/B 가 그대로인 값 % 건 — 표기 확인 필요(01 블록 2)', p_table, bad;
  end if;
  execute format('update %s set %s where organization_id = %s and (%s) and (%s)', p_table, set1, v_org, anycond, p_extra);
  get diagnostics n = row_count;
  execute format('update %s set %s where organization_id = %s and (%s)', p_table, set2, v_org, marked);
  insert into pg_temp.okubo_log values (p_step, p_table || ' ' || array_to_string(p_cols, ','), n);
  return n;
end
$f$;

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

-- ── 안전 확인 — 마스터가 아직 옛 이름이고(= 이 스크립트를 처음 돌림), 새 이름이 아무 데도 없을 것 ─────────────
do $$
declare c record; t text; k bigint;
begin
  select * into c from pg_temp.okubo_cfg;
  if not exists (select 1 from public.properties where id = c.prop_205165 and organization_id = c.org
                   and external_provider = 'beds24' and external_property_id = '205165' and name = 'Okubo_A (B棟)')
     or not exists (select 1 from public.properties where id = c.prop_294552 and organization_id = c.org
                   and external_provider = 'beds24' and external_property_id = '294552' and name = 'Okubo_B (A棟)') then
    raise exception '마스터가 예상한 옛 이름이 아닙니다 — 이미 적용했거나 동기화가 이름을 바꿨습니다. 멈춥니다.';
  end if;
  if exists (select 1 from public.properties where organization_id = c.org and name in ('Okubo_A', 'Okubo_B')) then
    raise exception 'f393 에 이미 Okubo_A / Okubo_B 이름의 건물이 있습니다 — 01 블록 1 확인';
  end if;
  -- 새 원문 이름(Okubo_A / Okubo_B)이 기록에 이미 있으면(백필 · 웹훅이 Beds24 이름을 그대로 쓴 행) 맞바꾸면 반대로 뒤집힌다 → 멈춘다
  for t in select unnest(array['public.reservations', 'public.room_blocks', 'public.beds24_block_logs', 'public.external_reviews',
                               'public.customer_complaints', 'public.staff_suggestions'])
  loop
    continue when to_regclass(t) is null;
    execute format('select count(*) from %s where organization_id = %L and property_name in (''Okubo_A'', ''Okubo_B'')', t, c.org) into k;
    if k > 0 then
      raise exception '% 에 새 이름(Okubo_A / Okubo_B) 행이 이미 % 건 있습니다 — 맞바꾸면 반대로 뒤집힙니다. 멈춥니다.', t, k;
    end if;
  end loop;
end $$;

create temp table okubo_before as select * from pg_temp.okubo_scan();


-- ── [1] 마스터 — properties.name (unique (organization_id, name) → 두 단계) + 표시 이름 ────────────────────
update public.properties
   set name = chr(1) || name
 where organization_id = (select org from pg_temp.okubo_cfg)
   and id in ((select prop_205165 from pg_temp.okubo_cfg), (select prop_294552 from pg_temp.okubo_cfg));
with u as (
  update public.properties
     set name = case id when (select prop_205165 from pg_temp.okubo_cfg) then 'Okubo_B'
                        when (select prop_294552 from pg_temp.okubo_cfg) then 'Okubo_A' end
   where organization_id = (select org from pg_temp.okubo_cfg)
     and id in ((select prop_205165 from pg_temp.okubo_cfg), (select prop_294552 from pg_temp.okubo_cfg))
  returning 1
)
insert into okubo_log select '1 마스터', 'public.properties name', count(*) from u;
select pg_temp.okubo_swap_rows('1 마스터', 'public.properties', array['display_name_ko', 'display_name_ja', 'display_name_en'],
  $w$ id in ((select prop_205165 from pg_temp.okubo_cfg), (select prop_294552 from pg_temp.okubo_cfg)) $w$);
-- rooms 는 바꾸지 않는다(머리말 「바꾸지 않는 것」). 03 에서 객실 라벨을 확인한다.


-- ── [2] 예약 · 블록 — 건물 이름만 ────────────────────────────────────────────────────────────────────
select pg_temp.okubo_swap_rows('2 예약', 'public.reservations', array['property_name']);
select pg_temp.okubo_swap_rows('2 예약', 'public.room_blocks', array['property_name']);     -- unique (org, source, property_name, room_label, start_date)
select pg_temp.okubo_swap_rows('2 예약', 'public.beds24_block_logs', array['property_name']);


-- ── [3] 운영 기록 ───────────────────────────────────────────────────────────────────────────────────
select pg_temp.okubo_swap_rows('3 청소', 'public.cleaning_sessions', array['room_label', 'room_key']);   -- 표현식 유니크 인덱스
select pg_temp.okubo_swap_rows('3 청소', 'public.cleaning_assignments', array['property_name', 'room_label', 'room_key']);
select pg_temp.okubo_swap_rows('3 청소', 'public.cleaning_room_holds', array['property_name', 'room_label', 'room_key']);
select pg_temp.okubo_swap_rows('3 청소', 'public.cleaning_list_extra_rooms', array['property_name', 'room_label', 'room_key']);
select pg_temp.okubo_swap_rows('3 청소', 'public.cleaning_list_assignees', array['room_key']);
select pg_temp.okubo_swap_rows('3 기록', 'public.maintenance_reports', array['property_name', 'room_label']);
select pg_temp.okubo_swap_rows('3 기록', 'public.lost_items', array['property_name', 'room_label']);
select pg_temp.okubo_swap_rows('3 기록', 'public.order_requests', array['building_name', 'room_label']);
select pg_temp.okubo_swap_rows('3 기록', 'public.linen_return_records', array['building_name']);
select pg_temp.okubo_swap_rows('3 기록', 'public.staff_suggestions', array['property_name']);
select pg_temp.okubo_swap_rows('3 기록', 'public.customer_complaints', array['property_name']);
select pg_temp.okubo_swap_rows('3 기록', 'public.external_reviews', array['property_name']);
-- 검증 트리거(transport_reimbursement_items_validate, BEFORE INSERT OR UPDATE)는 근태 연결을 다시 검사해 오류를 내거나
-- attendance_session_id 를 비울 수 있다 → 이 UPDATE 동안만 끈다(트랜잭션 안이라 실패하면 같이 되돌아간다).
-- 가격 변경 이력의 room_label 은 화면의 행 이름(독채는 건물 이름 「오쿠보A」 · 「오쿠보B」)이라 A↔B 를 통째로 맞바꾼다
-- (2026-11-09 연습 실행: 오쿠보A 107 · 오쿠보B 98 — 둘 다 있어서 한쪽만 바꾸면 두 집이 합쳐진다).
select pg_temp.okubo_swap_rows('3 기록', 'public.price_change_logs', array['room_label']);
alter table public.transport_reimbursement_items disable trigger transport_reimbursement_items_validate;
with u as (
  update public.transport_reimbursement_items
     set work_context = pg_temp.okubo_swap(work_context::text)::jsonb
   where organization_id = (select org from pg_temp.okubo_cfg)
     and pg_temp.okubo_swap(work_context::text) <> work_context::text
  returning 1
)
insert into okubo_log select '3 기록', 'public.transport_reimbursement_items work_context', count(*) from u;
alter table public.transport_reimbursement_items enable trigger transport_reimbursement_items_validate;


-- ── [3b] 방 이름 — Beds24 가 437952(205165 집의 방) 이름도 「오쿠보A」→「오쿠보B」로 바꿨다(2026-11-09 확인) ─────
-- 예약 키(`<번호>::room::<방 이름>`)가 방 이름을 담고 있어, PMS 가 나중에 방 이름을 따라 바꾸면 다음 웹훅이 예약을 새 줄로
-- 다시 만들고 옛 줄을 지운다(메모 · 연결 유실). 그래서 지금 Beds24 와 똑같이 맞춰 둔다. 294552 의 방(ファミリー)은 그대로.
do $$
declare
  c record; n bigint;
  r_id uuid;
begin
  select * into c from pg_temp.okubo_cfg;
  select id into r_id from public.rooms
   where organization_id = c.org and property_id = c.prop_205165 and external_room_id = '437952';
  if r_id is null then
    raise exception '방 437952 (205165) 를 rooms 에서 찾지 못했습니다 — 멈춥니다.';
  end if;

  update public.rooms set room_label = '오쿠보B', name = case when name = '오쿠보A' then '오쿠보B' else name end
   where id = r_id and room_label = '오쿠보A';
  get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.rooms 437952', n);

  update public.reservations
     set room_label = '오쿠보B',
         source_reservation_id = replace(source_reservation_id, '::room::오쿠보A', '::room::오쿠보B')
   where organization_id = c.org and property_name = 'Okubo_B' and room_label = '오쿠보A';
  get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.reservations room_label · 예약 키', n);

  update public.room_blocks set room_label = '오쿠보B'
   where organization_id = c.org and room_label = '오쿠보A'
     and (external_room_id = '437952' or property_name = 'Okubo_B');
  get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.room_blocks', n);

  update public.beds24_block_logs set room_label = '오쿠보B'
   where organization_id = c.org and room_label = '오쿠보A'
     and ('437952' = any(external_room_ids) or property_name = 'Okubo_B');
  get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.beds24_block_logs', n);

  update public.customer_complaints set room_label = '오쿠보B'
   where organization_id = c.org and room_label = '오쿠보A'
     and (room_id = r_id or property_id = c.prop_205165 or property_name = 'Okubo_B');
  get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.customer_complaints', n);

  update public.staff_suggestions set room_label = '오쿠보B'
   where organization_id = c.org and room_label = '오쿠보A'
     and (room_id = r_id or property_id = c.prop_205165 or property_name = 'Okubo_B');
  get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.staff_suggestions', n);

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'external_reviews' and column_name = 'room_label') then
    execute format($q$update public.external_reviews set room_label = '오쿠보B'
                      where organization_id = %L and room_label = '오쿠보A'
                        and (property_id = %L or property_name = 'Okubo_B')$q$, c.org, c.prop_205165);
    get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'public.external_reviews', n);
  end if;

  if to_regclass('checkin.stay_rooms') is not null then
    update checkin.stay_rooms sr set room_label = '오쿠보B'
     where sr.organization_id = c.org and sr.room_label = '오쿠보A'
       and (sr.room_id = '437952'
            or exists (select 1 from public.reservations rv where rv.id = sr.reservation_id and rv.property_name = 'Okubo_B'));
    get diagnostics n = row_count; insert into pg_temp.okubo_log values ('3b 방 이름', 'checkin.stay_rooms', n);
  end if;
end $$;


-- ── [4] 셀프 체크인 — property_key(okubo_a / okubo_b)──────────────────────────────────────────────────
select pg_temp.okubo_swap_rows('4 체크인', 'checkin.stays', array['property_key']);
select pg_temp.okubo_swap_rows('4 체크인', 'checkin.staff_calls', array['property_key']);


-- ── [5] 설정 — 한 번 전부 ────────────────────────────────────────────────────────────────────────────
select pg_temp.okubo_swap_rows('5 설정', 'public.cleaning_fixed_staff', array['property_name']);      -- PK (org, owner, property_name, user)
select pg_temp.okubo_swap_rows('5 설정', 'public.cleaning_room_settings', array['room_key']);         -- PK (org, room_key)
select pg_temp.okubo_swap_rows('5 설정', 'public.building_listing_links', array['canonical_name']);   -- unique (org, canonical_name, channel)
select pg_temp.okubo_swap_rows('5 설정', 'public.room_link_rooms', array['canonical_name']);          -- unique (org, canonical_name, name)
select pg_temp.okubo_swap_rows('5 설정', 'public.linen_items', array['building_name']);
select pg_temp.okubo_swap_rows('5 설정', 'checkin.property_settings', array['property_key']);         -- PK (org, property_key)
select pg_temp.okubo_swap_rows('5 설정', 'checkin.devices', array['property_key']);                   -- 집에 놓인 태블릿은 그 집을 따라간다
select pg_temp.okubo_swap_rows('5 설정', 'checkin.enrollment_codes', array['property_key']);
with u as (
  update public.cleaning_staff_profiles
     set main_properties = pg_temp.okubo_swap(main_properties::text)::text[]
   where organization_id = (select org from pg_temp.okubo_cfg)
     and pg_temp.okubo_swap(main_properties::text) <> main_properties::text
  returning 1
)
insert into okubo_log select '5 설정', 'public.cleaning_staff_profiles main_properties', count(*) from u;
-- 자동화: cleaning_list.settings.excludedProperties 등 settings 안의 이름 전부(src/lib/automation/jobs.ts parseSettings)
with u as (
  update public.automation_jobs
     set settings = pg_temp.okubo_swap(settings::text)::jsonb
   where organization_id = (select org from pg_temp.okubo_cfg)
     and pg_temp.okubo_swap(settings::text) <> settings::text
  returning 1
)
insert into okubo_log select '5 설정', 'public.automation_jobs settings', count(*) from u;
-- 건물 운영 정보(주소 · 공용 출입 · 방 비밀번호) — 건물 이름이 키다. unique (org, canonical_name) → 두 단계.
select pg_temp.okubo_swap_rows('5 설정', 'public.property_operation_infos', array['canonical_name']);
-- 안의 글(「오쿠보B와 동일한 위치」 · room_access 의 roomLabel 등)도 그 집을 가리키므로 같이 맞바꾼다(바뀌는 행만).
with u as (
  update public.property_operation_infos
     set shared_access = pg_temp.okubo_swap(shared_access::text)::jsonb,
         room_access   = pg_temp.okubo_swap(room_access::text)::jsonb,
         address_ko    = pg_temp.okubo_swap(address_ko),
         address_ja    = pg_temp.okubo_swap(address_ja),
         address_en    = pg_temp.okubo_swap(address_en),
         note          = pg_temp.okubo_swap(note)
   where organization_id = (select org from pg_temp.okubo_cfg)
     and (pg_temp.okubo_swap(shared_access::text) <> shared_access::text
          or pg_temp.okubo_swap(room_access::text) <> room_access::text
          or pg_temp.okubo_swap(address_ko) is distinct from address_ko
          or pg_temp.okubo_swap(address_ja) is distinct from address_ja
          or pg_temp.okubo_swap(address_en) is distinct from address_en
          or pg_temp.okubo_swap(note) <> note)
  returning 1
)
insert into okubo_log select '5 설정', 'public.property_operation_infos 안의 글', count(*) from u;
-- checkin.property_settings 의 환영 문구 · 약관 · 연락처는 사람이 쓴 문구라 자동으로 바꾸지 않는다.


-- ── [6] 집계 — 다시 계산 표시(1분 틱이 예약에서 새로 만든다) ──────────────────────────────────────────────
update public.ops_stats_months set dirty = true, dirty_at = now()
 where organization_id = (select org from pg_temp.okubo_cfg);


-- ── [7] 검사 · 연습 실행 ───────────────────────────────────────────────────────────────────────────
create temp table okubo_after as select * from pg_temp.okubo_scan();

do $$
declare
  summary text;
  steps text;
  other_changed text;
  leftover text;
begin
  -- 다른 조직은 값 하나도 바뀌면 안 된다
  select string_agg(format('%s | %s : %s → %s', src, v, coalesce(b.n, 0), coalesce(a.n, 0)), E'\n')
    into other_changed
  from (select * from pg_temp.okubo_before where scope = 'other') b
  full join (select * from pg_temp.okubo_after where scope = 'other') a using (scope, src, v)
  where coalesce(b.n, 0) <> coalesce(a.n, 0);
  if other_changed is not null then
    raise exception E'다른 조직 값이 바뀌었습니다 — 전부 되돌립니다:\n%', other_changed;
  end if;

  -- 마스터가 정확히 새 이름이어야 한다
  if (select count(*) from public.properties p, pg_temp.okubo_cfg c
       where (p.id = c.prop_205165 and p.name = 'Okubo_B') or (p.id = c.prop_294552 and p.name = 'Okubo_A')) <> 2 then
    raise exception '마스터 이름이 기대와 다릅니다(205165 = Okubo_B, 294552 = Okubo_A)';
  end if;

  -- 표시(chr(1))가 남은 칸이 없어야 한다
  select string_agg(src || ' = ' || v, E'\n') into leftover
  from pg_temp.okubo_after where position(chr(1) in v) > 0;
  if leftover is not null then
    raise exception E'두 단계 표시가 남았습니다:\n%', leftover;
  end if;

  select string_agg(format('%s | %s : %s → %s', src, v, coalesce(b.n, 0), coalesce(a.n, 0)), E'\n' order by src, v)
    into summary
  from (select * from pg_temp.okubo_before where scope = 'target') b
  full join (select * from pg_temp.okubo_after where scope = 'target') a using (scope, src, v)
  where coalesce(b.n, 0) <> coalesce(a.n, 0);
  select string_agg(format('[%s] %s = %s', step, tbl, n), E'\n' order by step, tbl) into steps from pg_temp.okubo_log;

  if not (select apply from pg_temp.okubo_cfg) then
    raise exception E'연습 실행 — 전부 되돌렸습니다. 맞으면 apply = true 로 다시 실행.\n\n바꾼 행 수:\n%\n\nf393 값별 건수 (전 → 후):\n%',
      coalesce(steps, '(없음)'), coalesce(summary, '(변화 없음)');
  end if;
end $$;

commit;

-- 적용 뒤: f393 값별 건수 전 → 후 (다른 조직은 위 검사에서 「그대로」 확인됨)
select coalesce(b.src, a.src) as src, coalesce(b.v, a.v) as v, coalesce(b.n, 0) as before_n, coalesce(a.n, 0) as after_n
from (select * from pg_temp.okubo_before where scope = 'target') b
full join (select * from pg_temp.okubo_after where scope = 'target') a using (scope, src, v)
order by 1, 2;
