"use client";

import { LiveWash } from "@/components/shared/live-wash";
import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  LogOut,
  Receipt,
  RotateCcw,
  Wallet,
  X,
} from "lucide-react";
import type { AdminTransportRow } from "@/lib/admin-attendance";
import type { TransportReportStatus } from "@/lib/transport-reimbursement";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import {
  exportMonthlyTransportReport,
  exportMonthlyTransportWorkbook,
  loadAdminTransportDetail,
  setTransportReportReview,
  type AdminTransportDetailResult,
  type AdminTransportItemView,
} from "@/app/admin/attendance/actions";
import { AdminExportButtons } from "../shared/admin-export-buttons";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { AdminUndoToast } from "../shared/admin-undo-toast";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";
import {
  adminTransportStatusPill,
  formatAdminYen,
} from "../shared/admin-format";

type Att = Dictionary["admin"]["attendanceConsole"];

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}
function initial(name: string): string {
  return name.trim().slice(0, 1) || "·";
}
/** 'YYYY-MM-DD' → 「9/11」(언어와 상관없이 짧게 — ko 의 「9. 11.」 대신). */
function shortMd(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
function fmtSubmitted(iso: string | null, localeTag: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

type TrTab = "pending" | "changes_requested" | "approved" | "rejected" | "before";
function trTabOf(status: TransportReportStatus | "none"): TrTab {
  if (status === "submitted" || status === "reviewing") return "pending";
  if (status === "changes_requested" || status === "approved" || status === "rejected") return status;
  return "before";
}
function fmtSubmittedDay(iso: string | null, localeTag: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(new Date(iso));
}

export function AttendanceTransportClient({
  ym,
  monthLabel,
  initialRows,
  initialUserId = null,
  locale,
  localeTag,
}: {
  ym: string;
  monthLabel: string;
  initialRows: AdminTransportRow[];
  initialUserId?: string | null;
  locale: Locale;
  localeTag: string;
}) {
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.attendanceConsole;
  const shared = dictionary.admin.shared;
  const [rows, setRows] = useState(initialRows);
  const [panelUserId, setPanelUserId] = useState<string | null>(
    initialUserId && initialRows.some((r) => r.userId === initialUserId) ? initialUserId : null,
  );
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const showToast = (msg: string) => setToast((prev) => ({ id: (prev?.id ?? 0) + 1, msg }));

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // 첫 탭은 검토 대기 — 비어 있으면 정산서가 있는 첫 탭(빈 화면부터 보이지 않게).
  const [tab, setTab] = useState<TrTab>(() => {
    const order: TrTab[] = ["pending", "changes_requested", "approved", "rejected", "before"];
    return order.find((k) => initialRows.some((r) => trTabOf(r.status) === k)) ?? "pending";
  });
  const panelRow = panelUserId ? rows.find((r) => r.userId === panelUserId) ?? null : null;
  const liveKpi = useMemo(
    () => ({
      pendingReview: rows.filter((r) => r.status === "submitted" || r.status === "reviewing").length,
      submittedTotal: rows
        .filter((r) => r.status === "submitted" || r.status === "reviewing" || r.status === "approved")
        .reduce((sum, r) => sum + r.totalAmount, 0),
      approvedTotal: rows.filter((r) => r.status === "approved").length,
    }),
    [rows],
  );

  function applyStatus(userId: string, status: TransportReportStatus) {
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, status } : r)));
  }

  // 한 번 클릭 승인(2026-10-15, 시안 Motion-C-Confirm-PC) — 월말에 여러 명을 연달아 누르는 버튼이라 확인 창 없이
  // 승인 → 다음 검토 대기 직원으로 → 실행 취소 토스트(되돌리면 다시 검토 대기).
  const [undo, setUndo] = useState<{ stamp: number; items: { userId: string; name: string; reportId: string }[] } | null>(null);
  const [undoPending, startUndo] = useTransition();
  const [advanced, setAdvanced] = useState(false);

  function openPanel(userId: string | null) {
    setAdvanced(false);
    setPanelUserId(userId);
  }

  function handleApproved(row: AdminTransportRow, reportId: string) {
    const list = rows.filter((r) => trTabOf(r.status) === tab);
    const idx = list.findIndex((r) => r.userId === row.userId);
    const order = [...list.slice(idx + 1), ...list.slice(0, Math.max(0, idx))];
    const next = order.find((r) => r.status === "submitted" || r.status === "reviewing");
    applyStatus(row.userId, "approved");
    setUndo((prev) => ({
      stamp: (prev?.stamp ?? 0) + 1,
      items: [...(prev?.items ?? []), { userId: row.userId, name: row.userName, reportId }],
    }));
    setAdvanced(Boolean(next));
    setPanelUserId(next ? next.userId : null);
  }

  function undoApprove() {
    const items = undo?.items ?? [];
    startUndo(async () => {
      let failed = false;
      for (const it of items) {
        const res = await setTransportReportReview({ reportId: it.reportId, action: "reopen", note: c.trUndoReason });
        if (res.ok) applyStatus(it.userId, "submitted");
        else failed = true;
      }
      setUndo(null);
      showToast(failed ? c.actionFailed : c.trActionDoneReopen);
    });
  }

  // 화이트 리디자인(2026-10-13, 시안 AttTransport-PC): 숫자 줄 대신 상태 탭(검토 대기 · 보완 요청 · 승인 · 반려 · 제출 전)
  // → 표(직원 · 건수 · 제출 금액 · 증빙 · 제출일). 비활성이던 상태 필터 칩은 탭이 대신한다.
  const TABS: { key: TrTab; label: string }[] = [
    { key: "pending", label: c.trTabPending },
    { key: "changes_requested", label: c.trStatusChangesRequested },
    { key: "approved", label: c.trStatusApproved },
    { key: "rejected", label: c.trStatusRejected },
    { key: "before", label: c.trTabBefore },
  ];
  const tabCount = (k: TrTab) => rows.filter((r) => trTabOf(r.status) === k).length;
  const visible = rows.filter((r) => trTabOf(r.status) === tab);
  void liveKpi;

  return (
    <div style={{ position: "relative" }}>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <div className="lviews" role="tablist" style={{ margin: 0 }}>
          {TABS.map((t) => {
            const n = tabCount(t.key);
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? "on" : ""}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {n > 0 && t.key !== "approved" && t.key !== "rejected" ? <span className="cnt">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <span className="toolbar__spacer" />
        <AdminExportButtons
          onExportXls={() => exportMonthlyTransportWorkbook(ym)}
          onExportPdf={() => exportMonthlyTransportReport(ym)}
          disabled={rows.length === 0}
          onToast={showToast}
          labels={shared}
        />
      </div>

      {rows.length === 0 || visible.length === 0 ? (
        <div className="state">
          <span className="state__ic empty">
            <Ic>
              <Wallet />
            </Ic>
          </span>
          <div className="state__t">{rows.length === 0 ? c.trEmptyTitle : c.trTabEmpty}</div>
          {rows.length === 0 ? <div className="state__s">{c.trEmptyBody}</div> : null}
        </div>
      ) : (
        <LiveWash move sig={visible.map((r) => r.userId).join(",")}>
        <table className="qtbl tr-tbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>{c.trColStaff}</th>
              <th className="r">{c.trColItems}</th>
              <th className="r">{c.trColTotal}</th>
              <th className="r">{c.trColEvidence}</th>
              <th className="r">{c.trColSubmittedOn}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const sel = panelUserId === r.userId;
              const noReport = r.status === "none";
              const submitted = fmtSubmittedDay(r.submittedAt, localeTag);
              return (
                <tr key={r.userId} data-live={r.userId} className={sel ? "sel" : ""} onClick={() => openPanel(r.userId)}>
                  <td style={{ paddingLeft: 16 }}>
                    <div className="who">
                      <span className="uhead__av" style={{ width: 32, height: 32 }}>
                        {initial(r.userName)}
                      </span>
                      <div>
                        <div className="who__nm">{r.userName}</div>
                        <div className="who__sub">{adminTransportStatusPill(r.status, c).label}</div>
                      </div>
                    </div>
                  </td>
                  <td className="r num">{noReport ? <span className="dim-cell">—</span> : `${r.itemCount}${c.unitCount}`}</td>
                  <td className="r num">
                    {noReport ? <span className="dim-cell">—</span> : <b>{`${c.yenSym}${formatAdminYen(r.totalAmount, localeTag)}`}</b>}
                  </td>
                  <td className="r">
                    {noReport || r.itemCount === 0 ? (
                      <span className="dim-cell">—</span>
                    ) : r.missingCount > 0 ? (
                      <span className="tr-miss">{c.trMissingN.replace("{n}", String(r.missingCount))}</span>
                    ) : (
                      c.trEvidenceN.replace("{n}", String(r.itemCount))
                    )}
                  </td>
                  <td className="r tr-date">{submitted ? c.trSubmittedOn.replace("{d}", submitted) : <span className="dim-cell">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </LiveWash>
      )}

      {panelRow ? (
        <TransportPanel
          ym={ym}
          monthLabel={monthLabel}
          row={panelRow}
          c={c}
          localeTag={localeTag}
          advanced={advanced}
          onClose={() => openPanel(null)}
          onApproved={handleApproved}
          onStatusChange={(userId, status, msg) => {
            applyStatus(userId, status);
            showToast(msg);
          }}
        />
      ) : null}

      {undo ? (
        <AdminUndoToast
          stamp={undo.stamp}
          message={
            undo.items.length === 1
              ? c.trUndoOne.replace("{name}", undo.items[0].name)
              : c.trUndoMany.replace("{n}", String(undo.items.length))
          }
          undoLabel={shared.undo}
          pending={undoPending}
          onUndo={undoApprove}
          onExpire={() => setUndo(null)}
        />
      ) : toast ? (
        <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

function TransportPanel({
  ym,
  monthLabel,
  row,
  c,
  localeTag,
  advanced,
  onClose,
  onApproved,
  onStatusChange,
}: {
  ym: string;
  monthLabel: string;
  row: AdminTransportRow;
  c: Att;
  localeTag: string;
  advanced: boolean;
  onClose: () => void;
  onApproved: (row: AdminTransportRow, reportId: string) => void;
  onStatusChange: (userId: string, status: TransportReportStatus, toast: string) => void;
}) {
  const [detail, setDetail] = useState<AdminTransportDetailResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<"reject" | "requestFix" | "reopen" | null>(null);
  // 승인 직후 0.65초 — 버튼이 초록 「승인됨」 + 체크를 보여 준 뒤 다음 직원으로.
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const done = doneFor === row.userId;
  const loading = detail === null && err === null;
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, {
    disabled: modal !== null || lightboxIndex !== null,
  });

  useEffect(() => {
    let cancelled = false;
    loadAdminTransportDetail(row.userId, ym)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        if (!res.ok && res.reason !== "not_found") {
          setErr(c.trActionLoadFailed);
        }
      })
      .catch(() => {
        if (!cancelled) setErr(c.trActionLoadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [row.userId, ym, c.trActionLoadFailed]);

  const pill = adminTransportStatusPill(row.status, c);
  const detailOk = detail && detail.ok ? detail : null;
  const report = detailOk?.report ?? null;
  const items = detailOk?.items ?? [];
  const missingCount = detailOk?.missingCount ?? 0;
  const resolved = row.status === "approved" || row.status === "rejected";
  const reviewable = row.status === "submitted" || row.status === "reviewing";

  // 항목 전체의 영수증 URL(평면) → 공용 ImageLightbox 캐러셀; URL 인덱스로 연다.
  const allReceiptUrls = items.flatMap((it) => it.imageUrls);
  const openImage = (url: string) => {
    const idx = allReceiptUrls.indexOf(url);
    if (idx >= 0) setLightboxIndex(idx);
  };

  const ITEMS_COLLAPSED = 6;
  const itemsCollapsible = items.length > ITEMS_COLLAPSED;
  const visibleItems =
    itemsExpanded || !itemsCollapsible ? items : items.slice(0, ITEMS_COLLAPSED);

  function submitApprove() {
    if (!report) return;
    setErr(null);
    const reportId = report.id;
    startTransition(async () => {
      const res = await setTransportReportReview({ reportId, action: "approved", note: null });
      if (res.ok) {
        setDoneFor(row.userId);
        setTimeout(() => onApproved(row, reportId), 650);
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else {
        setErr(res.reason === "finalized" ? c.trFinalizedLocked : c.actionFailed);
      }
    });
  }
  function submitReject(note: string) {
    if (!report) return;
    if (!note.trim()) {
      setErr(c.actionReasonRequired);
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await setTransportReportReview({
        reportId: report.id,
        action: "rejected",
        note: note.trim(),
      });
      if (res.ok) {
        setModal(null);
        onStatusChange(row.userId, "rejected", c.trActionDoneReject);
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "comment_required") {
        setErr(c.actionReasonRequired);
      } else {
        setErr(res.reason === "finalized" ? c.trFinalizedLocked : c.actionFailed);
      }
    });
  }
  function submitRequestFix(note: string) {
    if (!report) return;
    if (!note.trim()) {
      setErr(c.actionReasonRequired);
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await setTransportReportReview({
        reportId: report.id,
        action: "changes_requested",
        note: note.trim(),
      });
      if (res.ok) {
        setModal(null);
        onStatusChange(row.userId, "changes_requested", c.trActionDoneRequestFix);
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "comment_required") {
        setErr(c.actionReasonRequired);
      } else {
        setErr(res.reason === "finalized" ? c.trFinalizedLocked : c.actionFailed);
      }
    });
  }
  function submitReopen(reason: string) {
    if (!report) return;
    setErr(null);
    startTransition(async () => {
      const res = await setTransportReportReview({
        reportId: report.id,
        action: "reopen",
        note: reason.trim() ? reason.trim() : null,
      });
      if (res.ok) {
        setModal(null);
        // 재오픈은 보고서를 'submitted' 로 되돌린다(다시 검토 대기).
        onStatusChange(row.userId, "submitted", c.trActionDoneReopen);
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else {
        setErr(res.reason === "finalized" ? c.trFinalizedLocked : c.actionFailed);
      }
    });
  }

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside
        ref={panelRef}
        className={`panel on${advanced ? " cfm-next" : ""}`}
        role="dialog"
        aria-label={c.trPanelKicker(monthLabel)}
        tabIndex={-1}
      >
        <div className="panel__h" key={`h-${row.userId}`}>
          <div className="panel__top">
            <span className="panel__kicker">{c.trPanelKicker(monthLabel)}</span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={c.panelClose}>
              <Ic>
                <X />
              </Ic>
            </button>
          </div>
          <div className="panel__title trp-head">
            <span className="trp-kicker">
              {missingCount > 0 ? (
                <b>
                  {c.trEvidenceMissing} {missingCount}
                </b>
              ) : null}
              {pill.label}
            </span>
            <span className="trp-name">{row.userName}</span>
            <span className="panel__sub">
              {monthLabel} · {row.itemCount}
              {c.unitCount}
            </span>
          </div>
        </div>

        <div className="panel__body" key={`b-${row.userId}`}>
          {loading ? (
            <div className="pblock">
              <div className="state">
                <span className="state__ic empty">
                  <Ic>
                    <Wallet />
                  </Ic>
                </span>
                <div className="state__s">…</div>
              </div>
            </div>
          ) : !detailOk ? (
            <div className="pblock">
              <div className="errbar">
                <span className="errbar__ic">
                  <Ic>
                    <CircleAlert />
                  </Ic>
                </span>
                <div>
                  <div className="errbar__t">{c.trActionNoReport}</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 항목(인라인 영수증 썸네일, 접을 수 있음) */}
              <div className="pblock">
                <div className="pblock__t">{c.trPanelItemsTitle(items.length)}</div>
                {items.length === 0 ? (
                  <div className="locknote">{c.trItemNoEvidence}</div>
                ) : (
                  <>
                    <div
                      className="ledger"
                      style={{ position: "relative" }}
                    >
                      {visibleItems.map((it) => (
                        <TransportItemRow
                          key={it.id}
                          item={it}
                          c={c}
                          localeTag={localeTag}
                          onOpenImage={openImage}
                        />
                      ))}
                      {itemsCollapsible && !itemsExpanded ? (
                        <div className="ledger__fade" aria-hidden="true" />
                      ) : null}
                    </div>
                    {itemsCollapsible ? (
                      <button
                        type="button"
                        className="ledger__toggle"
                        onClick={() => setItemsExpanded((v) => !v)}
                        aria-expanded={itemsExpanded}
                      >
                        {itemsExpanded
                          ? c.staffLedgerCollapse
                          : c.staffLedgerExpand(items.length)}
                        <span className={`ledger__toggle-chev${itemsExpanded ? " on" : ""}`}>
                          <Ic>
                            <ChevronDown />
                          </Ic>
                        </span>
                      </button>
                    ) : null}
                  </>
                )}
                {items.length > 0 ? (
                  <div className="trp-total">
                    <span>{c.trColTotal}</span>
                    <b>
                      {c.yenSym}
                      {formatAdminYen(row.totalAmount, localeTag)}
                    </b>
                  </div>
                ) : null}
                {missingCount > 0 ? (
                  <div
                    className="locknote"
                    style={{
                      marginTop: 11,
                      color: "var(--warn)",
                      background: "var(--warn-bg)",
                    }}
                  >
                    <Ic>
                      <AlertTriangle />
                    </Ic>
                    {c.trPanelMissingNote(missingCount)}
                  </div>
                ) : null}
              </div>

              {/* 권한 영역 또는 처리 완료 메모 */}
              {resolved ? (
                <div className="pblock">
                  <div className="locknote">
                    <Ic>
                      {row.status === "approved" ? <Check /> : <Ban />}
                    </Ic>
                    {c.trPanelResolvedNote(
                      pill.label,
                      report ? c.panelPermRole : c.panelPermRole,
                      fmtSubmitted(report?.reviewedAt ?? null, localeTag) ?? "—",
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {err ? (
            <div className="pblock">
              <div className="errbar">
                <span className="errbar__ic">
                  <Ic>
                    <LogOut />
                  </Ic>
                </span>
                <div>
                  <div className="errbar__t">{err}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel__foot">
          {items.length > 0 ? (
            <a
              className="btn btn--subtle btn--sm"
              href={`/admin/attendance/transport/receipt?ym=${ym}&user=${row.userId}`}
              target="stayops_receipt"
              rel="noopener"
              style={{ flex: 1 }}
            >
              <Ic>
                <Receipt />
              </Ic>
              {c.trReceiptEntry}
            </a>
          ) : (
            <span style={{ flex: 1 }} />
          )}
          {resolved ? (
            <button
              type="button"
              className="btn btn--subtle"
              style={{ flex: 1 }}
              onClick={() => setModal("reopen")}
              disabled={pending || !report}
            >
              <Ic>
                <RotateCcw />
              </Ic>
              {pending ? c.trActionReopening : c.trPanelBtnReopen}
            </button>
          ) : reviewable ? (
            <>
              <button
                type="button"
                className="btn trp-reject"
                onClick={() => setModal("reject")}
                disabled={pending || !report}
              >
                {pending ? c.trActionRejecting : c.trPanelBtnReject}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ flex: 1 }}
                onClick={() => setModal("requestFix")}
                disabled={pending || !report}
              >
                {pending ? c.trActionRequestingFix : c.trPanelBtnRequestFix}
              </button>
              {done ? (
                <button type="button" className="btn btn--ok cfm-done" style={{ flex: 1.2 }} disabled aria-live="polite">
                  <Ic>
                    <Check />
                  </Ic>
                  <span className="cfm-lab">{c.trPanelBtnApprovedShort}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--ok"
                  style={{ flex: 1.2 }}
                  onClick={submitApprove}
                  disabled={pending || !report}
                >
                  {pending ? c.trActionApproving : c.trPanelBtnApprove}
                </button>
              )}
            </>
          ) : (
            <span style={{ flex: 2.3 }} />
          )}
        </div>
      </aside>

      {modal === "reject" ? (
        <AdminReasonModal
          title={c.trPanelBtnReject}
          description={c.trPromptReject}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={pending ? c.trActionRejecting : c.trPanelBtnReject}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          danger
          onConfirm={submitReject}
          onCancel={() => setModal(null)}
        />
      ) : null}
      {modal === "requestFix" ? (
        <AdminReasonModal
          title={c.trPanelBtnRequestFix}
          description={c.trPromptRequestFixComment}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={pending ? c.trActionRequestingFix : c.trPanelBtnRequestFix}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          onConfirm={submitRequestFix}
          onCancel={() => setModal(null)}
        />
      ) : null}
      {modal === "reopen" ? (
        <AdminReasonModal
          title={c.trPanelBtnReopen}
          description={c.trPromptReopen}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={pending ? c.trActionReopening : c.trPanelBtnReopen}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          onConfirm={submitReopen}
          onCancel={() => setModal(null)}
        />
      ) : null}

      <ImageLightbox
        closeLabel={c.panelClose}
        urls={allReceiptUrls}
        openIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </>
  );
}

function TransportItemRow({
  item,
  c,
  localeTag,
  onOpenImage,
}: {
  item: AdminTransportItemView;
  c: Att;
  localeTag: string;
  onOpenImage: (url: string) => void;
}) {
  const missing = item.imageCount === 0;
  const thumbs = item.imageUrls.slice(0, 2);
  const extra = item.imageUrls.length - thumbs.length;
  return (
    <div className="trp-row">
      <span className="trp-row__d">{shortMd(item.usageDate)}</span>
      <span className="trp-row__b">
        <span className="trp-row__t">{item.buildingLabel || item.contextSummary || "—"}</span>
        {item.buildingLabel && item.contextSummary && item.contextSummary !== "—" ? <span className="trp-row__s">{item.contextSummary}</span> : null}
      </span>
      {missing ? (
        <span className="trp-row__miss">{c.trPanelMissingTag}</span>
      ) : (
        <span className="trthumbs">
          {thumbs.map((u, i) => (
            <button
              key={i}
              type="button"
              className="trthumb"
              onClick={() => onOpenImage(u)}
              aria-label={c.trPanelEvidenceCount(item.imageCount)}
            >
              <Image src={u} alt="" width={28} height={28} />
            </button>
          ))}
          {extra > 0 ? (
            <button type="button" className="trthumb trthumb--more" onClick={() => onOpenImage(item.imageUrls[thumbs.length])}>
              +{extra}
            </button>
          ) : null}
        </span>
      )}
      <b className="trp-row__v">
        {c.yenSym}
        {formatAdminYen(item.amountYen, localeTag)}
      </b>
    </div>
  );
}
