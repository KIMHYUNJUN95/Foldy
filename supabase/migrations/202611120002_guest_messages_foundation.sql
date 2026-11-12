-- 손님 메시지(Beds24 CS) 1단계 — 대화 · 메시지 원본 · 발송 큐 · 연결 상태 + 권한 키 (2026-11-12).
--
-- 문서: docs/product/47-guest-messaging.md §4 · §7 · §8 · §10
--       docs/engineering/04-data-model.md → 「손님 메시지」, docs/engineering/05-rls-permissions.md → 「손님 메시지」
-- 상태: **운영 미적용** — 사용자가 Dashboard SQL Editor 또는 `supabase db push` 로 적용한다.
--
-- 원칙
-- - 메시지의 원본은 Foldy DB 다(Beds24 는 통로 하나 — `provider`). 지금 통로는 'beds24' 하나.
-- - 쓰기는 서버(service_role)만 한다: 웹훅 수신 · 보정 조회 · 발송 큐 · (2단계) 서버 액션이 권한을 확인한 뒤 쓴다.
--   일반 사용자(authenticated)는 읽기 + 몇 칸 고치기(대화 상태 · 연결 설정)만 칸 단위 권한으로 연다. 만들기 · 지우기 권한은 없다.
-- - 읽기는 권한 키(`has_capability`)로 조직마다 거른다 — 「조직 멤버면 누구나」가 아니다(손님 이름 · 메시지는 개인정보).
-- - 손님 대화는 예약 하나 = 대화 하나. 예약 행은 웹훅이 지우고 다시 만들 수 있어(방 바뀜) `reservation_id` 는 set null,
--   대화의 기준은 (organization_id, provider, provider_booking_id) 다.
-- - 하위 표는 (conversation_id, organization_id) 복합 외래키로 조직이 대화와 어긋나지 않게 한다.
-- - 삭제: 하드 삭제(조직 · 대화가 지워지면 따라 지워짐). 보관 기간은 열린 질문 Q7 — 정해지기 전에는 지우는 작업이 없다.
-- - 미루는 표: auto_message_rules · auto_message_runs · guest_message_links · property_operation_infos 넓히기(5 · 6 · 4단계).
--
-- 다시 돌려도 안전하게 `if not exists` · `drop policy if exists` 를 쓴다.

begin;

-- ── 대화 ────────────────────────────────────────────────────────────────────
create table if not exists public.guest_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{2,32}$'),
  -- 통로 쪽 예약 번호. Beds24 는 자기 예약 번호(v2 `id` / v1 `bookId`, 채널 번호 apiReference 아님 — 그룹 예약의 방마다 다르다).
  provider_booking_id text not null check (length(btrim(provider_booking_id)) > 0),
  reservation_id uuid references public.reservations (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  -- 표시용 사본(정본 이름 — 화면에서 localizeBuildingName 으로 바꿔 그린다).
  property_name text,
  room_label text,
  -- 채널 키: airbnb · booking · expedia · agoda · vrbo · direct · other (앱이 분류, 새 통로가 늘 수 있어 check 없음).
  channel text,
  -- 통로 쪽 예약 상태 원문(Beds24: confirmed · request · new · cancelled · black · inquiry). 응답 목표 분류에 쓴다.
  booking_status text,
  check_in_date date,
  check_out_date date,
  guest_name text,
  guest_language text,
  status text not null default 'done' check (status in ('awaiting', 'done', 'snoozed')),
  snooze_until timestamptz,
  last_guest_at timestamptz,
  last_reply_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_conversations_provider_booking_key unique (organization_id, provider, provider_booking_id),
  -- 하위 표의 복합 외래키 대상.
  constraint guest_conversations_id_org_key unique (id, organization_id),
  constraint guest_conversations_snooze_check check (status <> 'snoozed' or snooze_until is not null)
);

comment on table public.guest_conversations is
  '손님 대화 — 예약(통로 예약 번호) 하나에 하나. docs/product/47-guest-messaging.md §7';

-- 메시지함 목록: 조직 · 상태 · 마지막 손님 말 순.
create index if not exists guest_conversations_org_status_guest_idx
  on public.guest_conversations (organization_id, status, last_guest_at desc);
create index if not exists guest_conversations_org_last_message_idx
  on public.guest_conversations (organization_id, last_message_at desc);
create index if not exists guest_conversations_reservation_idx
  on public.guest_conversations (reservation_id) where reservation_id is not null;
create index if not exists guest_conversations_property_idx
  on public.guest_conversations (property_id) where property_id is not null;
create index if not exists guest_conversations_room_idx
  on public.guest_conversations (room_id) where room_id is not null;

-- ── 발송 큐 (메시지보다 먼저 — 메시지가 outbox_id 로 가리킨다) ─────────────────
create table if not exists public.guest_message_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  kind text not null check (kind in ('reply', 'auto')),
  -- 자동 안내 규칙(5단계에서 auto_message_rules 를 만들 때 외래키를 붙인다).
  rule_id uuid,
  body text not null check (length(btrim(body)) > 0),
  -- uncertain: 요청은 나갔는데 결과를 모른다(네트워크 끊김 · 5xx · 응답 줄 빠짐). **다시 보내지 않는다** — 되돌아온 host 메시지(웹훅 ·
  -- 보정 조회)가 오면 sent 로 합친다. 같은 글을 두 번 보내는 것보다 사람이 확인하는 편이 낫다.
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'uncertain', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_try_at timestamptz not null default now(),
  error_code text,
  -- 보낸 뒤 통로가 준 메시지 번호(웹훅으로 되돌아온 host 메시지와 맞출 때 쓴다).
  external_id text,
  -- 같은 보내기가 두 번 들어오지 않게(화면이 보내기 한 번마다 만든 값 · 자동 안내는 규칙+예약).
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  created_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_message_outbox_conversation_fkey
    foreign key (conversation_id, organization_id)
    references public.guest_conversations (id, organization_id) on delete cascade,
  constraint guest_message_outbox_idempotency_key unique (organization_id, idempotency_key),
  constraint guest_message_outbox_sent_check check (status <> 'sent' or sent_at is not null)
);

comment on table public.guest_message_outbox is
  '손님 메시지 발송 큐 — 직원 답장(reply)이 자동 안내(auto)보다 먼저. docs/product/47-guest-messaging.md §4-1';

-- 발송 처리: 보낼 차례인 줄만.
create index if not exists guest_message_outbox_due_idx
  on public.guest_message_outbox (next_try_at)
  where status in ('queued', 'sending');
create index if not exists guest_message_outbox_conversation_idx
  on public.guest_message_outbox (conversation_id, created_at desc);
create index if not exists guest_message_outbox_external_idx
  on public.guest_message_outbox (external_id) where external_id is not null;
create index if not exists guest_message_outbox_org_status_idx
  on public.guest_message_outbox (organization_id, status);

-- ── 메시지 원본 ─────────────────────────────────────────────────────────────
create table if not exists public.guest_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  provider text not null check (provider ~ '^[a-z0-9_]{2,32}$'),
  -- 통로 쪽 메시지 번호. 내부 메모 · 아직 번호를 모르는 보낸 메시지는 null.
  external_id text,
  -- 통로가 준 출처 원문(Beds24: host · guest · internalNote · system). 모르는 값도 그대로 남긴다.
  provider_source text,
  direction text not null check (direction in ('guest', 'host', 'internal', 'system')),
  body text not null default '',
  body_translated text,
  translated_lang text,
  sent_at timestamptz not null,
  read_at timestamptz,
  author_user_id uuid references auth.users (id) on delete set null,
  -- [{ name, mimeType, url? , inline? }] — base64 본문은 저장하지 않는다.
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  outbox_id uuid references public.guest_message_outbox (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_messages_conversation_fkey
    foreign key (conversation_id, organization_id)
    references public.guest_conversations (id, organization_id) on delete cascade,
  -- 웹훅과 보정 조회가 같은 메시지를 두 번 넣어도 하나. 조직마다 따로(다른 조직 줄과 부딪쳐 조용히 버려지지 않게).
  -- null 은 서로 다른 값으로 본다(내부 메모 여러 개 가능). 부분 인덱스가 아니라 제약 — PostgREST upsert(on conflict) 대상.
  constraint guest_messages_org_provider_external_key unique (organization_id, provider, external_id),
  -- 발송 큐 한 줄 = 메시지 한 줄. 발송 작업(2단계)은 이 제약으로 upsert 해서, 되돌아옴 합치기가 먼저 만든 줄에 잇는다.
  constraint guest_messages_outbox_key unique (outbox_id)
);

comment on table public.guest_messages is
  '손님 메시지 원본(guest · host · internal · system). (organization_id, provider, external_id) 로 중복 막음. docs/product/47-guest-messaging.md §4';

create index if not exists guest_messages_conversation_sent_idx
  on public.guest_messages (conversation_id, sent_at);
create index if not exists guest_messages_org_sent_idx
  on public.guest_messages (organization_id, sent_at desc);
create index if not exists guest_messages_author_idx
  on public.guest_messages (author_user_id) where author_user_id is not null;

-- ── 연결 상태 · 설정 (조직마다 한 줄) ──────────────────────────────────────
create table if not exists public.guest_message_channel_state (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'beds24' check (provider ~ '^[a-z0-9_]{2,32}$'),
  last_webhook_at timestamptz,
  last_message_webhook_at timestamptz,
  -- 보정 조회가 한 페이지라도 읽었을 때만 고친다. 마지막 실패 이유는 따로(성공하면 null).
  last_reconcile_at timestamptz,
  last_reconcile_error text,
  -- 마지막으로 받은 Beds24 응답 헤더 — **이 기능의 사본**(화면용). 계정 전체 기준은 beds24_sync_locks 'account_credit' 줄(47 §4-1).
  last_credit_remaining integer,
  last_credit_reset_at timestamptz,
  last_request_cost integer,
  -- 응답 목표(분) — 예약 상태 분류별. 열린 질문 Q4 · Q5 와 함께 화면에서 고친다.
  settings jsonb not null default
    '{"responseTargetMinutes": {"inquiry": 30, "request": 30, "staying": 60, "other": 120}}'::jsonb
    check (jsonb_typeof(settings) = 'object'),
  night_pause boolean not null default false,
  credit_reserve integer not null default 20 check (credit_reserve between 0 and 1000),
  stall_hours integer not null default 3 check (stall_hours between 1 and 72),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guest_message_channel_state is
  '손님 메시지 받는 통로 상태 · 크레딧 기록 · 응답 목표 설정(조직마다 한 줄). docs/product/47-guest-messaging.md §6-1 · §6-2';

-- ── updated_at ─────────────────────────────────────────────────────────────
drop trigger if exists guest_conversations_set_updated_at on public.guest_conversations;
create trigger guest_conversations_set_updated_at
before update on public.guest_conversations
for each row execute function public.set_updated_at();

drop trigger if exists guest_message_outbox_set_updated_at on public.guest_message_outbox;
create trigger guest_message_outbox_set_updated_at
before update on public.guest_message_outbox
for each row execute function public.set_updated_at();

drop trigger if exists guest_messages_set_updated_at on public.guest_messages;
create trigger guest_messages_set_updated_at
before update on public.guest_messages
for each row execute function public.set_updated_at();

drop trigger if exists guest_message_channel_state_set_updated_at on public.guest_message_channel_state;
create trigger guest_message_channel_state_set_updated_at
before update on public.guest_message_channel_state
for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.guest_conversations enable row level security;
alter table public.guest_message_outbox enable row level security;
alter table public.guest_messages enable row level security;
alter table public.guest_message_channel_state enable row level security;

-- 읽기: 그 조직에서 `guest_messages.view` 를 가진 사람(+ 플랫폼 개발자). has_capability 는 활성 멤버 · 개인 부여 · 차단을 함께 본다.
drop policy if exists "guest conversations: viewers can read" on public.guest_conversations;
create policy "guest conversations: viewers can read"
on public.guest_conversations
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
);

-- 대화 상태(처리 끝 · 나중에)만 고친다 — 칸 권한(아래)이 status · snooze_until 만 연다. 보기 + 답장 둘 다 있어야 한다.
drop policy if exists "guest conversations: repliers can update status" on public.guest_conversations;
create policy "guest conversations: repliers can update status"
on public.guest_conversations
for update
to authenticated
using (
  (select public.is_platform_admin())
  or (
    public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
    and public.has_capability(organization_id, (select auth.uid()), 'guest_messages.reply')
  )
)
with check (
  (select public.is_platform_admin())
  or (
    public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
    and public.has_capability(organization_id, (select auth.uid()), 'guest_messages.reply')
  )
);

drop policy if exists "guest messages: viewers can read" on public.guest_messages;
create policy "guest messages: viewers can read"
on public.guest_messages
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
);

drop policy if exists "guest message outbox: viewers can read" on public.guest_message_outbox;
create policy "guest message outbox: viewers can read"
on public.guest_message_outbox
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
);

-- 연결 상태 · 사용량 · 설정은 관리 권한만(47 §6-2).
drop policy if exists "guest message channel state: managers can read" on public.guest_message_channel_state;
create policy "guest message channel state: managers can read"
on public.guest_message_channel_state
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.manage')
);

drop policy if exists "guest message channel state: managers can update settings" on public.guest_message_channel_state;
create policy "guest message channel state: managers can update settings"
on public.guest_message_channel_state
for update
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.manage')
)
with check (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.manage')
);

-- insert · delete 정책은 일부러 없다: 일반 사용자에게 그 권한(GRANT)부터 주지 않는다. 서버(service_role)만 만든다 · 지운다.

-- ── 대화 상태 바꾸기 — 한 문장으로(읽고 → 고치기 사이에 직원 「처리 끝」이 덮이지 않게) ─────────
-- 앱 쪽 같은 규칙의 사본: src/lib/guest-messages/ingest-plan.ts `nextConversationState`(테스트용 거울).
--   - 시각 칸은 뒤로 가지 않는다(greatest — null 은 무시).
--   - 「답장 기다림」은 **새** 안 읽은 손님 말(p_unread_guest_at)이 지금까지의 손님 말 · 답장보다 모두 나중일 때만.
--     직원이 「처리 끝」 한 뒤 같은 · 옛 손님 말이 다시 와도(웹훅은 이력 전체를 싣는다) 다시 열지 않는다.
--   - 「나중에」가 아직 안 끝났으면 snoozed 그대로. 다시 열 때 snooze_until 을 비운다.
--   - 답장(p_reply_at)이 마지막 손님 말 이후면 awaiting → done.
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
      when c.status = 'awaiting'
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
      else c.snooze_until
    end
  where c.id = p_conversation_id
    and c.organization_id = p_organization_id
  returning c.status, c.snooze_until, c.last_guest_at, c.last_reply_at, c.last_message_at;
$$;

revoke all on function public.guest_conversation_apply_messages(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_conversation_apply_messages(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;

-- ── 웹훅 원문 칸 — 임시 예외 표시 ────────────────────────────────────────────
comment on column public.beds24_webhook_events.raw_payload is
  '실패 · 거절 배달의 원문(재처리용). 임시 예외(2026-11-12, docs/product/47 §3-4 V1): BEDS24_WEBHOOK_CAPTURE_MESSAGES=1 이면 손님 메시지가 실린 배달도 남긴다(modes 에 messages_capture, 첨부는 길이만, 크기 상한). 확인 뒤 스위치를 끄고 그 줄을 지운다.';

-- ── GRANT ──────────────────────────────────────────────────────────────────
-- Supabase 기본 권한이 anon · authenticated 에 표 전체 권한을 줬을 수 있어 먼저 모두 거둔다.
revoke all on table public.guest_conversations from public, anon, authenticated;
revoke all on table public.guest_message_outbox from public, anon, authenticated;
revoke all on table public.guest_messages from public, anon, authenticated;
revoke all on table public.guest_message_channel_state from public, anon, authenticated;

grant select on table public.guest_conversations to authenticated;
grant update (status, snooze_until) on table public.guest_conversations to authenticated;
grant select on table public.guest_messages to authenticated;
grant select on table public.guest_message_outbox to authenticated;
grant select on table public.guest_message_channel_state to authenticated;
grant update (settings, night_pause, credit_reserve, stall_hours) on table public.guest_message_channel_state to authenticated;

grant all on table public.guest_conversations to service_role;
grant all on table public.guest_message_outbox to service_role;
grant all on table public.guest_messages to service_role;
grant all on table public.guest_message_channel_state to service_role;

-- ── 권한 키 (202611040001 과 같은 형식, 레지스트리 src/config/capabilities.ts) ──
-- 기본 역할은 임시(열린 질문 Q2): 보기 · 답장은 대표 · 전무 · CS, 관리(자동 안내 · 사용량 · 설정)는 대표 · 전무만. 알바는 역할로 안 받고 개인 부여만.
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('guest_messages.view', true, true, true),
  ('guest_messages.reply', true, true, true),
  ('guest_messages.manage', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('guest_messages.view', 'owner'::public.organization_role),
  ('guest_messages.view', 'senior_managing_director'::public.organization_role),
  ('guest_messages.view', 'cs_staff'::public.organization_role),
  ('guest_messages.reply', 'owner'::public.organization_role),
  ('guest_messages.reply', 'senior_managing_director'::public.organization_role),
  ('guest_messages.reply', 'cs_staff'::public.organization_role),
  ('guest_messages.manage', 'owner'::public.organization_role),
  ('guest_messages.manage', 'senior_managing_director'::public.organization_role)
on conflict do nothing;
-- 다시 돌릴 때 예전 초안의 CS 관리 행이 남지 않게.
delete from public.capability_roles where capability = 'guest_messages.manage' and role = 'cs_staff'::public.organization_role;

commit;
