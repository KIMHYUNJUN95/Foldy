-- 알바 급여 P3 — 급여 준비 손 입력(사람 · 달마다) (2026-10-25).
--
-- 도메인 계약: docs/product/39-part-time-payroll-automation-plan.md §3-B · §5-A · §9 · §10(P3)
--             docs/product/40-part-time-payroll-workflow.md §4-2
-- 데이터 모델: docs/engineering/04-data-model.md → payroll_month_inputs
--
-- 결정:
--   * 손으로 넣는 값만 둔다. 계산값(총지급 · 원천세 · 실수령)은 저장하지 않고 그때그때 P2 엔진(`calculatePayrollMonth`)으로 낸다 —
--     결재 · 지급 때 굳히는 건 P5 스냅샷.
--   * 잔업 · 주말 · 특별수당 칸은 Foldy 추가수당(자동) **위에 더하는** 금액(±). 화면은 자동 + 손 = 합계를 보여 주고, 합계를 고치면 차이를 저장한다.
--   * 지난달 조정(前月調整額, ±)은 종류(과세 급여 / 교통비)와 몇 월분(`YYYY-MM`)을 같이 — 금액이 있는데 몇 월분이 없으면 「확인 필요」.
--   * 원천세 · 고용보험 손 덮어쓰기는 null = 계산값. 원천세를 바꾸면 사유가 있어야 결재 요청이 열린다(사유 없으면 「확인 필요」).
--   * 통근 과세 칸은 없음 — 교통비는 전부 비과세(39 §11-4).
--   * 쓰기 · 읽기 모두 서버(service role)만 — 정책 없음. 새 표는 기본 권한이 없으므로 GRANT 를 꼭 같이 둔다.

create table if not exists public.payroll_month_inputs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_month date not null check (extract(day from target_month) = 1),
  overtime integer not null default 0,
  weekend integer not null default 0,
  special integer not null default 0,
  prev_adjustment integer not null default 0,
  prev_adjustment_kind text not null default 'taxable' check (prev_adjustment_kind in ('taxable', 'commute')),
  prev_adjustment_month date check (prev_adjustment_month is null or extract(day from prev_adjustment_month) = 1),
  year_end_adjustment integer not null default 0,
  withholding_override integer check (withholding_override is null or withholding_override >= 0),
  withholding_override_reason text,
  employment_insurance_override integer check (employment_insurance_override is null or employment_insurance_override >= 0),
  memo text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, target_month)
);

comment on table public.payroll_month_inputs is '알바 급여 준비 손 입력 — 사람 · 달마다(수당 · 지난달 조정 · 연말정산 · 덮어쓰기). docs/product/39 §3-B';

alter table public.payroll_month_inputs enable row level security;
-- 정책 없음 — authenticated 는 읽기 · 쓰기 모두 막힌다. 서버(service role, payroll.view · payroll.manage 확인)만 쓴다.
grant all on public.payroll_month_inputs to service_role;
