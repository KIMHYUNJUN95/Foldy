"use client";

import { useTransition } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import {
  exportPayrollBookReport,
  exportPayrollBookWorkbook,
  exportTaxAccountantReport,
  exportTaxAccountantWorkbook,
} from "@/actions/payroll-exports";
import { downloadAdminWorkbook } from "@/components/admin/shared/admin-format";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { haptic } from "@/lib/haptics";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import type { PayrollToastState } from "./payroll-toast";

/**
 * 모바일 급여 준비 — 출력 파일(P4). 급여 파일 · 세무사용, 각각 Excel + PDF(PC 와 같은 서버 액션). docs/product/39 §6.
 * Excel 은 바로 내려받고, PDF 는 새 탭에 인쇄 화면을 연다(팝업 차단을 피하려고 누른 순간 탭부터 연다).
 */
type Toast = (next: Omit<PayrollToastState, "id">) => void;

export function PayrollFiles({ ym, copy, showToast }: { ym: string; copy: PayrollPrepCopy; showToast: Toast }) {
  const files = [
    { key: "book", title: copy.fileBook, hint: copy.fileBookHint, xls: exportPayrollBookWorkbook, pdf: exportPayrollBookReport },
    { key: "tax", title: copy.fileTax, hint: copy.fileTaxHint, xls: exportTaxAccountantWorkbook, pdf: exportTaxAccountantReport },
  ];
  return (
    <section className="mpp-files" aria-label={copy.filesTitle}>
      <h2 className="mpp-files__h">{copy.filesTitle}</h2>
      <ul>
        {files.map((f) => (
          <li key={f.key} className="mpp-file">
            <span className="mpp-file__b">
              <b>{f.title}</b>
              <small>{f.hint}</small>
            </span>
            <XlsButton label={copy.fileXls} run={() => f.xls(ym)} copy={copy} showToast={showToast} />
            <PdfButton label={copy.filePdf} run={() => f.pdf(ym)} copy={copy} showToast={showToast} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function XlsButton({ label, run, copy, showToast }: {
  label: string;
  run: () => Promise<AdminWorkbookExportResult>;
  copy: PayrollPrepCopy;
  showToast: Toast;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="mpp-file__btn"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const res = await run().catch(() => ({ ok: false as const, reason: "error" as const }));
          if (!res.ok) {
            haptic("error");
            showToast({ kind: "bad", text: res.reason === "forbidden" ? copy.errorForbidden : copy.fileFailed });
            return;
          }
          downloadAdminWorkbook(res.base64, res.filename);
          haptic("success");
          showToast({ kind: "done", text: fillCopy(copy.fileSaved, { name: res.filename }) });
        })
      }
    >
      <FileSpreadsheet aria-hidden="true" />
      {label}
    </button>
  );
}

function PdfButton({ label, run, copy, showToast }: {
  label: string;
  run: () => Promise<AdminReportExportResult>;
  copy: PayrollPrepCopy;
  showToast: Toast;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="mpp-file__btn"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        const win = window.open("", "_blank");
        start(async () => {
          const res = await run().catch(() => ({ ok: false as const, reason: "error" as const }));
          if (!res.ok) {
            win?.close();
            haptic("error");
            showToast({ kind: "bad", text: res.reason === "forbidden" ? copy.errorForbidden : copy.fileFailed });
            return;
          }
          if (!win) {
            haptic("error");
            showToast({ kind: "bad", text: copy.fileBlocked });
            return;
          }
          win.document.open();
          win.document.write(res.html);
          win.document.close();
          haptic("success");
          showToast({ kind: "done", text: copy.fileOpened });
        });
      }}
    >
      <FileText aria-hidden="true" />
      {label}
    </button>
  );
}
