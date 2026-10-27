"use client";

import { useState, useTransition } from "react";
import { ChevronRight, FileSpreadsheet, FileText, Search } from "lucide-react";
import {
  exportPayrollBookReport,
  exportPayrollBookWorkbook,
  exportPayslipsReport,
  exportPayslipsWorkbook,
  exportTaxAccountantReport,
  exportTaxAccountantWorkbook,
} from "@/actions/payroll-exports";
import { downloadAdminWorkbook } from "@/components/admin/shared/admin-format";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import type { PrepRow } from "@/lib/payroll-prep";
import type { PayrollPrepCopy } from "@/lib/payroll-prep-i18n";
import { fillCopy } from "@/lib/payroll-settings-i18n";
import type { PayrollToastState } from "./payroll-toast";

/**
 * 모바일 급여 준비 — 출력 파일(P4). 급여 파일 · 세무사용, 각각 Excel + PDF(PC 와 같은 서버 액션). docs/product/39 §6.
 * Excel 은 바로 내려받고, PDF 는 새 탭에 인쇄 화면을 연다(팝업 차단을 피하려고 누른 순간 탭부터 연다).
 * 「명세서만 뽑기」 — 사람을 골라 그 사람들 명세서만(§6-3). 폰은 아래 시트, 태블릿은 가운데 카드(BottomSheet 기본).
 */
type Toast = (next: Omit<PayrollToastState, "id">) => void;

export function PayrollFiles({
  ym,
  copy,
  showToast,
  rows,
  monthLabel,
  localeTag,
}: {
  ym: string;
  copy: PayrollPrepCopy;
  showToast: Toast;
  rows: readonly PrepRow[];
  monthLabel: string;
  localeTag: string;
}) {
  const [picking, setPicking] = useState(false);
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
        {rows.length > 0 ? (
          <li className="mpp-file">
            <button type="button" className="mpp-file__go" onClick={() => setPicking(true)}>
              <span className="mpp-file__b">
                <b>{copy.slipOnly}</b>
                <small>{copy.slipOnlyHint}</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </li>
        ) : null}
      </ul>
      {picking ? (
        <SlipPicker
          ym={ym}
          rows={rows}
          copy={copy}
          monthLabel={monthLabel}
          localeTag={localeTag}
          showToast={showToast}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </section>
  );
}

type Method = "all" | "transfer" | "cash";

/** 검색 — NFKC · 공백 무시 · 히라가나도 가타카나로 맞춰 본다. */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .toLowerCase();
}

function SlipPicker({
  ym,
  rows,
  copy,
  monthLabel,
  localeTag,
  showToast,
  onClose,
}: {
  ym: string;
  rows: readonly PrepRow[];
  copy: PayrollPrepCopy;
  monthLabel: string;
  localeTag: string;
  showToast: Toast;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<Method>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const money = new Intl.NumberFormat(localeTag);
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const q = fold(query);
  const shown = sorted.filter(
    (r) =>
      (method === "all" || (method === "cash" ? r.paymentMethod === "cash" : r.paymentMethod !== "cash")) &&
      (q === "" || fold(r.name).includes(q) || fold(r.nameKatakana ?? "").includes(q)),
  );
  const shownPicked = shown.filter((r) => picked.has(r.userId)).length;
  const allShown = shown.length > 0 && shownPicked === shown.length;
  const ids = sorted.filter((r) => picked.has(r.userId)).map((r) => r.userId);
  const count = (m: Method) =>
    m === "all" ? rows.length : rows.filter((r) => (m === "cash" ? r.paymentMethod === "cash" : r.paymentMethod !== "cash")).length;
  const methodName = (r: PrepRow) => (r.paymentMethod === "cash" ? copy.cash : copy.transfer);

  const toggle = (id: string) => {
    haptic("light");
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleShown = () => {
    haptic("light");
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShown) next.delete(r.userId);
        else next.add(r.userId);
      }
      return next;
    });
  };

  return (
    <BottomSheet ariaLabelledBy="mpp-slip-title" onClose={onClose} className="flex max-h-[88dvh] flex-col">
      <div className="mpp-ps">
        <div className="mpp-ps__head">
          <h2 id="mpp-slip-title">{copy.slipSheetTitle}</h2>
          <p>{fillCopy(copy.slipSheetSub, { month: monthLabel })}</p>
          <div className="mpp-ps__seg" role="radiogroup" aria-label={copy.filterLabel}>
            {(["all", "transfer", "cash"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => {
                  if (method !== m) haptic("light");
                  setMethod(m);
                }}
              >
                {m === "all" ? copy.all : m === "cash" ? copy.cash : copy.transfer} <i>{count(m)}</i>
              </button>
            ))}
          </div>
          <label className="mpp-ps__search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={copy.slipSearch}
              aria-label={copy.slipSearchLabel}
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="mpp-ps__list">
          {shown.length === 0 ? (
            <p className="mpp-ps__none">{copy.slipNoMatch}</p>
          ) : (
            <>
              <button type="button" className="mpp-ps__all" aria-pressed={allShown} onClick={toggleShown}>
                <span>{copy.slipPickAll}</span>
                <span className="num">
                  {shownPicked} / {shown.length}
                </span>
              </button>
              <ul>
                {shown.map((r) => {
                  const on = picked.has(r.userId);
                  return (
                    <li key={r.userId}>
                      <button type="button" role="checkbox" aria-checked={on} className="mpp-ps__row" onClick={() => toggle(r.userId)}>
                        <span className="mpp-ps__ck" aria-hidden="true">
                          <svg viewBox="0 0 12 10" fill="none">
                            <path d="M1 5l3.5 3.5L11 1.5" pathLength="1" />
                          </svg>
                        </span>
                        <span className="mpp-ps__b">
                          <b>{r.name}</b>
                          <small>
                            {r.nameKatakana ? <span lang="ja">{r.nameKatakana}</span> : null}
                            {r.nameKatakana ? " · " : null}
                            {methodName(r)}
                          </small>
                        </span>
                        <span className="mpp-ps__n num">{r.net == null ? "—" : money.format(r.net)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="mpp-ps__foot">
          <span className="num" aria-live="polite">
            {fillCopy(copy.slipPicked, { n: ids.length })}
          </span>
          <XlsButton
            label={copy.fileXls}
            run={() => exportPayslipsWorkbook(ym, ids)}
            copy={copy}
            showToast={showToast}
            disabled={ids.length === 0}
            className="mpp-file__btn mpp-file__btn--soft"
          />
          <PdfButton
            label={copy.filePdf}
            run={() => exportPayslipsReport(ym, ids)}
            copy={copy}
            showToast={showToast}
            disabled={ids.length === 0}
            className="mpp-file__btn mpp-file__btn--pri"
          />
        </div>
      </div>
    </BottomSheet>
  );
}

export function XlsButton({
  label,
  run,
  copy,
  showToast,
  disabled = false,
  className = "mpp-file__btn",
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  run: () => Promise<AdminWorkbookExportResult>;
  copy: PayrollPrepCopy;
  showToast: Toast;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending || disabled}
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
          haptic("light");
          showToast({ kind: "done", text: fillCopy(copy.fileSaved, { name: res.filename }) });
        })
      }
    >
      <FileSpreadsheet aria-hidden="true" />
      {label}
    </button>
  );
}

export function PdfButton({
  label,
  run,
  copy,
  showToast,
  disabled = false,
  className = "mpp-file__btn",
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  run: () => Promise<AdminReportExportResult>;
  copy: PayrollPrepCopy;
  showToast: Toast;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending || disabled}
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
          haptic("light");
          showToast({ kind: "done", text: copy.fileOpened });
        });
      }}
    >
      <FileText aria-hidden="true" />
      {label}
    </button>
  );
}
