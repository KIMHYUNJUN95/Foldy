"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Locale } from "@/lib/i18n";
import type { PayrollPrepData } from "@/lib/payroll-prep-server";
import { getPayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { AdminUndoToast } from "../../shared/admin-undo-toast";
import { PayrollApprovalView } from "./payroll-approval-view";
import { PayrollPayView } from "./payroll-pay-view";
import { PayrollPrepClient } from "./payroll-prep-client";
import "./payroll-prep.css";

export type RoundToast = {
  /** 실행 취소 토스트(undo 가 있으면) — 없으면 그냥 알림. */
  announce: (message: string, undo?: () => Promise<void>) => void;
  /** 잠깐 뜨는 알림(실패 · 되돌림). */
  notice: (message: string) => void;
};

type Toast = { stamp: number; message: string; undo?: () => Promise<void> };

/**
 * 급여 탭의 급여 준비 · 결재 · 지급(P5) — 단계가 바뀌어도(결재 요청 → 결재 화면) 토스트가 살아 있도록
 * 토스트를 여기서 한 번만 들고, 단계별 화면은 `toast` 로 부른다.
 */
export function PayrollRoundClient({
  data,
  locale,
  localeTag,
  stage,
  canViewBank,
}: {
  data: PayrollPrepData;
  locale: Locale;
  localeTag: string;
  stage: "prep" | "approval" | "pay";
  canViewBank: boolean;
}) {
  const copy = getPayrollPrepCopy(locale);
  const [toast, setToast] = useState<Toast | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [undoPending, startUndo] = useTransition();
  const plainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (plainTimer.current) clearTimeout(plainTimer.current);
    },
    [],
  );

  const announce = useCallback((message: string, undo?: () => Promise<void>) => {
    if (!undo) {
      setToast(null);
      setPlain(message);
      if (plainTimer.current) clearTimeout(plainTimer.current);
      plainTimer.current = setTimeout(() => setPlain(null), 2600);
      return;
    }
    setPlain(null);
    setToast((prev) => ({ stamp: (prev?.stamp ?? 0) + 1, message, undo }));
  }, []);

  const notice = useCallback((message: string) => {
    setToast(null);
    setPlain(message);
    if (plainTimer.current) clearTimeout(plainTimer.current);
    plainTimer.current = setTimeout(() => setPlain(null), 2600);
  }, []);

  const t = useMemo<RoundToast>(() => ({ announce, notice }), [announce, notice]);

  return (
    <div className="ppr-toast-host">
      {stage === "approval" ? (
        <PayrollApprovalView data={data} locale={locale} localeTag={localeTag} toast={t} />
      ) : stage === "pay" ? (
        <PayrollPayView data={data} locale={locale} localeTag={localeTag} toast={t} canViewBank={canViewBank} />
      ) : (
        <PayrollPrepClient data={data} locale={locale} localeTag={localeTag} toast={t} canViewBank={canViewBank} />
      )}

      {toast?.undo ? (
        <AdminUndoToast
          stamp={toast.stamp}
          message={toast.message}
          undoLabel={copy.undo}
          pending={undoPending}
          onUndo={() => startUndo(async () => void (await toast.undo?.()))}
          onExpire={() => setToast(null)}
        />
      ) : plain ? (
        <div className="ppr-toast" role="status">
          {plain}
        </div>
      ) : null}
    </div>
  );
}
