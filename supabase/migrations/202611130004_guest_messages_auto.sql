-- 손님 메시지 5단계 — 자동 안내 규칙 · 보낼 예정(실행) · 자동 안내 넣기 함수 (2026-11-13).
--
-- 문서: docs/product/47-guest-messaging.md §5-3 · §5-6 · §7 · docs/engineering/04-data-model.md · 05-rls-permissions.md 「손님 메시지」
-- 상태: **운영 미적용** — 적용은 사용자 컨펌 뒤(Dashboard SQL Editor). 202611120002(운영 적용됨)는 고치지 않는다.
-- 202611130001 · 0002 · 0003(다른 단계, 미적용) 뒤에 돈다 — guest_messages.body_lang(0001) 를 쓴다.
--
-- 1) `auto_message_rules` — 조직마다 자동 안내 규칙. 읽기 = `guest_messages.manage`, 쓰기 정책 없음(서버 액션이 확인 후 service_role).
-- 2) `auto_message_runs` — 규칙 × 예약 하나에 한 줄(**같은 규칙이 같은 예약에 두 번 가지 않게** 고유). 읽기 = `guest_messages.view`.
-- 3) `guest_message_outbox.rule_id` 외래 키(1단계에서 미뤄 둔 것).
-- 4) `guest_message_enqueue_auto()` — 실행 줄 잠금 + 발송 큐 줄 + 대기 메시지 줄 + 실행 상태를 한 번에(서버만).
--
-- 다시 돌려도 안전하게 `if not exists` · `drop ... if exists`.

begin;

-- ── 1) 자동 안내 규칙 ─────────────────────────────────────────────────────
create table if not exists public.auto_message_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 직원이 보는 이름(손님에게는 나가지 않는다).
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- confirmed: 예약이 확정된 것을 처음 본 직후 · before_checkin: 체크인 N일 전 · day_of_checkin: 체크인 당일 ·
  -- before_checkout: 체크아웃 N일 전(0 = 체크아웃 당일) · after_checkout: 체크아웃 N일 뒤.
  trigger text not null check (trigger in ('confirmed', 'before_checkin', 'day_of_checkin', 'before_checkout', 'after_checkout')),
  offset_days integer not null default 0 check (offset_days between 0 and 30),
  -- 보낼 시각(도쿄, HH:MM). 확정 직후는 시각이 없다.
  send_time text check (send_time is null or send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 대상. 빈 배열 = 전부. 건물은 건물 키(arakicho_a …), 채널은 OTA 키, 예약 상태는 confirmed · request · inquiry.
  target_buildings text[] not null default '{}' check (cardinality(target_buildings) <= 40),
  target_channels text[] not null default '{}'
    check (target_channels <@ array['airbnb', 'booking', 'expedia', 'agoda', 'vrbo']::text[]),
  target_statuses text[] not null default array['confirmed']::text[]
    check (cardinality(target_statuses) >= 1 and target_statuses <@ array['confirmed', 'request', 'inquiry']::text[]),
  -- 손님 언어별 본문. ko · ja · en 이 아닌 손님은 영어, 그 언어가 비면 영어(영어도 비면 보내지 않음 — no_body).
  body_ko text not null default '' check (char_length(body_ko) <= 2000),
  body_ja text not null default '' check (char_length(body_ja) <= 2000),
  body_en text not null default '' check (char_length(body_en) <= 2000),
  enabled boolean not null default false,
  -- 마지막으로 켠 시각 — 「확정 직후」는 이 뒤에 들어온 예약에만(켜자마자 옛 예약 전부에 나가지 않게).
  enabled_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- 글의 버전(고치기 저장은 이 값일 때만 — 앱). 켜기 · 순서만 바뀌면 올리지 않는다(트리거).
  updated_at timestamptz not null default now(),
  constraint auto_message_rules_id_org_key unique (id, organization_id),
  constraint auto_message_rules_time_check check ((trigger = 'confirmed') = (send_time is null)),
  constraint auto_message_rules_offset_check check (
    (trigger = 'confirmed' and offset_days = 0)
    or (trigger = 'day_of_checkin' and offset_days = 0)
    or (trigger = 'before_checkin' and offset_days >= 1)
    or (trigger = 'before_checkout' and offset_days >= 0)
    or (trigger = 'after_checkout' and offset_days >= 1)
  ),
  constraint auto_message_rules_body_check check (char_length(btrim(body_ko || body_ja || body_en)) > 0)
);

comment on table public.auto_message_rules is
  '손님 메시지 자동 안내 규칙(조직마다). 시각은 도쿄. 직접 예약 · 채널 모름 · 빈 변수는 보내지 않는다. docs/product/47-guest-messaging.md §5-3 · §5-6';

create index if not exists auto_message_rules_org_sort_idx on public.auto_message_rules (organization_id, sort_order, created_at);
create index if not exists auto_message_rules_created_by_idx on public.auto_message_rules (created_by) where created_by is not null;

create or replace function public.auto_message_rules_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.name, new.trigger, new.offset_days, new.send_time, new.target_buildings, new.target_channels, new.target_statuses,
      new.body_ko, new.body_ja, new.body_en)
     is distinct from
     (old.name, old.trigger, old.offset_days, old.send_time, old.target_buildings, old.target_channels, old.target_statuses,
      old.body_ko, old.body_ja, old.body_en) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  -- 꺼짐 → 켜짐이면 켠 시각을 새로.
  if new.enabled and not old.enabled then
    new.enabled_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.auto_message_rules_touch() from public, anon, authenticated;

drop trigger if exists auto_message_rules_touch on public.auto_message_rules;
create trigger auto_message_rules_touch
before update on public.auto_message_rules
for each row execute function public.auto_message_rules_touch();

alter table public.auto_message_rules enable row level security;

-- 읽기: 그 조직에서 관리 권한이 있는 사람(+ 플랫폼 개발자). 쓰기 정책은 일부러 두지 않는다.
drop policy if exists "auto message rules: managers can read" on public.auto_message_rules;
create policy "auto message rules: managers can read"
on public.auto_message_rules
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.manage')
);

revoke all on table public.auto_message_rules from public, anon, authenticated;
grant select on table public.auto_message_rules to authenticated;
grant all on table public.auto_message_rules to service_role;

-- ── 2) 보낼 예정(실행) — 규칙 × 예약 하나에 한 줄 ─────────────────────────────
create table if not exists public.auto_message_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rule_id uuid not null,
  provider text not null default 'beds24' check (provider ~ '^[a-z0-9_]{2,32}$'),
  -- 통로 쪽 예약 번호(Beds24 자기 번호 — 대화와 같은 키).
  provider_booking_id text not null check (length(btrim(provider_booking_id)) > 0),
  reservation_id uuid references public.reservations (id) on delete set null,
  conversation_id uuid references public.guest_conversations (id) on delete set null,
  -- 목록 표시용 사본(정본 건물 이름 — 화면에서 localize).
  property_name text,
  room_label text,
  guest_name text,
  check_in_date date,
  check_out_date date,
  channel text,
  -- 이 줄을 계획할 때 규칙의 트리거 — 규칙의 트리거가 바뀌면 보낼 시각을 처음부터 다시 정한다(확정 직후의 「처음 본 순간」을 옛 시각으로 두지 않게).
  rule_trigger text check (rule_trigger is null or rule_trigger in ('confirmed', 'before_checkin', 'day_of_checkin', 'before_checkout', 'after_checkout')),
  scheduled_at timestamptz not null,
  -- scheduled: 그 시각에 보냄 · skipped: 보내지 않음(이유 skip_reason) · paused: 직원이 이 예약만 멈춤 ·
  -- queued: 발송 큐에 넣음(outbox_id) · sent · failed: 발송 결과 · cancelled: 예약 취소 · 규칙 꺼짐 · 대상 아님.
  status text not null default 'scheduled'
    check (status in ('scheduled', 'skipped', 'paused', 'queued', 'sent', 'failed', 'cancelled')),
  skip_reason text check (
    skip_reason is null or skip_reason in (
      'empty_variable', 'direct_booking', 'unknown_channel', 'cancelled', 'past_due', 'no_body', 'rule_disabled', 'not_target'
    )
  ),
  -- empty_variable 일 때 빈 변수 이름들(화면에 빨갛게).
  missing_variables text[] not null default '{}',
  -- 직원이 멈춘 시각 · 사람(다시 계획해도 멈춤은 남는다).
  paused_at timestamptz,
  paused_by uuid references auth.users (id) on delete set null,
  outbox_id uuid references public.guest_message_outbox (id) on delete set null,
  queued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auto_message_runs_rule_fkey
    foreign key (rule_id, organization_id) references public.auto_message_rules (id, organization_id) on delete cascade,
  -- 같은 규칙이 같은 예약에 두 번 가지 않는다.
  constraint auto_message_runs_rule_booking_key unique (rule_id, provider, provider_booking_id),
  constraint auto_message_runs_skip_check check ((status in ('skipped', 'cancelled')) = (skip_reason is not null)),
  -- outbox_id 가 아니라 queued_at 으로 본다 — 발송 큐 줄이 지워지면(대화 · 조직 삭제) outbox_id 가 null 이 되는데,
  -- 그때 이 검사가 그 삭제를 막으면 안 된다(로컬 확인 2026-11-12).
  constraint auto_message_runs_queued_check check (status not in ('queued', 'sent', 'failed') or queued_at is not null)
);

comment on table public.auto_message_runs is
  '자동 안내 보낼 예정 — 규칙 × 예약 하나에 한 줄(고유). 계획은 src/lib/guest-messages/auto-scheduler.ts 가 다시 계산한다. docs/product/47-guest-messaging.md §5-6';

create index if not exists auto_message_runs_due_idx
  on public.auto_message_runs (organization_id, scheduled_at) where status = 'scheduled';
create index if not exists auto_message_runs_org_booking_idx
  on public.auto_message_runs (organization_id, provider, provider_booking_id);
create index if not exists auto_message_runs_org_scheduled_idx
  on public.auto_message_runs (organization_id, scheduled_at);
create index if not exists auto_message_runs_rule_idx on public.auto_message_runs (rule_id);
create index if not exists auto_message_runs_reservation_idx on public.auto_message_runs (reservation_id) where reservation_id is not null;
create index if not exists auto_message_runs_conversation_idx on public.auto_message_runs (conversation_id) where conversation_id is not null;
create index if not exists auto_message_runs_outbox_idx on public.auto_message_runs (outbox_id) where outbox_id is not null;
create index if not exists auto_message_runs_paused_by_idx on public.auto_message_runs (paused_by) where paused_by is not null;

alter table public.auto_message_runs enable row level security;

drop policy if exists "auto message runs: viewers can read" on public.auto_message_runs;
create policy "auto message runs: viewers can read"
on public.auto_message_runs
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
);

revoke all on table public.auto_message_runs from public, anon, authenticated;
grant select on table public.auto_message_runs to authenticated;
grant all on table public.auto_message_runs to service_role;

-- ── 3) 발송 큐 → 규칙 외래 키 ───────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'guest_message_outbox_rule_fkey' and conrelid = 'public.guest_message_outbox'::regclass
  ) then
    -- 규칙 표가 생기기 전에 들어간 rule_id(있다면)는 가리킬 곳이 없다 — 외래 키가 실패하지 않게 비운다.
    update public.guest_message_outbox o set rule_id = null
    where o.rule_id is not null and not exists (select 1 from public.auto_message_rules r where r.id = o.rule_id);
    alter table public.guest_message_outbox
      add constraint guest_message_outbox_rule_fkey
      foreign key (rule_id) references public.auto_message_rules (id) on delete set null;
  end if;
end;
$$;
create index if not exists guest_message_outbox_rule_idx on public.guest_message_outbox (rule_id) where rule_id is not null;

-- ── 4) 자동 안내 넣기 — 실행 줄 잠금 + 큐 줄 + 대기 메시지 줄 + 실행 상태를 한 번에 ─────────
-- 실행이 아직 scheduled 이고 멈춤 표시가 없을 때만 넣는다(그 사이 직원이 멈췄거나 · 예약이 취소돼 계획이 바꿨으면 넣지 않음).
-- 멱등 키 = 'auto:' || 실행 번호 — 같은 실행은 큐에 한 번만 들어간다.
create or replace function public.guest_message_enqueue_auto(
  p_organization_id uuid,
  p_run_id uuid,
  p_conversation_id uuid,
  p_provider text,
  p_body text,
  p_now timestamptz default now()
)
returns table (outbox_id uuid, enqueued boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rule uuid;
  v_status text;
  v_paused timestamptz;
  v_id uuid;
  v_key text := 'auto:' || p_run_id::text;
begin
  select r.rule_id, r.status, r.paused_at into v_rule, v_status, v_paused
  from public.auto_message_runs r
  where r.id = p_run_id and r.organization_id = p_organization_id
  for update;
  -- 멈춤 표시가 있으면 넣지 않는다 — 계획이 옛 값으로 status 를 scheduled 로 되돌린 틈(직원이 막 멈춘 순간)이어도.
  if v_rule is null or v_status <> 'scheduled' or v_paused is not null then
    return query select null::uuid, false;
    return;
  end if;

  insert into public.guest_message_outbox
    (organization_id, conversation_id, kind, rule_id, body, status, next_try_at, idempotency_key)
  values
    (p_organization_id, p_conversation_id, 'auto', v_rule, p_body, 'queued', p_now, v_key)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select o.id into v_id from public.guest_message_outbox o
    where o.organization_id = p_organization_id and o.idempotency_key = v_key;
  else
    insert into public.guest_messages
      (organization_id, conversation_id, provider, direction, body, sent_at, outbox_id)
    values
      (p_organization_id, p_conversation_id, p_provider, 'host', p_body, p_now, v_id);
  end if;

  update public.auto_message_runs r
  set status = 'queued', skip_reason = null, outbox_id = v_id, queued_at = p_now,
      conversation_id = p_conversation_id, updated_at = p_now
  where r.id = p_run_id and r.organization_id = p_organization_id;

  return query select v_id, true;
end;
$$;
revoke all on function public.guest_message_enqueue_auto(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_message_enqueue_auto(uuid, uuid, uuid, text, text, timestamptz) to service_role;

commit;
