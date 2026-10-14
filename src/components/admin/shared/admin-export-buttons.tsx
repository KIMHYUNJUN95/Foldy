"use client";

// CANONICAL admin-console export control: the Excel + PDF `chipbtn` pair. Every "내보내기" in
// /admin/* renders through this component — do not hand-roll export buttons or reintroduce CSV.
// Pair it with buildAdminTableWorkbookBase64 / buildAdminTableReportHtml on the server side.
// See CLAUDE.md → "Admin dashboard shared design contract".
import { useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { downloadAdminWorkbook } from "@/components/admin/shared/admin-format";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import type { Dictionary } from "@/lib/i18n";
import "./admin-export-buttons.css";

export type AdminExportLabels = Dictionary["admin"]["shared"];

type AdminExportButtonsProps = {
  /** Server action returning the .xlsx as base64. */
  onExportXls: () => Promise<AdminWorkbookExportResult>;
  /** Server action returning the print-ready HTML document. */
  onExportPdf: () => Promise<AdminReportExportResult>;
  /** Pass `true` when there are no rows to export. */
  disabled?: boolean;
  onToast: (message: string) => void;
  labels: AdminExportLabels;
};

export function AdminExportButtons({
  onExportXls,
  onExportPdf,
  disabled = false,
  onToast,
  labels,
}: AdminExportButtonsProps) {
  const [xlsPending, startXlsExport] = useTransition();
  const [pdfPending, startPdfExport] = useTransition();
  // 누른 뒤 → 도는 고리 → 「다운로드됨 / 새 창에 열림」 체크 → 2초 뒤 원래대로(2026-10-14 모션, 시안 Motion-PC-Export-PC).
  const [done, setDone] = useState<{ xls: boolean; pdf: boolean }>({ xls: false, pdf: false });
  const timers = useRef<{ xls?: number; pdf?: number }>({});
  function flashDone(kind: "xls" | "pdf") {
    window.clearTimeout(timers.current[kind]);
    setDone((d) => ({ ...d, [kind]: true }));
    timers.current[kind] = window.setTimeout(() => setDone((d) => ({ ...d, [kind]: false })), 2000);
  }

  function handleExportXls() {
    if (xlsPending) return;
    startXlsExport(async () => {
      const res = await onExportXls();
      if (res.ok) {
        downloadAdminWorkbook(res.base64, res.filename);
        flashDone("xls");
        onToast(labels.exportDone);
        return;
      }
      onToast(res.reason === "empty" ? labels.exportEmpty : labels.exportFailed);
    });
  }

  function handleExportPdf() {
    if (pdfPending) return;
    // Open the tab synchronously (still inside the click handler) so pop-up blockers don't kill it
    // once the server action's await resolves.
    const win = window.open("", "_blank");
    startPdfExport(async () => {
      const res = await onExportPdf();
      if (!res.ok) {
        win?.close();
        onToast(res.reason === "empty" ? labels.exportEmpty : labels.exportFailed);
        return;
      }
      if (!win) {
        onToast(labels.exportBlocked);
        return;
      }
      win.document.open();
      win.document.write(res.html);
      win.document.close();
      flashDone("pdf");
    });
  }

  return (
    <>
      <ExportButton busy={xlsPending} disabled={disabled} done={done.xls} doneLabel={labels.exportSaved} label={labels.exportXls} onClick={handleExportXls} />
      <ExportButton busy={pdfPending} disabled={disabled} done={done.pdf} doneLabel={labels.exportOpened} label={labels.exportPdf} onClick={handleExportPdf} />
    </>
  );
}

function ExportButton({
  label,
  doneLabel,
  busy,
  done,
  disabled,
  onClick,
}: {
  label: string;
  doneLabel: string;
  busy: boolean;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const phase = busy ? "busy" : done ? "done" : "idle";
  return (
    <button
      aria-busy={busy || undefined}
      className={`chipbtn axb is-${phase}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="axb__ic" key={`i-${phase}`}>
        {phase === "busy" ? (
          <svg className="axb__ring" viewBox="0 0 16 16">
            <circle cx="8" cy="8" fill="none" r="6" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" />
            <circle cx="8" cy="8" fill="none" pathLength="100" r="6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        ) : phase === "done" ? (
          <svg className="axb__check" fill="none" viewBox="0 0 16 16">
            <path d="M3.5 8.4l3 3 6-6.6" pathLength="1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        ) : (
          <Download className="ic" />
        )}
      </span>
      <span className="axb__t" key={`t-${phase === "done" ? "done" : "label"}`}>
        {phase === "done" ? doneLabel : label}
      </span>
      <span aria-live="polite" className="sr-only">
        {phase === "done" ? doneLabel : ""}
      </span>
    </button>
  );
}
