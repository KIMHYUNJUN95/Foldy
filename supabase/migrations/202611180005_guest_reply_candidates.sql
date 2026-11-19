-- 과거 답장에서 찾은 후보 — 정해 둔 문구 후보 · 건물 정보 후보. docs/product/49-guest-message-ai-reply-assist.md §9
--
-- 1) guest_reply_candidate_runs — 「다시 찾기」 한 번(누가 · 언제 · 읽은 답장 수 · 기간 · 쓴 비용 · 실패 이유).
--    조직마다 동시에 하나만(`running` 부분 고유 색인). 15분 넘게 `running` 이면 시작 함수가 `failed`(stale) 로 닫고 잡아 둔 비용을 0 으로 푼다.
--    시작할 때 잡아 둔 비용(reserve)은 끝날 때(성공 · 실패 모두) 앱이 실제 쓴 값으로 바꾼다.
-- 2) guest_reply_candidates — 후보 한 줄. `pending`(보는 중) → `added`(사람이 넣음) / `dismissed`(뺌, 영영 숨김).
--    **사람이 「추가」 · 「넣기」 를 누르기 전에는 guest_message_saved_replies · property_operation_infos 에 아무것도 쓰지 않는다**
--    — 후보는 이 표에만 있다. 다시 찾기는 `pending` 만 지우고 `added` · `dismissed` 는 기억으로 남긴다(같은 묶음이 다시 뜨지 않게).
-- 3) guest_reply_assist_cost_since · guest_reply_assist_reserve — 한 달 공용 한도에 후보 찾기 비용도 더한다(키 하나를 같이 쓴다).
-- 4) guest_reply_candidate_run_start — 한도 확인 + 비용 잡아 두기 + 동시 실행 막기를 같은 잠금 안에서.
-- 5) guest_reply_cluster_stats · guest_reply_cluster_recent — 묶음 가운데에서 가까운 질문 수 · 기간 · 최근 답장.
--
-- 권한: 표는 RLS 를 켜고 정책을 두지 않는다 — 브라우저(anon · authenticated)는 못 읽는다. 서버(service_role)가 조직 필터를
-- 명시해서만 읽고 쓴다(권한은 `src/actions/guest-message-candidates.ts` 가 먼저 본다). 함수는 security invoker · service_role 만.
-- 저장하는 글은 가린 뒤의 글이다 — 그 대화 손님 이름 · URL · 메일 · 전화 · 금액 · 방 번호 · 조직의 출입 코드 · 와이파이 값 ·
-- 숫자 3자리 이상은 `[…]`(`maskPastReply`, 띄어쓰기 · 하이픈으로 나눠 쓴 숫자는 비밀 낱말 문장 안에서만). 근거 글은 한 번 더 보고 비밀처럼 보이는 문장을 통째로 `[…]`
-- (`scrubSecretSentences`), 후보 글에 비밀이 남으면 그 후보를 버린다. 한 달 한도는 모든 조직이 같이 쓰는 하나다(키 하나).
--
-- 멱등: if not exists · create or replace · revoke/grant 는 다시 돌려도 안전하다.
-- 되돌리기:
--   drop function if exists public.guest_reply_cluster_recent(uuid, extensions.vector, double precision, timestamptz, text, integer);
--   drop function if exists public.guest_reply_cluster_stats(uuid, extensions.vector, double precision, timestamptz);
--   drop function if exists public.guest_reply_candidate_run_start(uuid, uuid, timestamptz, bigint, bigint);
--   drop table if exists public.guest_reply_candidates;
--   drop table if exists public.guest_reply_candidate_runs;
--   그리고 202611180002 의 guest_reply_assist_cost_since · guest_reply_assist_reserve 를 다시 돌린다.

create table if not exists public.guest_reply_candidate_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 읽은 답장(질문 + 답장 짝) 수 · 그 기간.
  source_count integer not null default 0 check (source_count >= 0),
  source_since timestamptz,
  source_until timestamptz,
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  -- 시작할 때 잡아 둔 값 → 끝나면 실제 값. 한 달 공용 한도에 들어간다.
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  error_key text check (error_key is null or error_key in ('unavailable', 'cap', 'failed', 'stale')),
  -- 후보를 만들지 않은 건물 칸과 이유 — [{property, field, reason: 'few' | 'filled', count}]
  skip_notes jsonb not null default '[]'::jsonb,
  constraint guest_reply_candidate_runs_finished check ((status = 'running') = (finished_at is null))
);

create unique index if not exists guest_reply_candidate_runs_one_running
  on public.guest_reply_candidate_runs (organization_id)
  where status = 'running';
create index if not exists guest_reply_candidate_runs_org_started_idx
  on public.guest_reply_candidate_runs (organization_id, started_at desc);
create index if not exists guest_reply_candidate_runs_cost_idx
  on public.guest_reply_candidate_runs (started_at)
  where cost_micro_usd > 0;
create index if not exists guest_reply_candidate_runs_started_by_idx
  on public.guest_reply_candidate_runs (started_by);

create table if not exists public.guest_reply_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid references public.guest_reply_candidate_runs(id) on delete set null,
  kind text not null check (kind in ('saved_reply', 'guest_info')),
  status text not null default 'pending' check (status in ('pending', 'added', 'dismissed')),
  -- 정해 둔 문구: 이름 · 대표 질문 · 본문(언어별), 건물 정보: 쓰지 않음.
  title jsonb not null default '{}'::jsonb,
  question jsonb not null default '{}'::jsonb,
  bodies jsonb not null default '{}'::jsonb,
  note jsonb not null default '{}'::jsonb,
  ask_count integer not null default 0 check (ask_count >= 0),
  first_asked_at timestamptz,
  last_asked_at timestamptz,
  -- 근거(가린 글) — [{at, property, lang, text}]
  evidence jsonb not null default '[]'::jsonb,
  -- 묶음 가운데(질문 뜻 숫자) — 다시 찾기 때 뺀 · 넣은 묶음과 같은지 비교.
  centroid extensions.vector(1024),
  similar_saved_reply_id uuid references public.guest_message_saved_replies(id) on delete set null,
  -- 건물 정보: 건물(정식 이름) · 칸 · 값 후보 [{value: {ko,ja,en}, count, firstAt, lastAt}] (최신 순) · 값 지문.
  property_name text,
  field text check (field is null or field in ('checkIn', 'checkOut', 'luggage', 'parking', 'trash', 'directions')),
  options jsonb not null default '[]'::jsonb,
  value_hashes text[] not null default '{}',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  -- 넣은 결과: 만든 문구 · 넣기 전 칸 값(되돌리기용).
  result_saved_reply_id uuid references public.guest_message_saved_replies(id) on delete set null,
  applied_previous jsonb,
  created_at timestamptz not null default now(),
  constraint guest_reply_candidates_shape check (
    (kind = 'saved_reply' and property_name is null and field is null)
    or (kind = 'guest_info' and property_name is not null and field is not null)
  ),
  constraint guest_reply_candidates_decided check ((status = 'pending') = (decided_at is null))
);

create index if not exists guest_reply_candidates_org_status_idx
  on public.guest_reply_candidates (organization_id, kind, status, ask_count desc);
create index if not exists guest_reply_candidates_run_idx
  on public.guest_reply_candidates (run_id);
create index if not exists guest_reply_candidates_similar_idx
  on public.guest_reply_candidates (similar_saved_reply_id);
create index if not exists guest_reply_candidates_result_idx
  on public.guest_reply_candidates (result_saved_reply_id);
create index if not exists guest_reply_candidates_decided_by_idx
  on public.guest_reply_candidates (decided_by);
create index if not exists guest_reply_candidates_property_idx
  on public.guest_reply_candidates (organization_id, property_name, field)
  where kind = 'guest_info';

alter table public.guest_reply_candidate_runs enable row level security;
alter table public.guest_reply_candidates enable row level security;

revoke all on table public.guest_reply_candidate_runs from public, anon, authenticated;
revoke all on table public.guest_reply_candidates from public, anon, authenticated;
grant select, insert, update, delete on table public.guest_reply_candidate_runs to service_role;
grant select, insert, update, delete on table public.guest_reply_candidates to service_role;

-- ── 한 달 공용 한도: 초안 비용 + 후보 찾기 비용 ──────────────────────────────

create or replace function public.guest_reply_assist_cost_since(p_since timestamptz)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select (
    coalesce((select sum(e.cost_micro_usd) from public.guest_reply_assist_events e
      where e.created_at >= p_since and e.cost_micro_usd > 0), 0)
    + coalesce((select sum(r.cost_micro_usd) from public.guest_reply_candidate_runs r
      where r.started_at >= p_since and r.cost_micro_usd > 0), 0)
  )::bigint
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
  perform pg_advisory_xact_lock(hashtext('guest_reply_assist_cap'));
  v_spent := public.guest_reply_assist_cost_since(p_since);
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

-- ── 다시 찾기 시작 ────────────────────────────────────────────────────────────
-- 결과: ('started', run_id) · ('busy', 지금 도는 run_id) · ('cap', null).
create or replace function public.guest_reply_candidate_run_start(
  p_organization_id uuid,
  p_user_id uuid,
  p_since timestamptz,
  p_cap_micro_usd bigint,
  p_reserve_micro_usd bigint
)
returns table (outcome text, run_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_running uuid;
  v_new uuid;
begin
  perform pg_advisory_xact_lock(hashtext('guest_reply_assist_cap'));
  -- 15분 넘게 끝나지 않은 실행은 멈춘 것으로 닫는다(함수 시간 제한 300초보다 넉넉히).
  -- 잡아 둔 비용(reserve)은 0 으로 푼다 — 안 풀면 그 달 한도에서 영영 빠진다. 그 실행이 늦게라도 끝나면 앱이 실제 쓴 값을 적는다.
  update public.guest_reply_candidate_runs r
    set status = 'failed', error_key = 'stale', finished_at = now(), cost_micro_usd = 0
    where r.organization_id = p_organization_id and r.status = 'running' and r.started_at < now() - interval '15 minutes';
  select r.id into v_running from public.guest_reply_candidate_runs r
    where r.organization_id = p_organization_id and r.status = 'running' limit 1;
  if v_running is not null then
    return query select 'busy'::text, v_running;
    return;
  end if;
  if public.guest_reply_assist_cost_since(p_since) + greatest(coalesce(p_reserve_micro_usd, 0), 0) > coalesce(p_cap_micro_usd, 0) then
    return query select 'cap'::text, null::uuid;
    return;
  end if;
  insert into public.guest_reply_candidate_runs (organization_id, started_by, cost_micro_usd)
    values (p_organization_id, p_user_id, greatest(coalesce(p_reserve_micro_usd, 0), 0))
    returning id into v_new;
  return query select 'started'::text, v_new;
end
$fn$;

revoke all on function public.guest_reply_candidate_run_start(uuid, uuid, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.guest_reply_candidate_run_start(uuid, uuid, timestamptz, bigint, bigint) to service_role;

-- ── 묶음 통계 · 최근 답장 ─────────────────────────────────────────────────────
-- 거리 조건(`<=` 거리)은 HNSW 색인을 쓰지 않는다 — 조직 · 기간으로 줄인 뒤 정확히 센다(조직 하나 1년 수만 줄).

create or replace function public.guest_reply_cluster_stats(
  p_organization_id uuid,
  p_centroid extensions.vector(1024),
  p_max_distance double precision,
  p_since timestamptz
)
returns table (ask_count bigint, first_at timestamptz, last_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select count(*)::bigint, min(p.asked_at), max(p.asked_at)
  from public.guest_reply_pairs p
  where p.organization_id = p_organization_id
    and p.embedding is not null
    and p.asked_at >= p_since
    and (p.embedding operator(extensions.<=>) p_centroid) <= p_max_distance
$fn$;

revoke all on function public.guest_reply_cluster_stats(uuid, extensions.vector, double precision, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_reply_cluster_stats(uuid, extensions.vector, double precision, timestamptz) to service_role;

create or replace function public.guest_reply_cluster_recent(
  p_organization_id uuid,
  p_centroid extensions.vector(1024),
  p_max_distance double precision,
  p_since timestamptz,
  p_property_name text default null,
  p_limit integer default 12
)
returns table (pair_id uuid, conversation_id uuid, property_name text, asked_at timestamptz, question_text text, reply_text text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p.id, p.conversation_id, p.property_name, p.asked_at, p.question_text, p.reply_text
  from public.guest_reply_pairs p
  where p.organization_id = p_organization_id
    and p.embedding is not null
    and p.reply_text is not null
    and p.asked_at >= p_since
    and (p_property_name is null or p.property_name = p_property_name)
    and (p.embedding operator(extensions.<=>) p_centroid) <= p_max_distance
  order by p.asked_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 40)
$fn$;

revoke all on function public.guest_reply_cluster_recent(uuid, extensions.vector, double precision, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.guest_reply_cluster_recent(uuid, extensions.vector, double precision, timestamptz, text, integer) to service_role;
