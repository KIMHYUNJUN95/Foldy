-- 손님 메시지함 이름 검색 — 이름은 DB 에서 정확히, 이름 히트 먼저 (2026-11-20) — docs/product/47-guest-messaging.md §5-10 · docs/engineering/04-data-model.md
--
-- 문제(운영 실측): 같은 손님이 성만 · 이름만 치면 나올 때도 있고 안 나올 때도 있었다.
--   DB 는 검색어 단어의 앞 2글자 · 뒤 2글자 조각이 `lower(guest_name)` 에 들었는지만 보는 느슨한 조건이었고, 메시지 내용 · 건물 히트와
--   같은 80칸을 최신순으로 나눠 썼다. 정확한 이름 확인(`matchesGuestName`)은 80개로 자른 **뒤** 앱에서 했다 → 진짜 이름이 맞는 오래된
--   대화가 잘렸다. DB 는 날것 lower, 앱은 NFKC · 악센트 제거 · 기호→공백이라 「José」 · 「O'Brien」 · 전각 이름도 DB 에서 먼저 빠졌다.
--
-- 이 파일:
--   1) 이름 정리 함수 `guest_search_normalize` — 앱 `normalizeGuestText`(src/lib/guest-search.ts)와 **글자까지 같은** 규칙
--      (200글자에서 자름 → NFKC → 소문자 · ς→σ → 악센트 제거 → 기호 . , · ・ ' ’ " ( ) - _ / 를 공백으로 → 공백 하나로 → 앞뒤 공백 제거).
--   2) 이름 열쇠 `guest_name_search_key` — 정리한 이름의 단어를 앱 `matchesGuestName` 이 보는 **모든 순서**로 붙여 쓴 것을 공백으로 이은 글
--      (단어 5개 · 붙인 글자 40자까지는 모든 순서, 넘으면 원래 순서 · 거꾸로 — 앱과 같다. 열쇠는 최대 약 4.9천 글자). 예) 「Kim Minsu」 → 「kimminsu minsukim」.
--   3) 검색어 → 단어별 like 조각 `guest_name_search_patterns`, 판정 `guest_name_search_match`(검사 · 점검용).
--   4) 그 열쇠를 **저장 칸** `guest_conversations.guest_name_key`(generated always … stored)로 두고 그 칸에 trigram GIN 색인
--      `guest_conversations_name_key_trgm_idx`. 줄을 넣거나 이름이 바뀔 때 한 번만 계산된다 — 검색 때는 함수를 다시 돌리지 않는다.
--      (검토 중 한때 쓴 식 색인 `guest_conversations_name_search_trgm_idx` 는 2글자 검색이 모든 줄에서 함수를 돌려 느려 지운다.)
--   5) 검색 함수 `guest_conversation_search` — 같은 이름 · 같은 인자 · 같은 돌려주는 열. 찾는 순서만 바뀐다:
--      A. 이름 — 검색어(= `p_like` 를 풀어 같은 규칙으로 정리)의 **단어마다** 저장 칸 `guest_name_key` 에 들어 있는 대화를
--         최신순 `p_limit` 개까지(색인). 정리 뒤 붙인 글자가 2자 미만(예: 「J.」)이면 이름으로는 찾지 않는다(앱과 같다).
--      B. A 가 칸을 다 못 채웠을 때만 — 남는 칸만큼 예약번호 · 건물 · 방 · 전화 · 이메일 · 메시지 내용(예전처럼 최근 400개 먼저 → 전체).
--         예약 이름은 대화 이름과 **다를 때만** 같은 판정으로 본다(운영 0건 — 같으면 A 가 이미 봤다). 그래서 **예약 이름으로만 맞는 대화**는
--         B 에서 나온다 — 이름 히트 뒤에 붙고, 이름 히트가 80칸을 다 채우면 빠진다(운영 0건이라 지금은 차이 없음, 47 §5-10).
--         열쇠를 계산하기 전에 「붙인 검색어의 글자가 정리한 예약 이름에 다 들어 있나」를 먼저 본다(필요조건 — 결과는 같고 계산만 준다).
--      C. A 다음 B 순서로 돌려줄 열을 만든다(예전과 같은 열 · 같은 맞은 말 고르기 · 같은 코드 가리기).
--
-- 판정은 앱 `matchesGuestName` 과 **똑같다**: 앱은 ① 검색어 단어가 모두 「이름 단어를 원래 순서로 붙인 글」 안에 있거나
--   ② 검색어를 붙인 글이 「이름 단어를 어떤 순서로 붙인 글」 안에 있으면 참이다. 열쇠의 첫 덩이(`split_part(열쇠, ' ', 1)`)가 ①의
--   「원래 순서로 붙인 글」이고, 열쇠 전체는 ②의 「모든 순서로 붙인 글」을 공백으로 이은 것이다(붙인 검색어에는 공백이 없어 덩이를 건너
--   맞을 수 없다). 그래서 DB 는 `split_part(열쇠,' ',1) like all(단어 조각) or 열쇠 like '%붙인 검색어%'` 를 본다. 색인은 그 필요조건
--   「단어마다 열쇠에 있음」(`열쇠 like 조각[i]` and …)으로 고르고 위 조건으로 다시 확인한다. 같은 사례표를 앱 · DB 양쪽에 돌려
--   **결과가 똑같은지** 보는 테스트(src/lib/__tests__/guest-name-cases.ts · guest-message-search-sql.test.ts)가 묶는다.
--   정리 규칙이 같다는 것은 C.UTF-8(PGlite)에서 무작위 4,000건으로 확인했다. 운영(en_US.UTF-8)에서는 대조하지 않았다 — lower() 가 로캘을
--   따르므로 적용 뒤 `select public.guest_name_search_match('검색어', '이름')` 로 사례 몇 개(전각 · 악센트 · 그리스 Σ)를 확인한다.
--
-- 앱과 DB 적용 순서가 어긋나도 된다:
--   · 옛 앱 + 이 함수 — 옛 앱도 같은 인자를 보낸다. 이름 단어는 `p_like`(검색어 전체)에서 꺼내므로 옛 앱에서도 이름 히트가 먼저 · 정확해진다.
--   · 새 앱 + 옛 함수(202611200001) — 새 앱은 인자 모양을 바꾸지 않았다(`p_name_fragments` 도 예전 조각). 옛 함수는 예전 방식(느슨한 조각 ·
--     여러 히트가 80칸을 최신순으로 나눔)으로 찾고, 앱은 받은 줄 안에서 이름 히트를 앞으로 올릴 뿐이다 — 80칸 밖으로 밀린 오래된 이름 히트는
--     이 함수를 적용해야 나온다. 그래서 DB 를 먼저 적용한다.
--   · 이 함수에서는 이름 히트가 80칸을 다 채우면 메시지 내용 · 건물 · 번호 히트가 그 검색에서 빠진다(이름 먼저 — 승인된 동작, 47 §5-10).
--
-- 권한 · 조직 범위 · 코드 가리기(`p_code_mask`)는 예전과 같다: 검색 함수는 security invoker · search_path '' · 실행은 service_role 만.
--   조각 · 판정 함수(3 · 4)도 PUBLIC · anon · authenticated 실행을 거두고 service_role 만 둔다(파일 끝).
--   정리 · 열쇠 함수(1 · 2)는 **authenticated 에도 실행을 준다** — 대화 표에는 BEFORE UPDATE 트리거(guest_conversations_set_updated_at)가
--   있고, 그런 트리거가 있으면 Postgres 는 어느 칸을 고치든 저장 칸을 다시 계산한다. 직원이 상태 · 나중에 두 칸(202611120002)만 고쳐도
--   그 사용자 권한으로 열쇠 함수(→ 정리 함수)가 돌아, 권한이 없으면 「처리 끝」 · 「나중에」가 실패한다. 두 함수는 표를 읽지 않는 순수 글
--   함수(입력 200자에서 자름 · 순서 수 상한)라 실행을 줘도 새로 보이는 데이터가 없다. anon 은 계속 막는다(대화 표를 고칠 수 없다).
--   (트리거로 계산하는 방법도 있지만, 검토를 마친 저장 칸 설계를 그대로 두는 쪽이 바뀌는 곳이 적다.) 테스트가 운영과 같은 트리거로 묶는다.
--
-- ⚠ 정리 · 열쇠 함수를 바꾸면 저장 칸을 다시 계산해야 한다(색인 포함) — 함수만 바꾸면 저장된 값은 예전 규칙 그대로다.
--   Postgres 메이저 판 · glibc/ICU 판을 올린 뒤에도 같다(lower() · normalize() 가 로캘 · 유니코드 판을 따른다).
--   앱 normalizeGuestText · matchesGuestName(src/lib/guest-search.ts)과 **같이** 바꾸고, 새 마이그레이션에서 한 트랜잭션으로 칸을 다시 만든다:
--     begin; set local lock_timeout = '3s';
--     alter table public.guest_conversations drop column guest_name_key;   -- 색인도 함께 지워진다
--     alter table public.guest_conversations add column guest_name_key text generated always as (public.guest_name_search_key(guest_name)) stored;
--     create index guest_conversations_name_key_trgm_idx on public.guest_conversations using gin (guest_name_key extensions.gin_trgm_ops);
--     commit;
--   (PG17 이면 `alter table … alter column guest_name_key set expression as (…)` 도 된다.) `update … set guest_name = guest_name` 은 쓰지 않는다 —
--   모든 줄의 updated_at 이 바뀌고(트리거), 실시간 알림 트리거(202611160001)가 줄마다 돌고, 모든 줄을 잠근다. 위 방법은 줄 트리거가 돌지 않는다.
--
-- 잠금 · 시간(대화 9,200줄 · 운영과 같은 규모 · PGlite 실측 2026-11-20 — **숫자는 예시(환경마다 다름)**):
--   · 파일 맨 위 `set lock_timeout = '3s'`(끝에서 reset) — 표 잠금을 3초 안에 못 얻으면 그 문장이 실패한다. 대시보드 SQL 편집기는 파일을
--     한 번에 보내 한 트랜잭션으로 돌린다고 **가정한다**(확인한 동작이 아니라 가정) — 그러면 모두 되돌려진다 → 한가할 때 다시 돌린다.
--     잠금을 기다리는 동안에도 뒤에 오는 읽기 · 쓰기가 그 뒤에 줄을 서므로 오래 기다리게 두지 않는다.
--   · `add column … generated … stored` 는 표를 **다시 쓴다** — ACCESS EXCLUSIVE 잠금, 줄마다 열쇠 계산(그 문장만 예: 505ms).
--     파일 전체가 한 트랜잭션이므로 이 잠금은 **커밋까지** 쥔 채다 — 색인 · 함수 · 권한 · analyze 가 끝날 때까지 웹훅 · 화면의 읽기 · 쓰기가
--     **모두 기다린다**(잠금 대기 최대 3초 + 파일 전체 약 0.6초 — 화면이 잠깐 멈출 수 있다).
--   · 색인 만들기 자체는 SHARE 잠금이지만 위 ACCESS EXCLUSIVE 를 이미 쥔 안에서 돈다(예: 50ms, 칸 값을 읽기만 한다).
--   · 실측 예(두 번 잰 값 — 환경마다 다름): 파일 전체 610ms / 817ms · 색인 632kB / 728kB ·
--     열쇠 길이 최대 3,119자 / 2,879자 · 평균 60자 / 116자(이론상 최대 약 4,900자 — 단어 5개 · 붙인 글자 40자 상한).
--   · 함수만 바꾸는 부분 · revoke/grant · analyze 는 그것만으로는 표 잠금이 짧다(이 파일에선 위 잠금 안에서 돈다).
--   · 끝의 `reset lock_timeout` 은 이 세션에서 **먼저 손으로 set 한 값도 지운다**(역할 · DB 기본값으로 돌아감). `set local` 을 쓰지 않는
--     까닭: 트랜잭션 밖에서 돌면(psql -f 등) `set local` 은 경고만 내고 아무 효과가 없어 3초 보호가 사라진다.
--   웹훅이 몰리는 때를 피해 한가한 시간에 돌리고, 결과 줄(성공)을 확인한다.
--
-- 적용 순서: **DB 먼저, 그다음 앱 배포.** 새 앱은 이 함수 · 칸이 없어도 깨지지 않지만(위), 칸은 앱이 읽지 않는다(검색 함수 안에서만 쓴다).
--
-- 멱등: create or replace · if not exists · drop … if exists · revoke/grant — 다시 돌려도, 한 트랜잭션에서 두 번 돌려도 안전하다(테스트).
--   대시보드 SQL 편집기에 통째로 붙여 한 번에 돌린다.
--
-- 되돌리기(**반드시 이 순서** — 칸이 열쇠 함수를 쓰므로 칸 · 색인을 먼저 지우고 함수는 맨 나중):
--   1) 202611200001_guest_message_search_perf.sql 을 통째로 다시 돌린다(검색 함수가 예전 것으로 돌아간다 — 칸을 쓰지 않는 판).
--   2) drop index if exists public.guest_conversations_name_key_trgm_idx;
--      alter table public.guest_conversations drop column if exists guest_name_key;   -- 표를 다시 쓰지 않는다(빠름), ACCESS EXCLUSIVE 잠깐
--   3) drop function if exists public.guest_name_search_match(text, text);
--      drop function if exists public.guest_name_search_patterns(text);
--      drop function if exists public.guest_name_search_key(text);
--      drop function if exists public.guest_search_normalize(text);
--   ⚠ CASCADE 를 붙이지 않는다(열쇠 함수에 붙이면 칸까지 지워진다). 또 정리 함수를 칸보다 **먼저** 지우면 오류 없이 지워진다(plpgsql 열쇠
--     함수 속 호출은 의존으로 기록되지 않는다) — 그 뒤 대화 표의 모든 쓰기(웹훅 · 상태 바꾸기)가 실패한다. 2) 를 끝낸 뒤에 3) 을 한다.

-- 표 잠금을 오래 기다리지 않는다(위 「잠금 · 시간」). 파일 끝에서 되돌린다.
set lock_timeout = '3s';

create extension if not exists pg_trgm with schema extensions;

-- 1) 이름 · 검색어 정리 — 앱 normalizeGuestText 와 같은 순서 · 같은 글자.
--    정리 전 200글자에서 자른다(앱 GUEST_NORMALIZE_MAX_CHARS). 그리스 끝 시그마 ς 는 σ 로(JS toLowerCase 는 낱말 끝 Σ 를 ς 로,
--    Postgres lower 는 σ 로 바꿔서 — 양쪽을 σ 로 맞춘다).
--    공백 글자는 JS `\s` 와 같은 목록을 그대로 적는다(Postgres `\s` 는 로캘에 따라 달라서).
create or replace function public.guest_search_normalize(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select btrim(
    regexp_replace(
      regexp_replace(
        normalize(
          regexp_replace(normalize(replace(lower(normalize(left(coalesce(p_value, ''), 200), nfkc)), 'ς', 'σ'), nfd), '[̀-ͯ]+', '', 'g'),
          nfc
        ),
        '[.,·・''’"()_/-]+', ' ', 'g'
      ),
      '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'
    ),
    ' '
  )
$fn$;

-- 2) 이름 열쇠 — 정리한 이름 단어를 앱 matchesGuestName 의 순서들로 붙여 쓴 것들, 공백으로 이음.
create or replace function public.guest_name_search_key(p_name text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  v_tokens text[];
  v_n integer;
  v_out text;
begin
  v_tokens := array_remove(string_to_array(public.guest_search_normalize(p_name), ' '), '');
  v_n := coalesce(cardinality(v_tokens), 0);
  if v_n = 0 then
    return '';
  elsif v_n = 1 then
    return v_tokens[1];
  elsif v_n > 5 or char_length(array_to_string(v_tokens, '')) > 40 then
    -- 앱: 6단어부터 · 단어를 붙인 글자가 40자 넘으면 원래 순서와 거꾸로만(GUEST_PERMUTE_MAX_COMPACT_CHARS — 열쇠 크기 상한).
    return array_to_string(v_tokens, '') || ' '
      || (select string_agg(u.t, '' order by u.i desc) from unnest(v_tokens) with ordinality as u(t, i));
  end if;
  with recursive perm(idx) as (
    select array[g.i] from generate_series(1, v_n) as g(i)
    union all
    select p.idx || g.i
    from perm p
    cross join generate_series(1, v_n) as g(i)
    where cardinality(p.idx) < v_n and g.i <> all (p.idx)
  )
  select string_agg((select string_agg(v_tokens[u.j], '' order by u.o) from unnest(p.idx) with ordinality as u(j, o)), ' ' order by p.idx)
  into v_out
  from perm p
  where cardinality(p.idx) = v_n;
  return v_out;
end;
$fn$;

-- 3) 검색어 → 이름 like 조각(단어마다 `%단어%`, \ % _ 는 막음). 단어를 붙인 글자가 2자 미만이면 빈 배열(이름으로 안 찾음 — 앱과 같다).
create or replace function public.guest_name_search_patterns(p_query text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  with t as (
    select array_remove(string_to_array(public.guest_search_normalize(p_query), ' '), '') as tokens
  )
  select case
    when char_length(array_to_string(t.tokens, '')) < 2 then '{}'::text[]
    else array(
      select '%' || replace(replace(replace(u.tok, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      from unnest(t.tokens) with ordinality as u(tok, i)
      order by u.i
    )
  end
  from t
$fn$;

-- 4) DB 이름 판정(검사 · 점검용) — 검색 함수 A 단계와 같은 조건 = 앱 matchesGuestName 과 같은 판정(**검색어 2글자 이상일 때만** —
--    앱은 2글자 미만이면 찾지 않고(normalizeSearchQuery → null), 이 함수는 1글자도 판정하므로 그때는 서로 다를 수 있다):
--    ① 열쇠 첫 덩이(원래 순서로 붙인 이름)에 단어가 모두 있음, 또는 ② 열쇠(모든 순서) 안에 붙인 검색어가 있음.
--    붙인 검색어 like 조각 = 단어 조각의 가운데(막음 처리된 단어)를 이어 붙인 것 — 막음은 글자마다라 이어 붙여도 같다.
create or replace function public.guest_name_search_match(p_query text, p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  with q as (
    select public.guest_name_search_patterns(p_query) as pats
  ), k as (
    select public.guest_name_search_key(p_name) as key
  )
  select cardinality(q.pats) > 0
    and k.key like all (q.pats)
    and (
      split_part(k.key, ' ', 1) like all (q.pats)
      or k.key like '%' || (select string_agg(substr(p, 2, char_length(p) - 2), '' order by i) from unnest(q.pats) with ordinality as u(p, i)) || '%'
    )
  from q, k
$fn$;

-- 5) 이름 열쇠 저장 칸 + 그 칸의 trigram 색인. 식 색인(검토 중 한때 만든 guest_conversations_name_search_trgm_idx)은 지운다 —
--    식 색인은 2글자 검색(trigram 못 씀)마다 모든 줄에서 열쇠 함수를 다시 돌려 느렸다(대화 9천 줄 기준 420~460ms).
--    ⚠ 정리 · 열쇠 함수(1 · 2)를 바꾸면 이 칸을 다시 계산해야 한다(색인 포함) — 함수만 바꿔서는 저장된 값이 그대로다.
--      앱 normalizeGuestText · matchesGuestName(src/lib/guest-search.ts)과 같이 바꾸고, 새 마이그레이션에서 칸을 지우고 다시 만든다
--      (파일 머리의 「⚠」 절차 — `update … set guest_name = guest_name` 은 쓰지 않는다).
drop index if exists public.guest_conversations_name_search_trgm_idx;

alter table public.guest_conversations
  add column if not exists guest_name_key text
    generated always as (public.guest_name_search_key(guest_name)) stored;

create index if not exists guest_conversations_name_key_trgm_idx
  on public.guest_conversations using gin (guest_name_key extensions.gin_trgm_ops);

create or replace function public.guest_conversation_search(
  p_organization_id uuid,
  -- 검색어 전체를 `%…%` 로 감싼 ilike 패턴(\ · % · _ 는 앱이 \ 로 막아 보낸다). 이름 단어도 여기서 꺼낸다.
  p_like text,
  -- 예전 앱이 보내는 이름 조각 — `p_like` 가 없을 때만 이름 단어로 쓴다.
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
  -- B 단계에서 먼저 볼 최근 대화 수(202611200001 과 같다).
  v_recent constant integer := 400;
  v_query text;
  v_patterns text[];
  -- 붙인 검색어 — like 조각(막음 처리 · % … %)과 날것(글자 거름용).
  v_compact_like text;
  v_compact text;
  v_name_cond text;
  v_name_ids uuid[] := '{}';
  v_rest_ids uuid[] := '{}';
  v_need integer;
  v_seen integer := 0;
  v_ids uuid[];
  -- 대화 필터(상태 · 건물 · 채널) — 202611200001 과 같다. 별칭 c.
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
  -- 예약 이름이 대화 이름과 다를 때만 — A 와 같은 판정(조각 $17 · 붙인 검색어 $19). 별칭 c · r.
  --   열쇠(모든 순서)를 만들기 전에 필요조건을 먼저 본다: 붙인 검색어($20)의 글자가 정리한 예약 이름에 모두 있어야 ① · ② 어느 쪽도
  --   맞을 수 있다(① 단어들이 이름 안에 · ② 붙인 검색어가 이름 단어들을 이은 글 안에). 대부분의 줄이 여기서 열쇠 계산 없이 빠진다.
  v_reservation_name constant text := $f$
    (cardinality($17) > 0 and r.guest_name is not null and r.guest_name is distinct from c.guest_name
      and (
        select not exists (select 1 from regexp_split_to_table($20, '') as ch(c) where strpos(z.n, ch.c) = 0)
        from (select public.guest_search_normalize(r.guest_name) as n) z
      )
      and (
        select k.key like all ($17) and (split_part(k.key, ' ', 1) like all ($17) or k.key like $19)
        from (select public.guest_name_search_key(r.guest_name) as key) k
      ))
  $f$;
  -- 이름 밖 찾는 곳 — 예약번호 · 건물 · 방 · 전화 · 이메일(202611200001 의 v_field_hit 에서 대화 이름 조각만 뺐다 — A 가 정확히 본다).
  v_field_hit constant text := $f$
    (
      ($4 is not null and (
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
  -- 검색 대상 메시지(손님 말 · 우리 답장) — 202611200001 과 같다. 별칭 m.
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
  -- 동적 실행(EXECUTE … USING) — 부를 때마다 실제 값으로 계획을 세운다(202611180001 메모). 값은 모두 USING 으로 넘긴다.
  -- $1 … $14 = 인자 순서, $15 = 이번 단계 개수, $16 = v_recent(C 에서는 고른 대화), $17 = 이름 조각, $18 = A 에서 고른 대화,
  --   $19 = 붙인 검색어 like 조각, $20 = 붙인 검색어 날것(예약 이름 글자 거름).

  -- 이름 단어: 검색어 전체(`p_like` 의 % … % 를 벗기고 \ 막음을 푼 것). 없으면 예전 조각.
  if p_like is not null and char_length(p_like) >= 2 and p_like like '\%%\%' then
    v_query := regexp_replace(substr(p_like, 2, char_length(p_like) - 2), '\\(.)', '\1', 'g');
  else
    v_query := array_to_string(p_name_fragments, ' ');
  end if;
  v_patterns := public.guest_name_search_patterns(v_query);
  -- 붙인 검색어 — 조각 가운데(막음 처리된 단어)를 이어 붙인다(guest_name_search_match 와 같다). 날것은 정리한 단어를 이어 붙인 것.
  select '%' || string_agg(substr(u.p, 2, char_length(u.p) - 2), '' order by u.i) || '%'
  into v_compact_like
  from unnest(v_patterns) with ordinality as u(p, i);
  v_compact := replace(public.guest_search_normalize(v_query), ' ', '');

  -- A) 이름 — 단어마다 저장 칸 `c.guest_name_key like $17[i]` 를 and 로 펼친다(GIN 색인은 like all(배열)을 못 쓴다). 숫자 i 만 끼운다.
  --    색인으로 고른 줄을 앱과 같은 판정으로 다시 확인한다: 첫 덩이(원래 순서)에 단어가 모두 있거나 열쇠에 붙인 검색어($19)가 있음.
  if cardinality(v_patterns) > 0 then
    select string_agg(format('c.guest_name_key like $17[%s]', g.i), ' and ' order by g.i)
      || ' and (split_part(c.guest_name_key, '' '', 1) like all ($17) or c.guest_name_key like $19)'
    into v_name_cond
    from generate_series(1, cardinality(v_patterns)) as g(i);

    execute format($q$
      select coalesce(array_agg(a.id order by a.last_message_at desc nulls last, a.id), '{}')
      from (
        select c.id, c.last_message_at
        from public.guest_conversations c
        where %s and %s
        order by c.last_message_at desc nulls last, c.id
        limit $15
      ) a
    $q$, v_filter, v_name_cond)
    into v_name_ids
    using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
      p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_limit, v_recent, v_patterns, v_name_ids, v_compact_like, v_compact;
  end if;

  v_need := v_limit - cardinality(v_name_ids);

  -- B) 이름으로 칸이 다 차지 않았을 때만 — 남는 칸만큼 이름 밖 히트 · 메시지 내용. A 에서 고른 대화는 뺀다.
  if v_need > 0 then
    -- B-1) 최근 대화 앞 v_recent 개에서 — 남는 칸이 다 차면 그것이 답의 나머지다(그 뒤 대화는 모두 더 오래됐다).
    execute format($q$
      with top as materialized (
        select c.id, c.last_message_at, c.guest_name, c.provider_booking_id, c.property_name, c.room_label, c.reservation_id
        from public.guest_conversations c
        where %s
        order by c.last_message_at desc nulls last, c.id
        limit $16
      )
      select coalesce((
        select array_agg(h.id order by h.last_message_at desc nulls last, h.id)
        from (
          select c.id, c.last_message_at
          from top c
          left join lateral (
            select r.guest_name, r.source_reservation_id, r.original_reservation_id, r.raw_payload
            from public.reservations r
            where r.id = c.reservation_id and r.organization_id = $1
            limit 1
          ) r on true
          where c.id <> all ($18)
            and (
              %s
              or %s
              or exists (select 1 from public.guest_messages m where m.conversation_id = c.id and %s)
            )
          order by c.last_message_at desc nulls last, c.id
          limit $15
        ) h
      ), '{}'), (select count(*)::integer from top)
    $q$, v_filter, v_field_hit, v_reservation_name, v_body_hit)
    into v_rest_ids, v_seen
    using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
      p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_need, v_recent, v_patterns, v_name_ids, v_compact_like, v_compact;

    -- B-2) 못 채웠고 앞에서 본 것이 필터 안 대화 전체가 아니었으면 전체에서 — 메시지는 대화 id 만 모은다.
    if cardinality(v_rest_ids) < v_need and v_seen >= v_recent then
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
          where %s or %s
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
          where b.id <> all ($18)
            and b.id in (select id from field_ids union select id from body_ids)
          order by b.last_message_at desc nulls last, b.id
          limit $15
        ) b
      $q$, v_filter, v_field_hit, v_reservation_name, v_body_hit)
      into v_rest_ids
      using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
        p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_need, v_recent, v_patterns, v_name_ids, v_compact_like, v_compact;
    end if;
  end if;

  v_ids := v_name_ids || v_rest_ids;
  if cardinality(v_ids) = 0 then
    return;
  end if;

  -- C) 고른 대화에만 돌려줄 열 — A(이름) 다음 B 순서. 맞은 말은 예전과 같다(맞는 메시지 중 sent_at desc, id desc 첫 줄).
  return query execute format($q$
    select
      c.id, c.last_message_at, c.guest_name, r.guest_name,
      coalesce(c.id = any ($18) or %s, false),
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
  $q$, v_reservation_name, v_body_hit)
  using p_organization_id, p_like, p_name_fragments, p_reference, p_phone_pattern, p_email, p_place_names, p_body,
    p_body_since, p_code_mask, p_status, p_building, p_channel, p_now, v_limit, v_ids, v_patterns, v_name_ids, v_compact_like, v_compact;
end;
$fn$;

revoke all on function public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer) to service_role;

-- 도우미 함수 4개 — 표를 읽지 않는 순수 글 함수지만 PUBLIC 기본 실행 권한은 거둔다(anon 이 REST /rpc 로 부를 이유가 없다).
--   정리 · 열쇠 함수는 authenticated 에도 준다: 대화 표의 BEFORE UPDATE 트리거(guest_conversations_set_updated_at) 때문에 직원이
--   상태 · 나중에 두 칸만 고쳐도 Postgres 가 저장 칸을 그 사용자 권한으로 다시 계산한다(파일 머리 「권한」). 조각 · 판정은 service_role 만.
revoke all on function public.guest_search_normalize(text) from public, anon, authenticated;
revoke all on function public.guest_name_search_key(text) from public, anon, authenticated;
revoke all on function public.guest_name_search_patterns(text) from public, anon, authenticated;
revoke all on function public.guest_name_search_match(text, text) from public, anon, authenticated;
grant execute on function public.guest_search_normalize(text) to authenticated, service_role;
grant execute on function public.guest_name_search_key(text) to authenticated, service_role;
grant execute on function public.guest_name_search_patterns(text) to service_role;
grant execute on function public.guest_name_search_match(text, text) to service_role;

reset lock_timeout;

-- 새 칸 · 새 색인의 통계(계획이 처음부터 색인을 고르게).
analyze public.guest_conversations;
