-- 알바 급여 — 급여 계좌 · 그 달만 지급 방식 (2026-10-26).
--
-- 도메인 계약: docs/product/39-part-time-payroll-automation-plan.md §3-A(급여 계좌) · §3-B(그 달만 지급 방식)
-- 데이터 모델: docs/engineering/04-data-model.md → member_bank_accounts · member_bank_account_changes · payroll_month_inputs
--
-- 결정(2026-10-26 사용자 확정):
--   * 계좌 칸: 은행 · 지점 · 종류(보통 ordinary / 당좌 current) · 번호(숫자 7자리) · 명의(가타카나). 유초은행도 이체용 지점명 · 7자리로 적는다.
--   * 본인이 바꾸면 `pending = true` — 급여 담당(payroll.manage)이 「확인함」 할 때까지 이체는 **이전에 확인한 계좌**(confirmed_*)로.
--     관리자가 바꾸면 바로 확인됨(confirmed_* = 지금 값). 처음 등록인데 확인한 계좌가 없으면 지금 값을 쓴다(확인 필요는 표시).
--   * 보기: 본인 + payroll.view. 쓰기 · 읽기 모두 서버(service role)만 — 정책 없음, GRANT 같이 둔다.
--   * 이력: 바꿀 때마다 한 줄(누가 · 본인인지 · 이전 은행 + 끝 4자리 · 새 은행 + 끝 4자리). 번호 전체는 이력에 남기지 않는다. 지우지 않는다.

create table if not exists public.member_bank_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_name text not null check (char_length(bank_name) between 1 and 60),
  branch_name text not null check (char_length(branch_name) between 1 and 60),
  account_type text not null check (account_type in ('ordinary', 'current')),
  account_number text not null check (account_number ~ '^[0-9]{7}$'),
  holder_kana text not null check (char_length(holder_kana) between 1 and 80),
  pending boolean not null default false,
  confirmed_bank_name text,
  confirmed_branch_name text,
  confirmed_account_type text check (confirmed_account_type is null or confirmed_account_type in ('ordinary', 'current')),
  confirmed_account_number text check (confirmed_account_number is null or confirmed_account_number ~ '^[0-9]{7}$'),
  confirmed_holder_kana text,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.member_bank_accounts is '알바 급여 계좌 — 지금 값 + 마지막으로 확인한 값. 본인 변경은 pending. docs/product/39 §3-A';

alter table public.member_bank_accounts enable row level security;
-- 정책 없음 — 서버(service role, 본인 또는 payroll.view · payroll.manage 확인)만 쓴다.
grant all on public.member_bank_accounts to service_role;

create table if not exists public.member_bank_account_changes (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('created', 'updated', 'confirmed')),
  by_self boolean not null default false,
  changed_by uuid references public.profiles(id) on delete set null,
  prev_bank_name text,
  prev_last4 text check (prev_last4 is null or prev_last4 ~ '^[0-9]{4}$'),
  new_bank_name text,
  new_last4 text check (new_last4 is null or new_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now()
);

create index if not exists member_bank_account_changes_user_idx
  on public.member_bank_account_changes (organization_id, user_id, created_at desc);

comment on table public.member_bank_account_changes is '급여 계좌 바뀐 기록 — 은행 + 끝 4자리만. docs/product/39 §3-A';

alter table public.member_bank_account_changes enable row level security;
grant all on public.member_bank_account_changes to service_role;
grant usage, select on sequence public.member_bank_account_changes_id_seq to service_role;

-- 그 달만 지급 방식 — null = 사람별 기본 설정을 따른다.
alter table public.payroll_month_inputs
  add column if not exists payment_method_override text
  check (payment_method_override is null or payment_method_override in ('cash', 'transfer'));
