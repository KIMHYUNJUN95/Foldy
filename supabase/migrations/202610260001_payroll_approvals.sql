-- 알바 급여 P5 — 결재(전무 → 사장) · 지급 확인 · 세무사 송부 (2026-10-26).
--
-- 도메인 계약: docs/product/40-part-time-payroll-workflow.md §4-3 ~ §4-5 · §6, 39 §8 · §9 · 「P5 구현」
-- 데이터 모델: docs/engineering/04-data-model.md → payroll_month_approvals · payroll_month_approval_events · payroll_payment_checks
--
-- 결정(2026-10-26 사용자):
--   * 「결재 요청」 순간 그 달 급여 준비 값을 스냅샷(jsonb)으로 굳힌다 — 결재자는 그 숫자를 결재하고, 지급 확인 · 출력도 그 숫자를 쓴다.
--     결재가 시작되면 입력은 잠긴다(문서 40 의 「숫자가 바뀌면 결재가 풀림」 대신). 고치려면 돌려보내기 · 결재 되돌리기(사유) → 급여 준비.
--   * 결재는 한 번 누르기 + 되돌리기. 결재자 = 설정 › 급여의 専務 · 社長 결재자(요청 순간 값을 이 줄에 적어 둔다). 専務 칸이 비어 있으면 社長만.
--   * 지급 확인: 현금 = 봉투 넣음 → 본인 확인, 이체 = 이체 완료. 전원 끝나면 「지급 완료」, 그 뒤 세무사 「보냄」.
--   * 쓰기 · 읽기 모두 서버(service role)만 — 정책 없음. 새 표는 기본 권한이 없으므로 GRANT 를 꼭 같이 둔다.

-- 1) 권한 키 `payroll.approve` — 급여 결재. 기본 대표 · 전무(원본: src/config/capabilities.ts).
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('payroll.approve', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('payroll.approve', 'owner'::organization_role),
  ('payroll.approve', 'senior_managing_director'::organization_role)
on conflict do nothing;

-- 2) 급여 회차(조직 · 달) — 상태 · 스냅샷 · 결재 기록. 줄이 없으면 「급여 준비」.
create table if not exists public.payroll_month_approvals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_month date not null check (extract(day from target_month) = 1),
  status text not null default 'preparing'
    check (status in ('preparing', 'approval_senmu', 'approval_president', 'paying', 'paid', 'sent_to_accountant')),
  snapshot jsonb,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz,
  senmu_approver_id uuid references public.profiles(id) on delete set null,
  president_approver_id uuid references public.profiles(id) on delete set null,
  senmu_approved_by uuid references public.profiles(id) on delete set null,
  senmu_approved_at timestamptz,
  president_approved_by uuid references public.profiles(id) on delete set null,
  president_approved_at timestamptz,
  paid_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, target_month),
  check (status = 'preparing' or snapshot is not null)
);

comment on table public.payroll_month_approvals is '알바 급여 회차 — 상태(급여 준비 → 결재 → 지급 → 지급 완료 → 세무사 송부) · 결재 요청 때 굳힌 스냅샷 · 결재 기록. docs/product/40 §6';

alter table public.payroll_month_approvals enable row level security;
-- 정책 없음 — 서버(service role, payroll.view · payroll.manage · payroll.approve 확인)만 쓴다.
grant all on public.payroll_month_approvals to service_role;

-- 3) 상태가 바뀔 때마다 한 줄 — 누가 · 언제 · 사유.
create table if not exists public.payroll_month_approval_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_month date not null,
  action text not null check (action in (
    'request', 'cancel_request', 'approve', 'undo_approve', 'return', 'revert', 'paid', 'unpaid', 'sent', 'unsent'
  )),
  slot text check (slot in ('senmu', 'president')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists payroll_month_approval_events_month_idx
  on public.payroll_month_approval_events (organization_id, target_month, created_at);

comment on table public.payroll_month_approval_events is '알바 급여 회차 기록 — 결재 요청 · 결재 · 돌려보내기 · 지급 완료 · 송부(누가 · 언제 · 사유). docs/product/40 §6';

alter table public.payroll_month_approval_events enable row level security;
grant all on public.payroll_month_approval_events to service_role;

-- 4) 지급 확인 — 사람 · 달마다. 체크를 풀면 칸을 비운다(지금 값 한 줄, 기록은 audit_logs).
create table if not exists public.payroll_payment_checks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_month date not null check (extract(day from target_month) = 1),
  envelope_by uuid references public.profiles(id) on delete set null,
  envelope_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  received_at timestamptz,
  transferred_by uuid references public.profiles(id) on delete set null,
  transferred_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, target_month),
  check (received_at is null or envelope_at is not null)
);

comment on table public.payroll_payment_checks is '알바 급여 지급 확인 — 현금 봉투 넣음 · 본인 확인 / 이체 완료(누가 · 언제). docs/product/40 §4-4';

alter table public.payroll_payment_checks enable row level security;
grant all on public.payroll_payment_checks to service_role;
