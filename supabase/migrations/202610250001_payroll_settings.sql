-- 알바 급여 P1 — 사람별 급여 설정 · 회사 급여 설정 (2026-10-25).
--
-- 도메인 계약: docs/product/39-part-time-payroll-automation-plan.md §3-A · §3-C · §9 · §10(P1)
-- 데이터 모델: docs/engineering/04-data-model.md → payroll_member_settings · org_payroll_settings
--
-- 결정:
--   * 사람별 설정은 「지금 값」 한 줄(이력 없음). 바꾼 기록은 audit_logs(`payroll_member_setting_update`, 전 · 후 값)에 남긴다.
--     급여 회차에 굳히는 건 P5 마감 스냅샷이 한다 — 이 표는 아직 마감하지 않은 달부터 쓰인다.
--   * 지급 방식 · 원천세 구분은 기본값 없음(null = 아직 안 고름 → 「확인 필요」). 인사팀: 지급 방식 = 본인 희망, 워홀 = 甲 · 2개월 이내 = 丙.
--   * 부양 인원은 받아만 둔다(0~7). 계산 반영은 세무사 답(19 A4) 뒤 P2.
--   * 가타카나 이름 · 입사일은 profiles(`name_katakana` · `hire_date`)를 쓴다 — 여기 다시 두지 않는다.
--   * 회사 설정: 지급일(1~28, 기본 10). 휴일 · 토일이면 **앞 평일 고정**(2026-10-25 결정 — 선택지 없음).
--     雇用保険 근로자 부담률은 연도별 `{"2026": 5.5}`(1,000분의 n) — 없는 해는 빈칸.
--   * 쓰기 · 읽기 모두 서버(service role)만 — 정책 없음. 새 표는 기본 권한이 없으므로 GRANT 를 꼭 같이 둔다(202610230002 교훈).

create table if not exists public.payroll_member_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_method text check (payment_method in ('cash', 'transfer')),
  withholding_class text check (withholding_class in ('kou', 'otsu', 'hei')),
  dependents smallint not null default 0 check (dependents between 0 and 7),
  employment_insurance boolean not null default false,
  employment_insurance_since date,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.payroll_member_settings is '알바 급여 사람별 설정 — 지급 방식 · 원천세 구분 · 부양 · 雇用保険. docs/product/39 §3-A';

alter table public.payroll_member_settings enable row level security;
-- 정책 없음 — authenticated 는 읽기 · 쓰기 모두 막힌다. 서버 액션(service role, wages.manage 확인)만 쓴다.
grant all on public.payroll_member_settings to service_role;

create table if not exists public.org_payroll_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  company_name text,
  pay_day smallint not null default 10 check (pay_day between 1 and 28),
  senmu_approver_id uuid references public.profiles(id) on delete set null,
  president_approver_id uuid references public.profiles(id) on delete set null,
  employment_insurance_rates jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (senmu_approver_id is null or president_approver_id is null or senmu_approver_id <> president_approver_id)
);

comment on table public.org_payroll_settings is '알바 급여 회사 설정 — 会社名 · 지급일 · 결재자 · 雇用保険 부담률(연도별). docs/product/39 §3-C';

alter table public.org_payroll_settings enable row level security;
-- 정책 없음 — 서버 액션(service role, payroll.manage 확인)만 쓴다.
grant all on public.org_payroll_settings to service_role;
