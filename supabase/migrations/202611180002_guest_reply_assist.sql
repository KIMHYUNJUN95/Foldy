-- 손님 메시지 AI 답장 도우미 (2026-11-18) — docs/product/49-guest-message-ai-reply-assist.md §8 · docs/engineering/04-data-model.md
--
-- 1) pgvector(`extensions` 스키마) — 뜻 숫자(임베딩, Voyage `voyage-4` 1024차원)를 같은 DB 안에서 찾는다.
-- 2) guest_reply_pairs — 손님 질문 메시지 하나(+ 12시간 안 우리 첫 답). 질문 글은 출입 코드를 가린 것, 답은 가리기 규칙 뒤(49 §8-3).
--    질문 줄은 대화를 열 때(답장 권한 있는 사람만) 생기고, 답은 보낼 때 · 백필이 채운다.
-- 3) guest_saved_reply_embeddings — 정해 둔 문구의 뜻 숫자. 문구가 바뀌면(body_hash 다름) 다시 만든다. 문구를 지우면 같이 지운다.
-- 4) guest_reply_assist_events — 도우미 기록(초안 · 직접 확인 · 틀렸어요 · 그대로 보냄 · 고쳐 보냄 · 버림) + 비용(한 달 상한).
--    초안 글 자체는 남기지 않는다 — 비교용 해시(`draft_hash`)와 남은 자리 표시(`placeholders`)만.
-- 5) guest_reply_similar — 비슷한 과거 질문(같은 조직 · 답 있음 · 기간 안). 같은 건물이면 거리에서 0.03 뺀다.
-- 6) guest_reply_assist_cost_since — 이번 달 비용 합(모든 조직 — Anthropic 키 하나를 같이 쓴다, DeepL 한도와 같은 방식).
-- 7) guest_reply_assist_reserve — 초안을 부르기 전 한도 확인 + 비용 잡아 두기(`pending` 줄)를 잠금 하나 안에서.
--    부른 뒤 서버가 그 줄을 실제 결과(draft · direct · failed)와 실제 비용으로 바꾼다. 서버가 중간에 죽으면 잡아 둔 값이 남는다(한도 쪽으로 안전).
--
-- 권한: 세 표 모두 RLS 켬 · 정책 없음 · service_role 만(손님 메시지 표와 같은 방식 — 서버 액션이 세션 조직 · 권한을 본 뒤 읽는다).
-- 함수는 security invoker · service_role 만 실행. 조직 id 는 언제나 인자로 받아 건다.
--
-- 운영 적용 메모: 표가 새로 생기는 것이라 잠금 걱정은 없다. HNSW 색인은 빈 표에 만들고 백필이 채운다(줄마다 색인이 늘어난다).
--
-- 멱등: if not exists · create or replace · revoke/grant 는 다시 돌려도 안전하다.
--
-- 되돌리기:
--   drop function if exists public.guest_reply_assist_reserve(uuid, uuid, uuid, uuid, uuid, timestamptz, bigint, bigint);
--   drop function if exists public.guest_reply_assist_cost_since(timestamptz);
--   drop function if exists public.guest_reply_similar(uuid, extensions.vector, text, timestamptz, timestamptz, integer);
--   drop table if exists public.guest_reply_assist_events;
--   drop table if exists public.guest_saved_reply_embeddings;
--   drop table if exists public.guest_reply_pairs;
--   (vector 확장은 남겨도 된다)

create extension if not exists vector with schema extensions;

create table if not exists public.guest_reply_pairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  question_message_id uuid not null references public.guest_messages(id) on delete cascade,
  conversation_id uuid not null references public.guest_conversations(id) on delete cascade,
  property_name text,
  asked_at timestamptz not null,
  question_text text not null,
  reply_message_id uuid references public.guest_messages(id) on delete set null,
  reply_text text,
  embedding extensions.vector(1024),
  embed_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_reply_pairs_question_unique unique (question_message_id),
  constraint guest_reply_pairs_embedding_model check (embedding is null or embed_model is not null)
);

create index if not exists guest_reply_pairs_org_asked_idx
  on public.guest_reply_pairs (organization_id, asked_at desc);
create index if not exists guest_reply_pairs_conversation_idx
  on public.guest_reply_pairs (conversation_id, asked_at desc);
create index if not exists guest_reply_pairs_embedding_hnsw
  on public.guest_reply_pairs using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.guest_saved_reply_embeddings (
  saved_reply_id uuid primary key references public.guest_message_saved_replies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  body_hash text not null,
  embedding extensions.vector(1024) not null,
  embed_model text not null,
  updated_at timestamptz not null default now()
);

create index if not exists guest_saved_reply_embeddings_org_idx
  on public.guest_saved_reply_embeddings (organization_id);

create table if not exists public.guest_reply_assist_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.guest_conversations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  -- pending = 부르기 전 잡아 둔 비용(부른 뒤 draft · direct · failed 로 바뀐다). failed = 거절 · 잘림 · 모양 틀림 · 오류(비용은 남긴다).
  kind text not null check (kind in ('pending', 'draft', 'direct', 'failed', 'wrong', 'sent_as_is', 'sent_edited', 'discarded')),
  -- 같은 초안 묶음(초안 · 직접 확인 줄의 draft_id 를 뒤 기록이 같이 쓴다).
  draft_id uuid not null,
  -- 그 초안이 가리킨 손님 메시지.
  message_id uuid references public.guest_messages(id) on delete set null,
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  wrong_reason text check (wrong_reason is null or wrong_reason in ('fact', 'tone', 'missing', 'other')),
  -- 초안 글(채운 뒤 · 공백 정리)의 sha256 — 보낸 글과 같은지만 본다(글 · 코드 값은 남기지 않음).
  draft_hash text,
  -- 초안에 남은 자리 표시 글(예: 「[출입 비밀번호]」) — 남은 채로 보내면 서버가 막는다.
  placeholders text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists guest_reply_assist_events_org_created_idx
  on public.guest_reply_assist_events (organization_id, created_at desc);
create index if not exists guest_reply_assist_events_draft_idx
  on public.guest_reply_assist_events (draft_id);
create index if not exists guest_reply_assist_events_cost_idx
  on public.guest_reply_assist_events (created_at)
  where cost_micro_usd > 0;
-- 한 초안에 「처음 기록」(pending → draft · direct · failed)은 하나 · 끝 기록(보냄 · 버림)도 하나.
create unique index if not exists guest_reply_assist_events_draft_origin_unique
  on public.guest_reply_assist_events (draft_id)
  where kind in ('pending', 'draft', 'direct', 'failed');
create unique index if not exists guest_reply_assist_events_draft_outcome_unique
  on public.guest_reply_assist_events (draft_id)
  where kind in ('sent_as_is', 'sent_edited', 'discarded');

alter table public.guest_reply_pairs enable row level security;
alter table public.guest_saved_reply_embeddings enable row level security;
alter table public.guest_reply_assist_events enable row level security;

revoke all on table public.guest_reply_pairs from public, anon, authenticated;
revoke all on table public.guest_saved_reply_embeddings from public, anon, authenticated;
revoke all on table public.guest_reply_assist_events from public, anon, authenticated;
grant select, insert, update, delete on table public.guest_reply_pairs to service_role;
grant select, insert, update, delete on table public.guest_saved_reply_embeddings to service_role;
grant select, insert, update, delete on table public.guest_reply_assist_events to service_role;

create or replace function public.guest_reply_similar(
  p_organization_id uuid,
  p_embedding extensions.vector(1024),
  p_property_name text default null,
  p_since timestamptz default null,
  -- 이 시각 전 질문만(지금 대화의 질문 자신 · 그 뒤 것 제외).
  p_before timestamptz default null,
  p_limit integer default 3
)
returns table (
  pair_id uuid,
  conversation_id uuid,
  property_name text,
  asked_at timestamptz,
  question_text text,
  reply_text text,
  distance double precision
)
language plpgsql
stable
security invoker
set search_path = ''
-- 색인(HNSW) 결과를 조직 · 기간 · 답 있음으로 거르면 후보가 모자랄 수 있다 — 모자라면 색인을 더 읽게(pgvector 0.8+, Supabase 제공).
set hnsw.ef_search = 100
set hnsw.iterative_scan = 'relaxed_order'
as $fn$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 10);
  v_rows integer;
begin
  -- 조직 후보가 적으면(5,000줄 이하) 색인 없이 정확히 잰다 — 다른 조직 줄이 많아도 이 조직 후보가 빠지지 않게.
  select count(*) into v_rows
  from (
    select 1
    from public.guest_reply_pairs p
    where p.organization_id = p_organization_id
      and p.embedding is not null
      and p.reply_text is not null
      and (p_since is null or p.asked_at >= p_since)
      and (p_before is null or p.asked_at < p_before)
    limit 5001
  ) c;

  if v_rows <= 5000 then
    return query
      with cand as materialized (
        select p.id, p.conversation_id, p.property_name, p.asked_at, p.question_text, p.reply_text,
          (p.embedding operator(extensions.<=>) p_embedding)::double precision as raw_distance
        from public.guest_reply_pairs p
        where p.organization_id = p_organization_id
          and p.embedding is not null
          and p.reply_text is not null
          and (p_since is null or p.asked_at >= p_since)
          and (p_before is null or p.asked_at < p_before)
      )
      select c.id, c.conversation_id, c.property_name, c.asked_at, c.question_text, c.reply_text,
        c.raw_distance - case when p_property_name is not null and c.property_name = p_property_name then 0.03 else 0 end
      from cand c
      order by 7, c.asked_at desc
      limit v_limit;
  else
    return query
      with near as (
        -- 색인으로 가까운 후보를 넉넉히(60) 뽑고, 건물 보정은 그 안에서.
        select p.id, p.conversation_id, p.property_name, p.asked_at, p.question_text, p.reply_text,
          (p.embedding operator(extensions.<=>) p_embedding)::double precision as raw_distance
        from public.guest_reply_pairs p
        where p.organization_id = p_organization_id
          and p.embedding is not null
          and p.reply_text is not null
          and (p_since is null or p.asked_at >= p_since)
          and (p_before is null or p.asked_at < p_before)
        order by p.embedding operator(extensions.<=>) p_embedding
        limit 60
      )
      select n.id, n.conversation_id, n.property_name, n.asked_at, n.question_text, n.reply_text,
        n.raw_distance - case when p_property_name is not null and n.property_name = p_property_name then 0.03 else 0 end
      from near n
      order by 7, n.asked_at desc
      limit v_limit;
  end if;
end
$fn$;

revoke all on function public.guest_reply_similar(uuid, extensions.vector, text, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.guest_reply_similar(uuid, extensions.vector, text, timestamptz, timestamptz, integer) to service_role;

create or replace function public.guest_reply_assist_cost_since(p_since timestamptz)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(sum(e.cost_micro_usd), 0)::bigint
  from public.guest_reply_assist_events e
  where e.created_at >= p_since and e.cost_micro_usd > 0
$fn$;

revoke all on function public.guest_reply_assist_cost_since(timestamptz) from public, anon, authenticated;
grant execute on function public.guest_reply_assist_cost_since(timestamptz) to service_role;

create or replace function public.guest_reply_assist_reserve(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_user_id uuid,
  p_draft_id uuid,
  p_message_id uuid,
  p_since timestamptz,
  p_cap_micro_usd bigint,
  p_reserve_micro_usd bigint
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_spent bigint;
begin
  -- 한도는 모든 조직 공용(키 하나)이라 잠금도 하나 — 동시에 눌러도 합 확인 · 잡아 두기가 차례로.
  perform pg_advisory_xact_lock(hashtext('guest_reply_assist_cap'));
  select coalesce(sum(e.cost_micro_usd), 0) into v_spent
  from public.guest_reply_assist_events e
  where e.created_at >= p_since and e.cost_micro_usd > 0;
  if v_spent + greatest(coalesce(p_reserve_micro_usd, 0), 0) > coalesce(p_cap_micro_usd, 0) then
    return false;
  end if;
  insert into public.guest_reply_assist_events (organization_id, conversation_id, user_id, kind, draft_id, message_id, cost_micro_usd)
  values (p_organization_id, p_conversation_id, p_user_id, 'pending', p_draft_id, p_message_id, greatest(coalesce(p_reserve_micro_usd, 0), 0));
  return true;
end
$fn$;

revoke all on function public.guest_reply_assist_reserve(uuid, uuid, uuid, uuid, uuid, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.guest_reply_assist_reserve(uuid, uuid, uuid, uuid, uuid, timestamptz, bigint, bigint) to service_role;
