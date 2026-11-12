-- 손님 메시지 2단계 — 번역 사용량 · 언어별 번역 · 발송 큐 잡은 시각 · 원자 보내기 · 마지막 한 줄 · 대화 상태 함수 고침 (2026-11-13).
--
-- 문서: docs/product/47-guest-messaging.md §5-4 · §9 · docs/engineering/04-data-model.md · 05-rls-permissions.md 「손님 메시지」
-- 상태: **운영 미적용** — 적용은 사용자 컨펌 뒤(Dashboard SQL Editor). 202611120002(운영 적용됨)는 고치지 않는다 — 바뀌는 것은 모두 여기.
--
-- 모든 새 표 · 함수는 서버(service_role)만 쓴다. 일반 사용자 정책 · 권한 없음.

begin;

-- ── 1. 번역 사용량(글자 수만) ────────────────────────────────────────────────
-- DeepL 키 하나를 리뷰 번역(review_translations)과 손님 메시지 번역이 같이 쓴다. 월 한도(src/lib/review-translate.ts)를 지키려면
-- 손님 메시지 쪽이 보낸 원문 글자 수도 같은 합계에 들어가야 한다. 글 자체는 저장하지 않는다(개인정보).
create table if not exists public.translation_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- guest_message: 손님 말 → 직원 언어, guest_reply: 직원 답장 → 손님 언어(보내기 전 미리 보기).
  feature text not null check (feature in ('guest_message', 'guest_reply')),
  -- DeepL 이 세는 「보낸 원문」 글자 수(코드포인트).
  char_count integer not null check (char_count > 0),
  created_at timestamptz not null default now()
);

comment on table public.translation_usage is
  '번역 사용량(글자 수만, 글 없음) — DeepL 월 한도 합계에 review_translations 와 함께 들어간다. docs/product/47-guest-messaging.md §9';

-- 월 합계는 조직을 가리지 않는다(키 하나) → created_at. 조직별 사용량 표시(3단계)는 (organization_id, created_at).
create index if not exists translation_usage_created_idx on public.translation_usage (created_at);
create index if not exists translation_usage_org_created_idx on public.translation_usage (organization_id, created_at);

alter table public.translation_usage enable row level security;
revoke all on table public.translation_usage from public, anon, authenticated;
grant all on table public.translation_usage to service_role;

-- 월 합계 — 줄을 1,000개씩 읽지 않고 DB 가 한 번에 더한다.
create or replace function public.translation_usage_since(p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.char_count), 0)::bigint from public.translation_usage u where u.created_at >= p_since;
$$;
revoke all on function public.translation_usage_since(timestamptz) from public, anon, authenticated;
grant execute on function public.translation_usage_since(timestamptz) to service_role;

-- ── 2. 손님 말 번역 — 언어마다 한 줄(다른 언어 번역을 덮지 않는다) ─────────────────
create table if not exists public.guest_message_translations (
  message_id uuid not null references public.guest_messages (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 직원 화면 언어(ko · ja · en).
  lang text not null check (lang in ('ko', 'ja', 'en')),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  primary key (message_id, lang)
);

comment on table public.guest_message_translations is
  '손님 말 번역 캐시 — (메시지, 직원 언어) 하나에 한 줄, 있으면 덮지 않는다. docs/product/47-guest-messaging.md §9';

create index if not exists guest_message_translations_org_idx on public.guest_message_translations (organization_id);

alter table public.guest_message_translations enable row level security;
revoke all on table public.guest_message_translations from public, anon, authenticated;
grant all on table public.guest_message_translations to service_role;

-- ── 3. 발송 큐 — 잡은 시각(멈춘 sending 풀기) ───────────────────────────────
-- 발송 작업이 줄을 sending 으로 잡고 결과를 저장하기 전에 멈추면 줄이 sending 으로 남는다. 나갔을 수도 있으니
-- 다시 보내지 않고, 일정 시간이 지나면 uncertain(사람이 확인)으로 푼다(src/lib/guest-messages/outbox-runner.ts).
alter table public.guest_message_outbox add column if not exists claimed_at timestamptz;

-- ── 4. 답장 넣기 — 큐 줄 + 대기 메시지 줄을 한 번에 ──────────────────────────
-- 따로 넣으면 그 사이에 발송 작업이 큐 줄을 보내 버릴 수 있다(메시지 줄 없이 나감). 같은 키가 이미 있으면 그 줄을 돌려주고
-- 글이 같은지 알려 준다(다르면 앱이 stale 로 거절).
-- 번역해서 보낸 답장의 언어(직원이 고른 대상 언어 — 손님 언어 · 영어 · 일본어 · 한국어). 원문 그대로면 null.
alter table public.guest_messages add column if not exists body_lang text
  check (body_lang is null or body_lang ~ '^[a-z]{2}(-[a-z]{2,4})?$');

drop function if exists public.guest_message_enqueue_reply(uuid, uuid, text, text, text, text, text, uuid, timestamptz);
create or replace function public.guest_message_enqueue_reply(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_provider text,
  p_body text,
  p_original text,
  p_original_lang text,
  p_idempotency_key text,
  p_user_id uuid,
  p_now timestamptz default now(),
  p_body_lang text default null
)
returns table (outbox_id uuid, duplicate boolean, same_body boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_body text;
begin
  select o.id, o.body into v_id, v_body
  from public.guest_message_outbox o
  where o.organization_id = p_organization_id and o.idempotency_key = p_idempotency_key;
  if v_id is not null then
    return query select v_id, true, v_body = p_body;
    return;
  end if;

  begin
    insert into public.guest_message_outbox
      (organization_id, conversation_id, kind, body, status, next_try_at, idempotency_key, created_by)
    values
      (p_organization_id, p_conversation_id, 'reply', p_body, 'queued', p_now, p_idempotency_key, p_user_id)
    returning id into v_id;
  exception when unique_violation then
    -- 같은 순간 같은 키가 먼저 들어갔다(두 번 누름).
    select o.id, o.body into v_id, v_body
    from public.guest_message_outbox o
    where o.organization_id = p_organization_id and o.idempotency_key = p_idempotency_key;
    return query select v_id, true, v_body = p_body;
    return;
  end;

  insert into public.guest_messages
    (organization_id, conversation_id, provider, direction, body, body_translated, translated_lang, body_lang, sent_at, author_user_id, outbox_id)
  values
    (p_organization_id, p_conversation_id, p_provider, 'host', p_body, p_original,
     case when p_original is null then null else p_original_lang end,
     case when p_original is null then null else p_body_lang end, p_now, p_user_id, v_id);

  return query select v_id, false, true;
end;
$$;
revoke all on function public.guest_message_enqueue_reply(uuid, uuid, text, text, text, text, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.guest_message_enqueue_reply(uuid, uuid, text, text, text, text, text, uuid, timestamptz, text) to service_role;

-- ── 5. 목록 미리 보기 — 대화마다 마지막 손님 말 · 답장 한 줄 ─────────────────────
-- 예전엔 여러 대화를 묶어 1,000줄만 읽어서, 메시지가 많은 대화가 있으면 다른 대화의 마지막 줄이 빠질 수 있었다.
create or replace function public.guest_conversation_last_lines(p_organization_id uuid, p_conversation_ids uuid[])
returns table (conversation_id uuid, direction text, body text, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (m.conversation_id) m.conversation_id, m.direction, m.body, m.sent_at
  from public.guest_messages m
  where m.organization_id = p_organization_id
    and m.conversation_id = any (p_conversation_ids)
    and m.direction in ('guest', 'host')
  order by m.conversation_id, m.sent_at desc, m.id desc;
$$;
revoke all on function public.guest_conversation_last_lines(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.guest_conversation_last_lines(uuid, uuid[]) to service_role;

-- ── 6. 대화 상태 함수 — 끝난 「나중에」도 답장 기다림처럼 ──────────────────────
-- 202611120002 판은 답장이 와도 status = 'awaiting' 일 때만 done 으로 바꿨다. 「나중에」 시각이 지나 화면에는
-- 「답장 기다림」으로 보이는 대화(status = 'snoozed', snooze_until <= now)에 답장하면 그대로 snoozed 로 남아,
-- 목록에 계속 「답장 기다림」으로 떠 있었다. 이제 끝난 snoozed 는 awaiting 과 같이 본다(done 으로 · snooze_until 비움).
-- 앱 쪽 거울: src/lib/guest-messages/ingest-plan.ts `nextConversationState`.
create or replace function public.guest_conversation_apply_messages(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_guest_at timestamptz,
  p_unread_guest_at timestamptz,
  p_reply_at timestamptz,
  p_message_at timestamptz,
  p_now timestamptz default now()
)
returns table (status text, snooze_until timestamptz, last_guest_at timestamptz, last_reply_at timestamptz, last_message_at timestamptz)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.guest_conversations c
  set
    last_guest_at = greatest(c.last_guest_at, p_guest_at),
    last_reply_at = greatest(c.last_reply_at, p_reply_at),
    last_message_at = greatest(c.last_message_at, p_message_at),
    status = case
      when p_unread_guest_at is not null
        and (c.last_guest_at is null or p_unread_guest_at > c.last_guest_at)
        and (greatest(c.last_reply_at, p_reply_at) is null or p_unread_guest_at > greatest(c.last_reply_at, p_reply_at))
        then case when c.status = 'snoozed' and c.snooze_until > p_now then 'snoozed' else 'awaiting' end
      when (c.status = 'awaiting' or (c.status = 'snoozed' and c.snooze_until <= p_now))
        and p_reply_at is not null
        and greatest(c.last_reply_at, p_reply_at) >= coalesce(greatest(c.last_guest_at, p_guest_at), '-infinity'::timestamptz)
        then 'done'
      else c.status
    end,
    snooze_until = case
      when p_unread_guest_at is not null
        and (c.last_guest_at is null or p_unread_guest_at > c.last_guest_at)
        and (greatest(c.last_reply_at, p_reply_at) is null or p_unread_guest_at > greatest(c.last_reply_at, p_reply_at))
        and not (c.status = 'snoozed' and c.snooze_until > p_now)
        then null
      when c.status = 'snoozed' and c.snooze_until <= p_now
        and p_reply_at is not null
        and greatest(c.last_reply_at, p_reply_at) >= coalesce(greatest(c.last_guest_at, p_guest_at), '-infinity'::timestamptz)
        then null
      else c.snooze_until
    end
  where c.id = p_conversation_id
    and c.organization_id = p_organization_id
  returning c.status, c.snooze_until, c.last_guest_at, c.last_reply_at, c.last_message_at;
$$;

revoke all on function public.guest_conversation_apply_messages(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_conversation_apply_messages(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;

commit;
