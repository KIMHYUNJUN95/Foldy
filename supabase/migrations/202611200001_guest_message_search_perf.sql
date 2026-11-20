-- 손님 메시지함 검색 빠르게 (2026-11-20) — docs/product/47-guest-messaging.md §5-10 · docs/engineering/04-data-model.md
--
-- 202611180001 의 `guest_conversation_search` 를 같은 이름 · 같은 인자 · 같은 돌려주는 열로 다시 만든다(앱 배포와 순서가 어긋나도 된다).
-- **결과(어떤 대화가 어떤 순서로, 어떤 메시지를 맞은 말로)는 예전과 같다** — 바뀐 것은 찾는 순서뿐이다.
--
-- 운영 실측(대화 9,195 · 메시지 121,890): 3글자 이름 검색 3,198ms — 맞는 메시지 2만 줄을 **본문째** 대화별 정렬(distinct on)해
-- 임시 파일까지 썼고, 대화 전체를 예약과 붙인 뒤에야 맨 끝에서 80개로 잘랐다.
--
-- 새 순서:
--   1) 최근 대화 먼저 — 마지막 메시지 최신순 앞 400개 대화만 놓고(대화마다 자기 메시지 색인으로) 맞는지 본다. 거기서 80개가 다 차면
--      그것이 곧 답이다(그 뒤 대화는 순서상 모두 뒤라 끼어들 수 없다). 흔한 검색어(이름 3글자 · 2글자)는 여기서 끝난다.
--   2) 못 채우면 전체 — 예전처럼 대화 전체에서 찾되, 메시지는 **대화 id 만** 모은다(본문을 들고 정렬하지 않는다).
--   3) 고른 80개에만 돌려줄 열을 만든다 — 예약 붙이기 · 맞은 말(대화마다 맞는 메시지 중 마지막 하나, 예전 distinct on 과 같은 순서)
--      · 본문. 코드 가리기 정규식도 코드가 실제로 든 메시지에만 돌린다(`!~` 로 먼저 거름 — 코드가 없으면 가린 글 = 원문).
--
-- 권한 · 조직 범위 · 코드 가리기(`p_code_mask`) 는 예전과 같다: security invoker · search_path '' · 실행은 service_role 만.
-- 이 파일은 함수만 바꾼다(표 잠금 없음).
--
-- 멱등: create or replace · revoke/grant 는 다시 돌려도 안전하다. 대시보드 SQL 편집기에 통째로 붙여 한 번에 돌린다.
--
-- 되돌리기: 202611180001_guest_message_search.sql 의 `create or replace function …` 부분을 다시 돌린다.

create or replace function public.guest_conversation_search(
  p_organization_id uuid,
  p_like text,
  p_name_fragments text[] default '{}',
  p_reference text default null,
  p_phone_pattern text default null,
  p_email text default null,
  p_place_names text[] default '{}',
  p_body boolean default false,
  p_body_since timestamptz default null,
  p_code_mask text default null,
  p_status text default 'all',
  p_building text default null,
  p_channel text default 'all',
  p_now timestamptz default now(),
  p_limit integer default 80
)
returns table (
  conversation_id uuid,
  last_message_at timestamptz,
  guest_name text,
  reservation_guest_name text,
  name_hit boolean,
  reference_hit boolean,
  place_hit boolean,
  phone text,
  mobile text,
  email_hit boolean,
  body_message_id uuid,
  body_direction text,
  body text
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 80), 1), 200);
  -- 1) 단계에서 볼 최근 대화 수. 대화마다 자기 메시지(평균 13개)를 색인으로 읽는다 — 400개 ≈ 메시지 5천 줄.
  v_recent constant integer := 400;
  v_ids uuid[];
  v_seen integer;
  -- 대화 필터(상태 · 건물 · 채널) — 202611180001 의 base 와 같은 조건. 별칭 c.
  v_filter constant text := $f$
    c.organization_id = $1
    and (
      $11 = 'all'
      or ($11 = 'done' and c.status = 'done')
      or ($11 = 'snoozed' and c.status = 'snoozed' and c.snooze_until > $14)
      or ($11 = 'awaiting' and (c.status = 'awaiting' or (c.status = 'snoozed' and (c.snooze_until is null or c.snooze_until <= $14))))
    )
    and ($12 is null or c.property_name = $12)
    and (
      $13 = 'all'
      or ($13 in ('airbnb', 'booking', 'direct') and c.channel = $13)
      or ($13 = 'other' and (c.channel is null or c.channel not in ('airbnb', 'booking', 'direct')))
    )
  $f$;
  -- 이름 · 예약번호 · 건물 · 방 · 전화 · 이메일 중 하나라도 — 예전 fields 의 각 열이 참 · null 아님인 것과 같다. 별칭 c(대화) · r(예약).
  v_field_hit constant text := $f$
    (
      (cardinality($3) > 0 and (
        not exists (select 1 from unnest($3) f where strpos(lower(coalesce(c.guest_name, '')), f) = 0)
        or not exists (select 1 from unnest($3) f where strpos(lower(coalesce(r.guest_name, '')), f) = 0)
      ))
      or ($4 is not null and (
        c.provider_booking_id ilike $4 || '%'
        or r.source_reservation_id ilike $4 || '%'
        or r.original_reservation_id ilike '%' || $4 || '%'
        or (r.raw_payload ->> 'apiReference') ilike '%' || $4 || '%'
      ))
      or ($2 is not null and (c.property_name ilike $2 or c.room_label ilike $2))
      or c.property_name = any ($7)
      or ($5 is not null and ((r.raw_payload ->> 'phone') ilike $5 or (r.raw_payload ->> 'mobile') ilike $5))
      or ($2 is not null and (
        ($6 = 'full' and (r.raw_payload ->> 'email') ilike $2)
        or ($6 = 'local' and split_part(r.raw_payload ->> 'email', '@', 1) ilike $2)
      ))
    )
  $f$;
  -- 검색 대상 메시지(손님 말 · 우리 답장) — 예전 body_hits 의 조건과 같다. 별칭 m.
  -- 코드 가리기: 코드가 없는 글은 가린 글 = 원문이라 이미 맞았다(`!~`) — 정규식 바꾸기는 코드가 든 글에만.
  v_body_hit constant text := $f$
    $8
    and $2 is not null
    and m.organization_id = $1
    and m.direction in ('guest', 'host')
    and m.body ilike $2
    and ($9 is null or m.sent_at >= $9)
    and ($10 is null or m.body !~ $10 or regexp_replace(m.body, $10, '••••', 'g') ilike $2)
  $f$;
begin
  -- 동적 실행(EXECUTE … USING) — 부를 때마다 실제 값으로 계획을 세운다(202611180001 메모 참고). $1 … $15 = 위 인자 순서.
  -- format() 은 조건 글을 %s 로 끼울 뿐이다(값은 모두 USING 으로 — 글로 이어 붙이지 않는다).

  -- 1) 최근 대화 앞 v_recent 개에서 맞는 것 — v_limit 개가 차면 그것이 전체 답의 앞부분과 같다.
  execute format($q$
    with top as materialized (
      select c.id, c.last_message_at, c.guest_name, c.provider_booking_id, c.property_name, c.room_label, c.reservation_id
      from public.guest_conversations c
      where %s
      order by c.last_message_at desc nulls last, c.id
      limit $16
    )
    select coalesce(array_agg(h.id order by h.last_message_at desc nulls last, h.id), '{}'), (select count(*)::integer from top)
    from (
      select c.id, c.last_message_at
      from top c
      left join lateral (
        select r.guest_name, r.source_reservation_id, r.original_reservation_id, r.raw_payload
        from public.reservations r
        where r.id = c.reservation_id and r.organization_id = $1
        limit 1
      ) r on true
      where %s
        or exists (select 1 from public.guest_messages m where m.conversation_id = c.id and %s)
      order by c.last_message_at desc nulls last, c.id
      limit $15
    ) h
  $q$, v_filter, v_field_hit, v_body_hit)
  into v_ids, v_seen
  using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
    p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_limit, v_recent;

  -- 2) 못 채웠고 앞에서 본 것이 대화 전체가 아니었으면(필터에 드는 대화가 v_recent 개 넘음) 전체 — 메시지는 대화 id 만 모은다(본문 정렬 없음).
  if cardinality(v_ids) < v_limit and v_seen >= v_recent then
    execute format($q$
      with base as (
        select c.id, c.last_message_at, c.guest_name, c.provider_booking_id, c.property_name, c.room_label, c.reservation_id
        from public.guest_conversations c
        where %s
      ),
      field_ids as (
        select c.id
        from base c
        left join public.reservations r on r.id = c.reservation_id and r.organization_id = $1
        where %s
      ),
      body_ids as (
        select distinct m.conversation_id as id
        from public.guest_messages m
        where %s
      )
      select coalesce(array_agg(b.id order by b.last_message_at desc nulls last, b.id), '{}')
      from (
        select b.id, b.last_message_at
        from base b
        where b.id in (select id from field_ids union select id from body_ids)
        order by b.last_message_at desc nulls last, b.id
        limit $15
      ) b
    $q$, v_filter, v_field_hit, v_body_hit)
    into v_ids
    using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
      p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_limit;
  end if;

  if cardinality(v_ids) = 0 then
    return;
  end if;

  -- 3) 고른 대화에만 돌려줄 열 — 예전 fields · body_hits(distinct on: sent_at desc, id desc 의 첫 줄)와 같은 값.
  return query execute format($q$
    select
      c.id, c.last_message_at, c.guest_name, r.guest_name,
      coalesce(cardinality($3) > 0 and (
        not exists (select 1 from unnest($3) f where strpos(lower(coalesce(c.guest_name, '')), f) = 0)
        or not exists (select 1 from unnest($3) f where strpos(lower(coalesce(r.guest_name, '')), f) = 0)
      ), false),
      coalesce($4 is not null and (
        c.provider_booking_id ilike $4 || '%%'
        or r.source_reservation_id ilike $4 || '%%'
        or r.original_reservation_id ilike '%%' || $4 || '%%'
        or (r.raw_payload ->> 'apiReference') ilike '%%' || $4 || '%%'
      ), false),
      coalesce(($2 is not null and (c.property_name ilike $2 or c.room_label ilike $2)) or c.property_name = any ($7), false),
      case when $5 is not null and (r.raw_payload ->> 'phone') ilike $5 then r.raw_payload ->> 'phone' end,
      case when $5 is not null and (r.raw_payload ->> 'mobile') ilike $5 then r.raw_payload ->> 'mobile' end,
      coalesce($2 is not null and (
        ($6 = 'full' and (r.raw_payload ->> 'email') ilike $2)
        or ($6 = 'local' and split_part(r.raw_payload ->> 'email', '@', 1) ilike $2)
      ), false),
      h.id, h.direction, h.body
    from unnest($16::uuid[]) with ordinality as x(id, ord)
    join public.guest_conversations c on c.id = x.id and c.organization_id = $1
    left join public.reservations r on r.id = c.reservation_id and r.organization_id = $1
    left join lateral (
      select m.id, m.direction, m.body
      from public.guest_messages m
      where m.conversation_id = c.id and %s
      order by m.sent_at desc, m.id desc
      limit 1
    ) h on true
    order by x.ord
  $q$, v_body_hit)
  using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
    p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_limit, v_ids;
end;
$fn$;

revoke all on function public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer) to service_role;
