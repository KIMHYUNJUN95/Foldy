import Link from "next/link";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import "./payroll-prep.css";

export type PrepStage = "prep" | "close";

/** 근태 마감 → 급여 준비 → 결재 → 지급. 앞 두 단계만 열려 있다(결재 · 지급은 다음 단계). */
export function PrepSteps({ ym, stage, copy }: { ym: string; stage: PrepStage; copy: PayrollPrepCopy }) {
  const href = (s: PrepStage) => `/admin/attendance/payroll?ym=${ym}&stage=${s}`;
  return (
    <nav className="pst" aria-label={copy.stepsLabel}>
      <Link className={`pst__s ${stage === "close" ? "now" : "ok"}`} href={href("close")} aria-current={stage === "close" ? "step" : undefined}>
        <i aria-hidden="true" />
        {copy.stepClose}
      </Link>
      <em className="pst__e" aria-hidden="true" />
      <Link className={`pst__s ${stage === "prep" ? "now" : ""}`} href={href("prep")} aria-current={stage === "prep" ? "step" : undefined}>
        <i aria-hidden="true" />
        {copy.stepPrep}
      </Link>
      <em className="pst__e" aria-hidden="true" />
      <span className="pst__s" aria-disabled="true" title={copy.stepLater}>
        <i aria-hidden="true" />
        {copy.stepApproval}
      </span>
      <em className="pst__e" aria-hidden="true" />
      <span className="pst__s" aria-disabled="true" title={copy.stepLater}>
        <i aria-hidden="true" />
        {copy.stepPay}
      </span>
    </nav>
  );
}
