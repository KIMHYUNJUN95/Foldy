-- 손님 메시지함 검색 (2026-11-18) — docs/product/47-guest-messaging.md §5-10 · docs/engineering/04-data-model.md
--
-- 목록은 처리 끝 대화를 최근 200개만 읽는다(운영 처리 끝 9,084개). 검색은 서버가 그 조직의 대화 **전체**에서 찾는다.
-- 찾는 곳: 손님 이름(대화 · 예약) · 예약번호(채널 번호 · Beds24 번호) · 건물 · 방 · 전화번호 · 이메일(예약 raw_payload) ·
-- 메시지 내용(손님 말 · 우리 답장만 — 내부 메모 · 시스템 줄은 빼고).
--
-- 1) pg_trgm — `ilike '%…%'` 가 색인을 쓰게. 3글자 이상 검색어만 색인을 쓴다(2글자는 순차 읽기 · 기간 제한 없음 — 로컬 12만 줄에서 약 50~100ms).
-- 2) 메시지 내용 GIN trigram 색인 — guest · host 줄만(부분 색인, 검색 함수의 조건과 같다).
-- 3) 검색 함수 `guest_conversation_search` — security invoker, 조직 id 는 언제나 인자로 받아 건다.
--    실행은 service_role 만(서버 액션이 세션 조직 · 권한을 확인한 뒤 부른다 — authenticated · anon 은 못 부른다).
--    출입 코드를 볼 수 없는 사람이면 앱이 `p_code_mask`(코드 정규식)를 넘긴다 — 메시지(손님 말 · 우리 답장 모두)는 코드를
--    가린 글에서도 맞아야 결과에 든다(코드 숫자로 찾아서 코드를 알아내지 못하게).
--
-- 운영 적용 메모: 색인 만들기는 표를 쓰기 잠금(SHARE)한다 — 그동안 웹훅이 넣는 메시지가 기다린다. 운영에서는 이 파일의
-- 색인 줄 대신 SQL 편집기에서 `create index concurrently …`(트랜잭션 밖, 한 문장씩)를 먼저 돌리면 잠금이 없다.
--
-- 멱등: if not exists · create or replace · revoke/grant 는 다시 돌려도 안전하다.
--
-- 되돌리기:
--   drop function if exists public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer);
--   drop index if exists public.guest_messages_body_trgm_idx;
--   (pg_trgm 은 남겨도 된다)

create extension if not exists pg_trgm with schema extensions;

create index if not exists guest_messages_body_trgm_idx
  on public.guest_messages using gin (body extensions.gin_trgm_ops)
  where direction in ('guest', 'host');

create or replace function public.guest_conversation_search(
  p_organization_id uuid,
  -- 검색어 전체를 `%…%` 로 감싼 ilike 패턴(\ · % · _ 는 앱이 \ 로 막아 보낸다). 비우면 건물 · 방 · 이메일 · 내용은 안 본다.
  p_like text,
  -- 이름 후보 — 조각(소문자)이 모두 이름에 있어야 한다. 최종 판정은 앱(`matchesGuestName`).
  p_name_fragments text[] default '{}',
  -- 예약번호(영숫자 · 하이픈 4자 이상).
  p_reference text default null,
  -- 전화번호 넓은 거름(`%9%0%…%`) — 최종 판정은 앱(`matchesDigits`).
  p_phone_pattern text default null,
  -- 이메일: 'full' = 주소 전체, 'local' = @ 앞만(도메인 `airbnb.com` 같은 것에 모두 걸리지 않게), null = 안 봄.
  p_email text default null,
  -- 보는 사람 언어(ja · en) 건물 이름으로 친 경우 — 앱이 정본(ko) 이름으로 바꿔 보낸다.
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
begin
  -- 동적 실행(EXECUTE … USING) — 부를 때마다 실제 값으로 계획을 세운다. 인자를 모르는 일반 계획은 대화 수를 1로 잡아
  -- 대화마다 trigram 색인을 다시 읽었다(로컬 12만 줄에서 2분 넘게). $1 … $15 = 위 인자 순서.
  return query execute $q$
  with base as (
    select c.id, c.last_message_at, c.guest_name, c.provider_booking_id, c.property_name, c.room_label, c.reservation_id
    from public.guest_conversations c
    where c.organization_id = $1
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
  ),
  fields as (
    select
      b.id,
      b.last_message_at,
      b.guest_name,
      r.guest_name as reservation_guest_name,
      cardinality($3) > 0 and (
        not exists (select 1 from unnest($3) f where strpos(lower(coalesce(b.guest_name, '')), f) = 0)
        or not exists (select 1 from unnest($3) f where strpos(lower(coalesce(r.guest_name, '')), f) = 0)
      ) as name_hit,
      $4 is not null and (
        b.provider_booking_id ilike $4 || '%'
        or r.source_reservation_id ilike $4 || '%'
        or r.original_reservation_id ilike '%' || $4 || '%'
        or (r.raw_payload ->> 'apiReference') ilike '%' || $4 || '%'
      ) as reference_hit,
      ($2 is not null and (b.property_name ilike $2 or b.room_label ilike $2))
        or b.property_name = any ($7) as place_hit,
      case when $5 is not null and (r.raw_payload ->> 'phone') ilike $5 then r.raw_payload ->> 'phone' end as phone,
      case when $5 is not null and (r.raw_payload ->> 'mobile') ilike $5 then r.raw_payload ->> 'mobile' end as mobile,
      $2 is not null and (
        ($6 = 'full' and (r.raw_payload ->> 'email') ilike $2)
        or ($6 = 'local' and split_part(r.raw_payload ->> 'email', '@', 1) ilike $2)
      ) as email_hit
    from base b
    left join public.reservations r on r.id = b.reservation_id and r.organization_id = $1
  ),
  body_hits as (
    select distinct on (m.conversation_id) m.conversation_id, m.id, m.direction, m.body
    from public.guest_messages m
    where $8
      and $2 is not null
      and m.organization_id = $1
      and m.direction in ('guest', 'host')
      and m.body ilike $2
      and ($9 is null or m.sent_at >= $9)
      and ($10 is null or regexp_replace(m.body, $10, '••••', 'g') ilike $2)
    order by m.conversation_id, m.sent_at desc, m.id desc
  )
  select
    f.id, f.last_message_at, f.guest_name, f.reservation_guest_name,
    coalesce(f.name_hit, false), coalesce(f.reference_hit, false), coalesce(f.place_hit, false),
    f.phone, f.mobile, coalesce(f.email_hit, false),
    h.id, h.direction, h.body
  from fields f
  left join body_hits h on h.conversation_id = f.id
  where f.name_hit or f.reference_hit or f.place_hit or f.phone is not null or f.mobile is not null or f.email_hit or h.id is not null
  order by f.last_message_at desc nulls last, f.id
  limit least(greatest(coalesce($15, 80), 1), 200)
  $q$
  using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
    p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, p_limit;
end;
$fn$;

revoke all on function public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer) to service_role;
