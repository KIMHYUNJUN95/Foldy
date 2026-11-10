-- 린넨 반품 점검 보강 (2026-11-10)
--
-- 도메인 계약: docs/product/19-linen-defect-workflow.md(§2 같은 날 합치기 · Record Management Contract · Edit / Delete Policy),
--   docs/engineering/04-data-model.md(linen_return_records), docs/engineering/05-rls-permissions.md(린넨 · 저장소 사진 규칙)
--
-- 1) 사진 저장소(H1): 202610220001 이 요청 사진 정책을 다시 만들면서 폴더 목록에서 'linen-returns' 를 빠뜨려,
--    그 뒤로 린넨 사진 올리기 · 지우기가 전부 막혀 있었다. 같은 정책 이름 · 같은 다른 조건으로 다시 만들고 폴더만 더한다.
--    지우기는 linen-returns 폴더에 대해 「내가 올린 것 또는 linen.manage」, 다른 폴더는 예전 그대로(내 것 또는 request.delete_any).
-- 2) 기록 칸 보호(H4): 등록 시각 · 등록자는 현장 증빙값이다. INSERT 는 등록 시각을 now() 로, 등록자는 본인만.
--    UPDATE 는 두 칸을 누구도 못 바꾼다. service_role · cron(auth.uid() 없음)은 통과 — 서버 코드는 자체 게이트를 거친다.
--    building_name 이 객실 마스터에 있는지는 DB 에서 보지 않는다: 마스터(rooms · properties)는 이름 정규화 · 운영 제외 건물 규칙을
--    앱(src/lib/rooms.ts)에서 거쳐야 같은 목록이 나와서, 서버 액션의 isKnownBuilding 검사만 둔다.
-- 3) 수정 · 삭제 RLS(M2): 작성자 조건에 활성 멤버를 더한다 — 퇴사 · 정지된 사람이 예전 기록을 고치거나 지우지 못하게.
--    품목 UPDATE 에는 같은 조건의 WITH CHECK 를 붙이고, 품목 줄의 linen_item_id 는 기록과 같은 조직 품목만 받는다.
-- 4) 같은 날 합치기 원자화(H2 · H3): linen_submit_return — 한 트랜잭션 · (조직, 건물, 작성자, 도쿄 날짜) 잠금 · 제출 id 멱등.
-- 5) 수정 원자화(M3): linen_update_return — 머리 · 품목 줄을 한 트랜잭션에, 읽은 updated_at 과 다르면 'linen:stale'.
--
-- 두 함수는 SECURITY INVOKER — 호출한 사람의 RLS 가 그대로 적용된다(권한 판정을 함수 안에 다시 쓰지 않는다).
-- 오류는 'linen:<이유>' 이름표로 던지고, 앱은 src/lib/linen-return-rules.ts 의 linenRpcErrorReason 으로 읽는다.

-- ── 1) 요청 사진 저장소 정책 ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "org members can upload request images" on storage.objects;
create policy "org members can upload request images" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 2) = any (array['lost-items', 'lost-found-handling', 'maintenance-reports', 'maintenance-resolutions', 'order-images', 'linen-returns']))
    and (split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (char_length(split_part(name, '/', 4)) between 3 and 160)
    and (split_part(name, '/', 4) ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$')
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or exists (
        select 1 from public.memberships m
        where (m.organization_id)::text = split_part(objects.name, '/', 1)
          and m.user_id = auth.uid()
          and m.status = 'active'
      )
    )
  );

drop policy if exists "org members can delete request images" on storage.objects;
create policy "org members can delete request images" on storage.objects
  for delete to authenticated
  using (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 2) = any (array['lost-items', 'lost-found-handling', 'maintenance-reports', 'maintenance-resolutions', 'order-images', 'linen-returns']))
    and (split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or (
        exists (
          select 1 from public.memberships m
          where (m.organization_id)::text = split_part(objects.name, '/', 1)
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
        and (
          owner_id = (auth.uid())::text
          or public.has_capability(
            case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end,
            auth.uid(),
            case when split_part(name, '/', 2) = 'linen-returns' then 'linen.manage' else 'request.delete_any' end
          )
        )
      )
    )
  );

-- ── 2) 기록 칸 보호 ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_linen_return_record_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.registered_at := now();
    if new.registered_by_user_id is distinct from (select auth.uid()) then
      raise exception 'linen:forbidden registered_by_user_id must be the caller' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.registered_at is distinct from old.registered_at
     or new.registered_by_user_id is distinct from old.registered_by_user_id then
    raise exception 'linen:forbidden registration evidence cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_linen_return_record_evidence() from public, anon, authenticated;

drop trigger if exists linen_return_records_evidence_guard on public.linen_return_records;
create trigger linen_return_records_evidence_guard
  before insert or update on public.linen_return_records
  for each row
  execute function public.enforce_linen_return_record_evidence();

-- 품목 줄의 품목은 기록과 같은 조직 것만(누구에게나 — 데이터 무결성).
create or replace function public.enforce_linen_return_line_item_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.linen_return_records r
    join public.linen_items i on i.organization_id = r.organization_id
    where r.id = new.return_record_id
      and i.id = new.linen_item_id
  ) then
    raise exception 'linen:invalid_item item must belong to the record organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_linen_return_line_item_org() from public, anon, authenticated;

drop trigger if exists linen_return_record_items_same_org on public.linen_return_record_items;
create trigger linen_return_record_items_same_org
  before insert or update on public.linen_return_record_items
  for each row
  execute function public.enforce_linen_return_line_item_org();

-- ── 3) 수정 · 삭제 RLS — 작성자는 활성 멤버일 때만 ──────────────────────────────────────────────────────
alter policy "author or admin can update linen return records" on public.linen_return_records
  using (((select auth.uid()) is not null) and (((registered_by_user_id = (select auth.uid())) and public.has_active_membership(organization_id))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'linen.manage')));
alter policy "author or admin can delete linen return records" on public.linen_return_records
  using (((select auth.uid()) is not null) and (((registered_by_user_id = (select auth.uid())) and public.has_active_membership(organization_id))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'linen.manage')));
alter policy "delete line items of editable linen return records" on public.linen_return_record_items
  using (((select auth.uid()) is not null) and exists (
    select 1 from public.linen_return_records r
    where r.id = linen_return_record_items.return_record_id
      and (((r.registered_by_user_id = (select auth.uid())) and public.has_active_membership(r.organization_id))
        or (select public.is_platform_admin())
        or public.has_capability(r.organization_id, (select auth.uid()), 'linen.manage'))));
alter policy "mutate line items of editable linen return records" on public.linen_return_record_items
  using (((select auth.uid()) is not null) and exists (
    select 1 from public.linen_return_records r
    where r.id = linen_return_record_items.return_record_id
      and (((r.registered_by_user_id = (select auth.uid())) and public.has_active_membership(r.organization_id))
        or (select public.is_platform_admin())
        or public.has_capability(r.organization_id, (select auth.uid()), 'linen.manage'))))
  with check (((select auth.uid()) is not null) and exists (
    select 1 from public.linen_return_records r
    where r.id = linen_return_record_items.return_record_id
      and (((r.registered_by_user_id = (select auth.uid())) and public.has_active_membership(r.organization_id))
        or (select public.is_platform_admin())
        or public.has_capability(r.organization_id, (select auth.uid()), 'linen.manage'))));

-- ── 4) 같은 날 합치기 — 제출 id 멱등 ─────────────────────────────────────────────────────────────────────
-- 처리한 제출 id 를 기록에 모은다. 새 기록의 id 는 첫 제출 id 와 같다(사진 폴더도 그 id).
alter table public.linen_return_records
  add column if not exists submission_ids uuid[] not null default '{}'::uuid[];

create index if not exists linen_return_records_submission_ids_idx
  on public.linen_return_records using gin (submission_ids);

create or replace function public.linen_submit_return(
  p_organization_id uuid,
  p_submission_id uuid,
  p_building text,
  p_note text,
  p_image_urls text[],
  p_lines jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day date := (now() at time zone 'Asia/Tokyo')::date;
  v_from timestamptz;
  v_found uuid;
  v_rec record;
  v_images text[];
  v_merged text[];
  v_next integer;
  v_note text := nullif(p_note, '');
begin
  if v_uid is null then
    raise exception 'linen:forbidden not authenticated' using errcode = '42501';
  end if;
  if p_organization_id is null or p_submission_id is null or coalesce(trim(p_building), '') = '' then
    raise exception 'linen:invalid_input' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'linen:missing_items' using errcode = '22023';
  end if;
  -- 형식 검사는 변환 전에 — 잘못된 uuid · 숫자가 이름표 없는 22P02 로 새지 않게(OR 평가 순서에 기대지 않는다).
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e) is distinct from 'object'
       or coalesce(e ->> 'itemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'linen:invalid_item' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where coalesce(
      case when jsonb_typeof(e -> 'quantity') = 'number'
        then (e ->> 'quantity')::numeric > 0
             and (e ->> 'quantity')::numeric = trunc((e ->> 'quantity')::numeric)
             and (e ->> 'quantity')::numeric <= 2147483647
      end,
      false
    ) = false
  ) then
    raise exception 'linen:invalid_quantity' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct e ->> 'itemId') from jsonb_array_elements(p_lines) e) then
    raise exception 'linen:duplicate_item' using errcode = '22023';
  end if;

  -- 같은 제출 id 를 먼저 한 줄로 세운다 — 같은 id 로 건물만 바꿔 동시에 보내도 둘째는 기본 키 충돌 대신 「이미 처리됨」을 본다.
  -- 잠그는 순서는 늘 제출 id → (조직, 건물, 작성자, 날짜) 라 서로 기다리다 막히는 일이 없다.
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'linen_submit_return:submission', p_submission_id), 0)
  );

  -- 같은 사람 · 건물 · 도쿄 날짜의 제출을 한 줄로 세운다(동시에 들어온 첫 제출 두 개가 기록 두 개를 만들지 않게).
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'linen_submit_return', p_organization_id, p_building, v_uid, v_day), 0)
  );

  -- 같은 제출 id 를 이미 처리했으면 아무것도 하지 않는다(다시 보내기 · 두 번 누르기).
  select r.id into v_found
  from public.linen_return_records r
  where r.organization_id = p_organization_id
    and r.registered_by_user_id = v_uid
    and (r.id = p_submission_id or r.submission_ids @> array[p_submission_id])
  limit 1;
  if v_found is not null then
    return jsonb_build_object('record_id', v_found, 'merged', v_found <> p_submission_id, 'duplicate', true);
  end if;

  -- 사진: 빈 값 빼고 순서 지켜 중복 제거.
  v_images := coalesce((
    select array_agg(s.u order by s.o)
    from (
      select t.u, min(t.o) as o
      from unnest(coalesce(p_image_urls, '{}'::text[])) with ordinality as t(u, o)
      where coalesce(t.u, '') <> ''
      group by t.u
    ) s
  ), '{}'::text[]);

  v_from := (v_day::timestamp at time zone 'Asia/Tokyo');
  select r.id, r.note, r.image_urls into v_rec
  from public.linen_return_records r
  where r.organization_id = p_organization_id
    and r.building_name = p_building
    and r.registered_by_user_id = v_uid
    and r.registered_at >= v_from
    and r.registered_at < v_from + interval '1 day'
  order by r.registered_at desc
  limit 1
  for update;

  if not found then
    if cardinality(v_images) > 5 then
      raise exception 'linen:too_many_photos' using errcode = '22023';
    end if;
    insert into public.linen_return_records
      (id, organization_id, building_name, note, image_urls, registered_by_user_id, submission_ids)
    values
      (p_submission_id, p_organization_id, p_building, v_note, v_images, v_uid, array[p_submission_id]);
    insert into public.linen_return_record_items (return_record_id, linen_item_id, quantity, sort_order)
    select p_submission_id, (t.e ->> 'itemId')::uuid, (t.e ->> 'quantity')::integer, (t.o - 1)::integer
    from jsonb_array_elements(p_lines) with ordinality as t(e, o);
    return jsonb_build_object('record_id', p_submission_id, 'merged', false, 'duplicate', false);
  end if;

  -- 합친 뒤 사진이 5장을 넘으면 아무것도 쓰지 않고 거절한다.
  v_merged := coalesce(v_rec.image_urls, '{}'::text[]) || coalesce((
    select array_agg(t.u order by t.o)
    from unnest(v_images) with ordinality as t(u, o)
    where not (t.u = any (coalesce(v_rec.image_urls, '{}'::text[])))
  ), '{}'::text[]);
  if cardinality(v_merged) > 5 then
    raise exception 'linen:too_many_photos_merged' using errcode = '22023';
  end if;

  select coalesce(max(li.sort_order), -1) + 1 into v_next
  from public.linen_return_record_items li
  where li.return_record_id = v_rec.id;

  -- 같은 품목은 수량을 원자적으로 더하고, 새 품목은 뒤에 붙인다. 더한 값이 integer 를 넘으면 invalid_quantity.
  begin
    insert into public.linen_return_record_items as li (return_record_id, linen_item_id, quantity, sort_order)
    select v_rec.id, (t.e ->> 'itemId')::uuid, (t.e ->> 'quantity')::integer, v_next + (t.o - 1)::integer
    from jsonb_array_elements(p_lines) with ordinality as t(e, o)
    on conflict (return_record_id, linen_item_id)
    do update set quantity = li.quantity + excluded.quantity;
  exception when numeric_value_out_of_range then
    raise exception 'linen:invalid_quantity' using errcode = '22003';
  end;

  -- 메모 합치기 — 새 메모가 없으면 그대로, 기존이 없으면 새 것, 같으면 하나, 다르면 빈 줄 하나 두고 뒤에.
  update public.linen_return_records r
  set note = case
               when v_note is null then r.note
               when r.note is null or r.note = '' then v_note
               when r.note = v_note then r.note
               else r.note || E'\n\n' || v_note
             end,
      image_urls = v_merged,
      submission_ids = r.submission_ids || p_submission_id
  where r.id = v_rec.id;

  return jsonb_build_object('record_id', v_rec.id, 'merged', true, 'duplicate', false);
end;
$$;

revoke all on function public.linen_submit_return(uuid, uuid, text, text, text[], jsonb) from public, anon;
grant execute on function public.linen_submit_return(uuid, uuid, text, text, text[], jsonb) to authenticated, service_role;

-- ── 5) 수정 — 머리 · 품목 줄 한 트랜잭션 + 동시 수정 막기 ────────────────────────────────────────────────
-- p_expected_updated_at 이 null 이면 동시 수정 검사를 건너뛴다(그 값을 아직 보내지 않는 화면 호환).
-- p_building 이 null · 빈 값이면 건물은 그대로(모바일 수정은 건물을 바꾸지 않는다).
create or replace function public.linen_update_return(
  p_record_id uuid,
  p_expected_updated_at timestamptz,
  p_building text,
  p_note text,
  p_image_urls text[],
  p_lines jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated_at timestamptz;
  v_images text[];
begin
  if (select auth.uid()) is null then
    raise exception 'linen:forbidden not authenticated' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'linen:missing_items' using errcode = '22023';
  end if;
  -- 형식 검사는 변환 전에 — 잘못된 uuid · 숫자가 이름표 없는 22P02 로 새지 않게(OR 평가 순서에 기대지 않는다).
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e) is distinct from 'object'
       or coalesce(e ->> 'itemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'linen:invalid_item' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where coalesce(
      case when jsonb_typeof(e -> 'quantity') = 'number'
        then (e ->> 'quantity')::numeric > 0
             and (e ->> 'quantity')::numeric = trunc((e ->> 'quantity')::numeric)
             and (e ->> 'quantity')::numeric <= 2147483647
      end,
      false
    ) = false
  ) then
    raise exception 'linen:invalid_quantity' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct e ->> 'itemId') from jsonb_array_elements(p_lines) e) then
    raise exception 'linen:duplicate_item' using errcode = '22023';
  end if;

  -- 보이는 기록인지(읽기 정책) 먼저, 그다음 고칠 수 있는지(FOR UPDATE 는 수정 정책도 본다).
  if not exists (select 1 from public.linen_return_records r where r.id = p_record_id) then
    raise exception 'linen:not_found' using errcode = 'P0002';
  end if;
  select r.updated_at into v_updated_at
  from public.linen_return_records r
  where r.id = p_record_id
  for update;
  if not found then
    raise exception 'linen:forbidden' using errcode = '42501';
  end if;
  if p_expected_updated_at is not null and v_updated_at is distinct from p_expected_updated_at then
    raise exception 'linen:stale' using errcode = '40001';
  end if;

  v_images := coalesce((
    select array_agg(s.u order by s.o)
    from (
      select t.u, min(t.o) as o
      from unnest(coalesce(p_image_urls, '{}'::text[])) with ordinality as t(u, o)
      where coalesce(t.u, '') <> ''
      group by t.u
    ) s
  ), '{}'::text[]);
  if cardinality(v_images) > 5 then
    raise exception 'linen:too_many_photos' using errcode = '22023';
  end if;

  update public.linen_return_records r
  set building_name = coalesce(nullif(trim(p_building), ''), r.building_name),
      note = nullif(p_note, ''),
      image_urls = v_images
  where r.id = p_record_id
  returning r.updated_at into v_updated_at;
  if not found then
    raise exception 'linen:forbidden' using errcode = '42501';
  end if;

  delete from public.linen_return_record_items li
  where li.return_record_id = p_record_id
    and not (li.linen_item_id = any (
      select (e ->> 'itemId')::uuid from jsonb_array_elements(p_lines) e
    ));

  insert into public.linen_return_record_items as li (return_record_id, linen_item_id, quantity, sort_order)
  select p_record_id, (t.e ->> 'itemId')::uuid, (t.e ->> 'quantity')::integer, (t.o - 1)::integer
  from jsonb_array_elements(p_lines) with ordinality as t(e, o)
  on conflict (return_record_id, linen_item_id)
  do update set quantity = excluded.quantity, sort_order = excluded.sort_order;

  return v_updated_at;
end;
$$;

revoke all on function public.linen_update_return(uuid, timestamptz, text, text, text[], jsonb) from public, anon;
grant execute on function public.linen_update_return(uuid, timestamptz, text, text, text[], jsonb) to authenticated, service_role;
