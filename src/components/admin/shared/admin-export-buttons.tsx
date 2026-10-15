"use client";

// CANONICAL admin-console export control: the Excel + PDF `chipbtn` pair. Every "내보내기" in
// /admin/* renders through this component — do not hand-roll export buttons or reintroduce CSV.
// Pair it with buildAdminTableWorkbookBase64 / buildAdminTableReportHtml on the server side.
// See CLAUDE.md → "Admin dashboard shared design contract".
//
// 모션(2026-10-15, 시안 Motion-PC-Export-PC) — 누름 → 도는 고리 → 결과가 같은 버튼 자리에서:
// - Excel: 초록 체크 「다운로드됨」 + 버튼 아래 파일 카드(XLS · 파일 이름 · 크기)
// - PDF: 초록 체크 「새 탭에 열림」 + 카드(문서 제목 · 「새 탭에서 인쇄 → PDF로 저장」)
// - 실패: 빨간 「다시 시도」(살짝 흔들림) + 카드 · 팝업이 막히면 「팝업 차단됨」 + 허용 안내
// 카드는 4초 뒤 사라지고(마우스를 올리면 멈춤) 버튼도 원래대로. 다시 누르면 처음부터. 결과는 카드가 알리므로 토스트는
// 「내보낼 항목 없음」에만 쓴다.
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
  /** `"panel"` = 오른쪽 상세 패널 아래쪽의 넓은 버튼 모양(`btn btn--ghost`, 칸을 나눠 가짐). 기본은 툴바의 `chipbtn`. */
  variant?: "chip" | "panel";
  /** 막혀 있을 때 마우스를 올리면 보이는 이유(예: 「확정한 뒤 내보낼 수 있어요」). */
  disabledTitle?: string;
};

type Kind = "xls" | "pdf";
type Result = "done" | "error" | "blocked";
type Card = { kind: Kind; result: Result; title: string; sub: string; top?: number; bottom?: number; right: number };

const CARD_MS = 4000;

/** base64 → 실제 바이트 수 → 「48KB」 / 「1.2MB」. */
function fileSize(base64: string) {
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - pad;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 인쇄 화면 HTML 의 <title> — 카드에 문서 이름으로 쓴다. */
function docTitle(html: string) {
  const m = /<title>([^<]*)<\/title>/i.exec(html);
  if (!m) return "";
  return new DOMParser().parseFromString(`<title>${m[1]}</title>`, "text/html").title;
}

export function AdminExportButtons({
  onExportXls,
  onExportPdf,
  disabled = false,
  onToast,
  labels,
  variant = "chip",
  disabledTitle,
}: AdminExportButtonsProps) {
  const [xlsPending, startXlsExport] = useTransition();
  const [pdfPending, startPdfExport] = useTransition();
  const [card, setCard] = useState<Card | null>(null);
  const btns = useRef<{ xls: HTMLButtonElement | null; pdf: HTMLButtonElement | null }>({ xls: null, pdf: null });
  const timer = useRef<number | undefined>(undefined);
  const left = useRef(CARD_MS);
  const startedAt = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function arm(ms: number) {
    window.clearTimeout(timer.current);
    left.current = ms;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => setCard(null), ms);
  }

  function show(kind: Kind, result: Result, title: string, sub: string) {
    const r = btns.current[kind]?.getBoundingClientRect();
    const right = r ? window.innerWidth - r.right : 24;
    // 화면 아래쪽 버튼(패널 아래 줄 등)이면 카드를 버튼 위로 띄운다.
    const up = !!r && r.bottom + 96 > window.innerHeight;
    setCard({ kind, result, title, sub, right, ...(up && r ? { bottom: window.innerHeight - r.top + 8 } : { top: r ? r.bottom + 8 : 72 }) });
    arm(CARD_MS);
  }

  function fail(kind: Kind, reason: "forbidden" | "empty" | "error") {
    if (reason === "empty") {
      setCard(null);
      onToast(labels.exportEmpty);
      return;
    }
    show(kind, "error", labels.exportFailedTitle, labels.exportFailedHint);
  }

  function handleExportXls() {
    if (xlsPending) return;
    setCard(null);
    startXlsExport(async () => {
      try {
        const res = await onExportXls();
        if (!res.ok) return fail("xls", res.reason);
        downloadAdminWorkbook(res.base64, res.filename);
        show("xls", "done", res.filename, fileSize(res.base64));
      } catch {
        fail("xls", "error");
      }
    });
  }

  function handleExportPdf() {
    if (pdfPending) return;
    setCard(null);
    // Open the tab synchronously (still inside the click handler) so pop-up blockers don't kill it
    // once the server action's await resolves.
    const win = window.open("", "_blank");
    startPdfExport(async () => {
      try {
        const res = await onExportPdf();
        if (!res.ok) {
          win?.close();
          return fail("pdf", res.reason);
        }
        if (!win) {
          show("pdf", "blocked", labels.exportBlockedShort, labels.exportBlockedHint);
          return;
        }
        win.document.open();
        win.document.write(res.html);
        win.document.close();
        show("pdf", "done", docTitle(res.html) || labels.exportPdf, labels.exportPdfHint);
      } catch {
        win?.close();
        fail("pdf", "error");
      }
    });
  }

  const phase = (kind: Kind, busy: boolean) => (busy ? "busy" : card?.kind === kind ? card.result : "idle");
  const doneLabel = { xls: labels.exportSaved, pdf: labels.exportOpened };

  return (
    <>
      <ExportButton
        btnRef={(el) => { btns.current.xls = el; }}
        disabled={disabled}
        disabledTitle={disabledTitle}
        variant={variant}
        label={labels.exportXls}
        labels={labels}
        onClick={handleExportXls}
        phase={phase("xls", xlsPending)}
        doneLabel={doneLabel.xls}
      />
      <ExportButton
        btnRef={(el) => { btns.current.pdf = el; }}
        disabled={disabled}
        disabledTitle={disabledTitle}
        variant={variant}
        label={labels.exportPdf}
        labels={labels}
        onClick={handleExportPdf}
        phase={phase("pdf", pdfPending)}
        doneLabel={doneLabel.pdf}
      />
      {card
        ? createPortal(
            <div
              className={`axcard is-${card.result}`}
              key={`${card.kind}-${card.result}-${card.title}`}
              onMouseEnter={() => {
                window.clearTimeout(timer.current);
                left.current = Math.max(800, left.current - (Date.now() - startedAt.current));
              }}
              onMouseLeave={() => arm(left.current)}
              role="status"
              style={{ top: card.top, bottom: card.bottom, right: card.right, transformOrigin: card.bottom !== undefined ? "100% 100%" : undefined }}
            >
              <span aria-hidden="true" className={`axcard__fi axcard__fi--${card.result === "done" ? card.kind : "err"}`}>
                {card.result === "done" ? (card.kind === "xls" ? "XLS" : "PDF") : "!"}
              </span>
              {card.kind === "xls" && card.result === "done" ? (
                <span className="axcard__b">
                  <b>{card.title}</b>
                  <em> · {card.sub}</em>
                </span>
              ) : (
                <span className="axcard__b">
                  <b>{card.title}</b>
                  <span className="axcard__sub">{card.sub}</span>
                </span>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ExportButton({
  label,
  doneLabel,
  labels,
  phase,
  disabled,
  onClick,
  btnRef,
  variant,
  disabledTitle,
}: {
  label: string;
  doneLabel: string;
  labels: AdminExportLabels;
  phase: "idle" | "busy" | Result;
  disabled: boolean;
  onClick: () => void;
  btnRef: (el: HTMLButtonElement | null) => void;
  variant: "chip" | "panel";
  disabledTitle?: string;
}) {
  const busy = phase === "busy";
  // 패널 버튼은 좁아서 글자는 그대로(「Excel / PDF」) — 상태는 아이콘(고리 · 체크 · 다시) + 색으로, 자세한 결과는 카드가 알린다.
  const text =
    variant === "panel" ? label : busy ? labels.exportBusy : phase === "done" ? doneLabel : phase === "error" ? labels.exportRetry : phase === "blocked" ? labels.exportBlockedShort : label;
  return (
    <button
      aria-busy={busy || undefined}
      className={`${variant === "panel" ? "btn btn--ghost axb axb--panel" : "chipbtn axb"} is-${phase}`}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      onClick={onClick}
      ref={btnRef}
      type="button"
    >
      <span aria-hidden="true" className="axb__ic" key={`i-${phase}`}>
        {busy ? (
          <svg className="axb__ring" viewBox="0 0 16 16">
            <circle cx="8" cy="8" fill="none" r="6" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" />
            <circle cx="8" cy="8" fill="none" pathLength="100" r="6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        ) : phase === "done" ? (
          <svg className="axb__check" fill="none" viewBox="0 0 16 16">
            <path d="M3.5 8.4l3 3 6-6.6" pathLength="1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        ) : phase === "error" || phase === "blocked" ? (
          <svg fill="none" viewBox="0 0 16 16">
            <path d="M2.7 8a5.3 5.3 0 1 0 1.6-3.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            <path d="M2.7 2.7v3h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          </svg>
        ) : (
          <Download className="ic" />
        )}
      </span>
      {/* 버튼 폭은 그대로 — 나올 수 있는 글자를 모두 겹쳐 두고 가장 긴 폭을 잡는다(패널 버튼은 칸을 나눠 가져 폭이 이미 고정 · 넘치면 말줄임). */}
      <span className="axb__tw">
        {(variant === "panel" ? [] : [label, labels.exportBusy, doneLabel, labels.exportRetry, labels.exportBlockedShort]).map((t) => (
          <span aria-hidden="true" className="axb__sz" key={t}>
            {t}
          </span>
        ))}
        <span className="axb__t" key={`t-${phase}`}>
          {text}
        </span>
      </span>
    </button>
  );
}
