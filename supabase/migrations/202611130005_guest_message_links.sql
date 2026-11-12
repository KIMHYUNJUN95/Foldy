-- 손님 메시지 6단계 — 메시지 → 업무 한 번에(2026-11-13). docs/product/47-guest-messaging.md §6-4 · §5-7
--
-- 1) guest_message_links: 대화(와 고른 손님 말 하나) ↔ 업무(수리 · 점검 / 분실물 / 할 일 / 게스트 피드백) 한 줄.
--    업무 하나에는 링크 하나(`unique (organization_id, target_type, target_id)`). 업무 쪽은 여러 표라 외래 키를 걸 수 없다 —
--    서버 액션이 같은 조직의 업무를 방금 만든 뒤에만 넣고, 화면은 업무가 지워졌으면 「지워짐」으로 그린다.
--    읽기 = 그 조직에서 `guest_messages.view`(+ 플랫폼 개발자). 쓰기 = 서버(service_role)만 — 일반 사용자 넣기 · 고치기 · 지우기 정책 없음.
-- 2) guest_message_saved_replies.purpose: 'resolved' 로 표시한 문구 하나(조직마다)를 「해결됐어요」 답장 초안으로 쓴다.
--
-- 다시 돌려도 안전하게 `if not exists` · `drop ... if exists`. 202611120002(운영 적용됨)는 고치지 않는다.

-- ── 1) 링크 표 ─────────────────────────────────────────────────────────────
create table if not exists public.guest_message_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.guest_conversations (id) on delete cascade,
  -- 업무에 붙인 손님 말(여럿 골랐으면 가장 이른 것). 메시지가 지워져도 링크는 남는다.
  message_id uuid references public.guest_messages (id) on delete set null,
  target_type text not null check (target_type in ('maintenance', 'lost_found', 'task', 'complaint')),
  target_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint guest_message_links_target_unique unique (organization_id, target_type, target_id)
);

comment on table public.guest_message_links is
  '손님 메시지 대화 ↔ 업무(수리 · 점검 · 분실물 · 할 일 · 게스트 피드백). 업무 하나에 한 줄. 쓰기는 서버만. docs/product/47-guest-messaging.md §6-4';

create index if not exists guest_message_links_conversation_idx
  on public.guest_message_links (conversation_id, created_at);
create index if not exists guest_message_links_message_idx
  on public.guest_message_links (message_id) where message_id is not null;
create index if not exists guest_message_links_created_by_idx
  on public.guest_message_links (created_by) where created_by is not null;

-- 대화 · 메시지 · 업무가 같은 조직(· 같은 대화)인지 DB 가 한 번 더 본다(서비스 키 경로의 실수로 다른 조직 대화 · 업무에 링크가 붙지 않게).
-- 업무는 표가 여럿이라 외래 키 대신 여기서 종류마다 그 표에 같은 조직 줄이 있는지 본다(넣을 때만 — 업무가 나중에 지워지는 것은 막지 않는다).
create or replace function public.guest_message_links_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.guest_conversations c
    where c.id = new.conversation_id and c.organization_id = new.organization_id
  ) then
    raise exception 'guest_message_links: conversation is not in this organization' using errcode = '23514';
  end if;
  if new.message_id is not null and not exists (
    select 1 from public.guest_messages m
    where m.id = new.message_id and m.conversation_id = new.conversation_id and m.organization_id = new.organization_id
  ) then
    raise exception 'guest_message_links: message is not in this conversation' using errcode = '23514';
  end if;
  if not (
    case new.target_type
      when 'maintenance' then exists (select 1 from public.maintenance_reports t where t.id = new.target_id and t.organization_id = new.organization_id)
      when 'lost_found' then exists (select 1 from public.lost_items t where t.id = new.target_id and t.organization_id = new.organization_id)
      when 'task' then exists (select 1 from public.tasks t where t.id = new.target_id and t.organization_id = new.organization_id)
      when 'complaint' then exists (select 1 from public.customer_complaints t where t.id = new.target_id and t.organization_id = new.organization_id)
      else false
    end
  ) then
    raise exception 'guest_message_links: target is not in this organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guest_message_links_check() from public, anon, authenticated;

drop trigger if exists guest_message_links_check on public.guest_message_links;
create trigger guest_message_links_check
before insert or update of organization_id, conversation_id, message_id, target_type, target_id on public.guest_message_links
for each row execute function public.guest_message_links_check();

alter table public.guest_message_links enable row level security;

drop policy if exists "guest message links: viewers can read" on public.guest_message_links;
create policy "guest message links: viewers can read"
on public.guest_message_links
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.view')
);

revoke all on table public.guest_message_links from public, anon, authenticated;
grant select on table public.guest_message_links to authenticated;
grant all on table public.guest_message_links to service_role;

-- ── 2) 「해결됐어요」 초안으로 쓸 문구 ───────────────────────────────────
alter table public.guest_message_saved_replies
  add column if not exists purpose text;

alter table public.guest_message_saved_replies
  drop constraint if exists guest_message_saved_replies_purpose_check;
alter table public.guest_message_saved_replies
  add constraint guest_message_saved_replies_purpose_check check (purpose is null or purpose in ('resolved'));

-- 조직마다 하나만.
create unique index if not exists guest_message_saved_replies_resolved_unique
  on public.guest_message_saved_replies (organization_id)
  where purpose = 'resolved';

comment on column public.guest_message_saved_replies.purpose is
  '''resolved'' = 이어진 업무가 끝났을 때 답장 칸에 띄울 「해결됐어요」 초안(자동으로 보내지 않는다). 조직마다 하나. 비어 있으면 앱 기본 문구.';

-- 「해결됐어요」 문구 바꾸기를 한 번에(지우기 + 붙이기가 한 트랜잭션 — 중간에 실패하면 예전 표시가 그대로 남는다).
-- 고른 줄이 이 조직에 없으면 아무것도 바꾸지 않고 false. p_id = null 이면 지우기만(true). 서버(service_role)만 부른다.
create or replace function public.guest_message_set_resolved_reply(p_organization_id uuid, p_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_id is not null and not exists (
    select 1 from public.guest_message_saved_replies r where r.id = p_id and r.organization_id = p_organization_id
  ) then
    return false;
  end if;
  -- 지우고 붙인다(순서를 바꾸면 조직마다 하나 고유 색인에 걸린다). 한 함수 = 한 트랜잭션.
  update public.guest_message_saved_replies
     set purpose = null
   where organization_id = p_organization_id and purpose = 'resolved' and id is distinct from p_id;
  if p_id is not null then
    update public.guest_message_saved_replies
       set purpose = 'resolved'
     where organization_id = p_organization_id and id = p_id;
  end if;
  return true;
end;
$$;

revoke all on function public.guest_message_set_resolved_reply(uuid, uuid) from public, anon, authenticated;
grant execute on function public.guest_message_set_resolved_reply(uuid, uuid) to service_role;
