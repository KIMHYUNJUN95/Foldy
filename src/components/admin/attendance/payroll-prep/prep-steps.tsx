import Link from "next/link";
import type { PayrollRoundStatus } from "@/lib/payroll-approval";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { approvalOpen, payOpen, stageHref, type PrepStage } from "./round-ui";
import "./payroll-prep.css";

export type { PrepStage } from "./round-ui";

/**
 * 근태 마감 → 급여 준비 → 결재 → 지급. 결재는 요청 뒤, 지급은 사장 결재 뒤에 열린다(P5).
 * 지난 단계는 검은 점(ok), 지금 보는 단계는 보라 점(now).
 */
export function PrepSteps({
  ym,
  stage,
  status,
  copy,
}: {
  ym: string;
  stage: PrepStage;
  status: PayrollRoundStatus;
  copy: PayrollPrepCopy;
}) {
  const steps: { id: PrepStage; label: string; open: boolean; done: boolean }[] = [
    { id: "close", label: copy.stepClose, open: true, done: true },
    { id: "prep", label: copy.stepPrep, open: true, done: approvalOpen(status) },
    { id: "approval", label: copy.stepApproval, open: approvalOpen(status), done: payOpen(status) },
    { id: "pay", label: copy.stepPay, open: payOpen(status), done: status === "paid" || status === "sent_to_accountant" },
  ];
  return (
    <nav className="pst" aria-label={copy.stepsLabel}>
      {steps.map((s, i) => {
        const cls = `pst__s${stage === s.id ? " now" : s.done ? " ok" : ""}`;
        return (
          <span key={s.id} style={{ display: "contents" }}>
            {i > 0 ? <em className="pst__e" aria-hidden="true" /> : null}
            {s.open ? (
              <Link className={cls} href={stageHref(ym, s.id)} aria-current={stage === s.id ? "step" : undefined}>
                <i aria-hidden="true" />
                {s.label}
              </Link>
            ) : (
              <span className={cls} aria-disabled="true">
                <i aria-hidden="true" />
                {s.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
