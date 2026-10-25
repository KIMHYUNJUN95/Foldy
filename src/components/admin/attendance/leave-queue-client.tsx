"use client";

import { LiveWash } from "@/components/shared/live-wash";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Ban,
  Calendar,
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  FileText,
  ScrollText,
  Info,
  LogOut,
  Search,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import type {
  LeaveApprovalDetail,
  LeaveDurationUnit,
  LeaveOverlap,
  LeaveQueueItem,
  LeaveQueueSummary,
  LeaveStatus,
  LeaveStatusGroup,
  LeaveType,
} from "@/lib/annual-leave-approvals-server";
import type {
  AdminLeaveBalanceRow,
  LeaveApplicantOption,
  LeaveDocument,
  LeaveLedgerEntry,
} from "@/lib/annual-leave-admin-server";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import {
  approveLeaveRequestAction,
  cancelApprovedLeaveAction,
  rejectLeaveRequestAction,
} from "@/app/admin/attendance/leave/actions";
import { loadLeaveApprovalDetail } from "@/app/admin/attendance/leave/detail-actions";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { AdminHoldButton } from "../shared/admin-hold-button";
import { AdmDropdown } from "../shared/adm-dropdown";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";
import { LeaveRequestModal } from "./leave-request-modal";
import { LeaveTeamCalendar } from "./leave-team-calendar";
import { LeaveBalanceView } from "./leave-balance-view";
import { LeaveDocumentsView } from "./leave-documents-view";
import { LeaveLedgerView } from "./leave-ledger-view";
import { tokyoToday } from "@/lib/tokyo-date";

type Lc = Dictionary["admin"]["leaveConsole"];

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function initial(name: string): string {
  return Array.from(name.trim())[0] ?? "·";
}

function localeTagOf(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

/** "2026-07-14" → "07/14" */
function fmtMd(dateStr: string): string {
  return dateStr.length >= 10 ? dateStr.slice(5).replace("-", "/") : dateStr;
}

/** "2026-07-14" → "2026/07/14" */
function fmtYmd(dateStr: string): string {
  return dateStr.replace(/-/g, "/");
}

/** ISO timestamp → Tokyo "MM/DD HH:mm"; null → "—". */
function fmtSubmitted(iso: string | null, localeTag: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function roleLabel(role: string | null, dictionary: Dictionary): string {
  if (!role) return "—";
  const map = dictionary.roles as Record<string, string>;
  return map[role] ?? role;
}

function typeBadgeClass(type: LeaveType): string {
  switch (type) {
    case "paid":
      return "typebadge--paid";
    case "annual":
      return "typebadge--annual";
    case "special":
      return "typebadge--special";
    default:
      return "typebadge--other";
  }
}

function typeLabel(type: LeaveType, lc: Lc): string {
  switch (type) {
    case "paid":
      return lc.typePaid;
    case "annual":
      return lc.typeAnnual;
    case "special":
      return lc.typeSpecial;
    default:
      return lc.typeOther;
  }
}

function durationLabel(unit: LeaveDurationUnit, lc: Lc): string {
  if (unit === "am") return lc.durationAm;
  if (unit === "pm") return lc.durationPm;
  return lc.durationFull;
}

/** `value / total` as a CSS width, clamped to 0–100%. Guards the over-balance case where the
 *  post-approval balance is negative and a raw percentage would be an invalid width. */
function barPct(value: number, total: number): string {
  if (!total || total <= 0) return "0%";
  return `${Math.min(100, Math.max(0, (value / total) * 100))}%`;
}

/** Tokyo "today" as YYYY-MM-DD — matches the server's operational-date convention. */
/** Pending requests starting within 5 days get a left-edge urgency indicator (row.urgent CSS). */
function isUrgent(item: LeaveQueueItem, today: string): boolean {
  if (item.status !== "requested") return false;
  const start = new Date(`${item.startDate}T00:00:00+09:00`).getTime();
  const now = new Date(`${today}T00:00:00+09:00`).getTime();
  const diffDays = Math.round((start - now) / 86_400_000);
  return diffDays >= 0 && diffDays <= 5;
}

function groupOf(status: LeaveStatus): LeaveStatusGroup {
  if (status === "requested") return "pending";
  if (status === "approved") return "approved";
  return "rejectedCancelled";
}

function statusPill(status: LeaveStatus, lc: Lc): { label: string; cls: string } {
  switch (status) {
    case "requested":
      return { label: lc.statusRequested, cls: "pill--warn" };
    case "approved":
      return { label: lc.statusApproved, cls: "pill--done" };
    case "rejected":
      return { label: lc.statusRejected, cls: "pill--danger" };
    case "cancelled":
      return { label: lc.statusCancelled, cls: "pill--muted" };
  }
}

function errLabel(reason: string | undefined, lc: Lc): string {
  switch (reason) {
    case "forbidden":
      return lc.errForbidden;
    case "not_found":
      return lc.errNotFound;
    case "not_requested":
    case "not_approved":
      return lc.errNotRequested;
    case "reject_failed":
      return lc.errRejectFailed;
    case "cancel_failed":
      return lc.errCancelFailed;
    case "approve_failed":
    default:
      return lc.errApproveFailed;
  }
}

type LeaveView = "review" | "calendar" | "balance" | "documents" | "ledger";

// View tabs (handoff .lviews): icon + label, selected = filled navy. Matches leave-views.js order/icons.
// Approver management moved to the Users screen (/admin/users) — all role/permission granting is
// unified there — so the former 승인자 관리 sub-tab was removed.
const SUB_TABS: { view: LeaveView; key: keyof Lc; icon: React.ReactNode }[] = [
  { view: "review", key: "subTabReview", icon: <Clock /> },
  { view: "calendar", key: "subTabCalendar", icon: <Calendar /> },
  { view: "balance", key: "subTabBalance", icon: <Wallet /> },
  { view: "documents", key: "subTabDocuments", icon: <FileText /> },
  { view: "ledger", key: "subTabLedger", icon: <ScrollText /> },
];

/** Sub-tab bar for the leave section — all five views now render real content. */
function LeaveSubTabs({
  view,
  onChange,
  lc,
  onRequest,
}: {
  view: LeaveView;
  onChange: (v: LeaveView) => void;
  lc: Lc;
  onRequest: (mode: "proxy" | "self") => void;
}) {
  // 화이트 리디자인(2026-10-13, 시안 AttLeave-PC): 보기 탭은 글자 세그(아이콘 · 보라 채움 없음), 오른쪽에 내 연차 신청 · 대리 신청.
  return (
    <div className="toolbar lvw-subbar">
      <div className="lviews" role="tablist" style={{ margin: 0 }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.view}
            type="button"
            role="tab"
            aria-selected={view === t.view}
            className={view === t.view ? "on" : ""}
            onClick={() => onChange(t.view)}
          >
            {lc[t.key] as string}
          </button>
        ))}
      </div>
      <span className="toolbar__spacer" />
      <button type="button" className="btn btn--ghost" onClick={() => onRequest("self")}>
        {lc.btnSelfRequest}
      </button>
      <button type="button" className="btn btn--pri" onClick={() => onRequest("proxy")}>
        {lc.btnProxyRequest}
      </button>
    </div>
  );
}

export function LeaveQueueClient({
  initialItems,
  // summary(숫자 카드)는 2026-10-13 리디자인에서 화면에 쓰지 않는다 — 상태 탭 건수로 대신.
  initialStatusGroup,
  initialType,
  initialSearch,
  initialRequestId = null,
  initialView,
  initialBalanceUserId,
  locale,
  applicants,
  balances,
  documents,
  ledger,
  currentUserId,
  currentUserName,
}: {
  initialItems: LeaveQueueItem[];
  summary: LeaveQueueSummary;
  initialStatusGroup: LeaveStatusGroup;
  initialType: LeaveType | null;
  initialSearch: string;
  initialRequestId?: string | null;
  /** `?view=balance&user=` — 시급 화면 입사일 「고치기」가 그 사람 잔여 패널로 바로 연다(2026-10-25). */
  initialView?: "review" | "balance";
  initialBalanceUserId?: string | null;
  locale: Locale;
  applicants: LeaveApplicantOption[];
  balances: AdminLeaveBalanceRow[];
  documents: LeaveDocument[];
  ledger: LeaveLedgerEntry[];
  currentUserId: string;
  currentUserName: string;
}) {
  const dictionary = getDictionary(locale);
  const lc = dictionary.admin.leaveConsole;
  const [view, setView] = useState<LeaveView>(initialView ?? "review");
  const [items, setItems] = useState(initialItems);
  // 실시간 갱신(AdminLiveRefresh → router.refresh)으로 서버 목록이 새로 오면 그대로 받는다 — 서버가 기준.
  const [seenInitial, setSeenInitial] = useState(initialItems);
  if (seenInitial !== initialItems) {
    setSeenInitial(initialItems);
    setItems(initialItems);
  }
  const [statusGroup, setStatusGroup] = useState<LeaveStatusGroup>(initialStatusGroup);
  const [typeFilter, setTypeFilter] = useState<LeaveType | null>(initialType);
  const [nameQuery, setNameQuery] = useState(initialSearch);
  // Sort: null = newest submission first (default), "days" = most days, "soon" = start date
  // soonest, "name" = applicant name ascending.
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialRequestId);
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const [requestModal, setRequestModal] = useState<{ mode: "proxy" | "self"; date?: string } | null>(
    null,
  );
  const showToast = (msg: string) => setToast({ id: Date.now(), msg });

  // After an approve/reject, update the resolved request in-place so it leaves 승인 대기 and the
  // tab counts refresh — the list is client-held, so without this it would still show as pending
  // (and re-opening it would hit "already processed").
  function handleResolved(msg: string, resolvedId?: string, resolvedStatus?: LeaveStatus) {
    if (resolvedId && resolvedStatus) {
      setItems((prev) => prev.map((i) => (i.id === resolvedId ? { ...i, status: resolvedStatus } : i)));
    }
    showToast(msg);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejectedCancelled = 0;
    for (const it of items) {
      const g = groupOf(it.status);
      if (g === "pending") pending += 1;
      else if (g === "approved") approved += 1;
      else rejectedCancelled += 1;
    }
    return { pending, approved, rejectedCancelled, all: items.length };
  }, [items]);

  // Plain const (not useMemo): the React Compiler auto-memoizes, and a manual memo here trips the
  // preserve-manual-memoization rule.
  const typeOptions = (["paid", "annual", "special", "other"] as LeaveType[]).map((t) => ({
    value: t,
    label: typeLabel(t, lc),
  }));

  const rows = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return items
      .filter((it) => statusGroup === "all" || groupOf(it.status) === statusGroup)
      .filter((it) => !typeFilter || it.leaveType === typeFilter)
      .filter(
        (it) =>
          !q ||
          it.applicantName.toLowerCase().includes(q) ||
          it.reason.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (sortBy === "days") return b.daysCount - a.daysCount;
        if (sortBy === "soon") return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
        if (sortBy === "name") return a.applicantName.localeCompare(b.applicantName, localeTagOf(locale));
        return new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime();
      });
  }, [items, statusGroup, typeFilter, nameQuery, sortBy, locale]);

  const localeTag = localeTagOf(locale);
  const today = tokyoToday();

  function changeStatusGroup(g: LeaveStatusGroup) {
    setStatusGroup(g);
  }

  const selectedItem = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  if (view === "calendar") {
    return (
      <div style={{ position: "relative" }}>
        <LeaveSubTabs view={view} onChange={setView} lc={lc} onRequest={(mode) => setRequestModal({ mode })} />
        <LeaveTeamCalendar
          lc={lc}
          locale={locale}
          items={items.filter((i) => i.status === "approved")}
          onSelect={(requestId) => setSelectedId(requestId)}
          onCreateRequest={(mode, date) => setRequestModal({ mode, date })}
        />
        {selectedItem ? (
          <LeavePanel
            item={selectedItem}
            lc={lc}
            dictionary={dictionary}
            localeTag={localeTag}
            onClose={() => setSelectedId(null)}
            onResolved={handleResolved}
          />
        ) : null}
        {requestModal ? (
          <LeaveRequestModal
            mode={requestModal.mode}
            prefillDate={requestModal.date}
            applicants={applicants}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            locale={locale}
            lc={lc}
            onClose={() => setRequestModal(null)}
            onCreated={(msg) => showToast(msg)}
          />
        ) : null}
        {toast ? (
          <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
            {toast.msg}
          </div>
        ) : null}
      </div>
    );
  }

  if (view === "balance") {
    return (
      <div style={{ position: "relative" }}>
        <LeaveSubTabs view={view} onChange={setView} lc={lc} onRequest={(mode) => setRequestModal({ mode })} />
        <LeaveBalanceView
          lc={lc}
          shared={dictionary.admin.shared}
          locale={locale}
          employees={balances}
          initialSelectedUserId={initialBalanceUserId ?? null}
          onToast={(msg) => showToast(msg)}
        />
        {toast ? (
          <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
            {toast.msg}
          </div>
        ) : null}
      </div>
    );
  }

  if (view === "documents") {
    return (
      <div style={{ position: "relative" }}>
        <LeaveSubTabs view={view} onChange={setView} lc={lc} onRequest={(mode) => setRequestModal({ mode })} />
        <LeaveDocumentsView lc={lc} locale={locale} documents={documents} />
      </div>
    );
  }

  if (view === "ledger") {
    return (
      <div style={{ position: "relative" }}>
        <LeaveSubTabs view={view} onChange={setView} lc={lc} onRequest={(mode) => setRequestModal({ mode })} />
        <LeaveLedgerView
          lc={lc}
          shared={dictionary.admin.shared}
          locale={locale}
          entries={ledger}
          onToast={(msg) => showToast(msg)}
        />
        {toast ? (
          <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
            {toast.msg}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <LeaveSubTabs view={view} onChange={setView} lc={lc} onRequest={(mode) => setRequestModal({ mode })} />

      {/* Filter toolbar */}
      <div className="toolbar">
        <div className="fseg" role="tablist">
          <button
            type="button"
            className={statusGroup === "pending" ? "on" : ""}
            onClick={() => changeStatusGroup("pending")}
          >
            {lc.filterStatusPending}
            <span className="cnt">{counts.pending}</span>
          </button>
          <button
            type="button"
            className={statusGroup === "approved" ? "on" : ""}
            onClick={() => changeStatusGroup("approved")}
          >
            {lc.filterStatusApproved}
            <span className="cnt">{counts.approved}</span>
          </button>
          <button
            type="button"
            className={statusGroup === "rejectedCancelled" ? "on" : ""}
            onClick={() => changeStatusGroup("rejectedCancelled")}
          >
            {lc.filterStatusRejectedCancelled}
            <span className="cnt">{counts.rejectedCancelled}</span>
          </button>
          <button
            type="button"
            className={statusGroup === "all" ? "on" : ""}
            onClick={() => changeStatusGroup("all")}
          >
            {lc.filterStatusAll}
            <span className="cnt">{counts.all}</span>
          </button>
        </div>
        <span className="toolbar__spacer" />
        <div className="qsearch">
          <Ic>
            <Search />
          </Ic>
          <input
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder={lc.searchPlaceholder}
            aria-label={lc.searchPlaceholder}
          />
          {nameQuery ? (
            <button
              type="button"
              className="qsearch__clear"
              aria-label={lc.searchClear}
              onClick={() => setNameQuery("")}
            >
              <Ic>
                <X />
              </Ic>
            </button>
          ) : null}
        </div>
        <div style={{ width: 152, flex: "0 0 auto" }}>
          <AdmDropdown
            size="sm"
            options={[{ value: "", label: lc.filterChipAllOption }, ...typeOptions]}
            value={typeFilter ?? ""}
            onChange={(v) => setTypeFilter((v || null) as LeaveType | null)}
            ariaLabel={lc.filterChipType}
          />
        </div>
        <div style={{ width: 176, flex: "0 0 auto" }}>
          <AdmDropdown
            size="sm"
            options={[
              { value: "", label: lc.sortSubmittedDesc },
              { value: "soon", label: lc.sortSoon },
              { value: "days", label: lc.sortDaysDesc },
              { value: "name", label: lc.sortName },
            ]}
            value={sortBy ?? ""}
            onChange={(v) => setSortBy(v || null)}
            ariaLabel={lc.sortLabel}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <div className="state">
            <span className="state__ic ok">
              <Ic>
                <CircleCheck />
              </Ic>
            </span>
            <div className="state__t">{lc.emptyTitle}</div>
            <div className="state__s">
              {lc.emptyBody(
                statusGroup === "pending"
                  ? lc.filterStatusPending
                  : statusGroup === "approved"
                    ? lc.filterStatusApproved
                    : statusGroup === "rejectedCancelled"
                      ? lc.filterStatusRejectedCancelled
                      : lc.filterStatusAll,
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <LiveWash move sig={rows.map((item) => item.id).join(",")}>
          <table className="qtbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>{lc.colApplicant}</th>
                <th>{lc.colType}</th>
                <th>{lc.colPeriod}</th>
                <th>{lc.colDays}</th>
                <th>{lc.colReason}</th>
                <th>{lc.colSubmitted}</th>
                <th>{lc.colStatus}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const pill = statusPill(item.status, lc);
                const rowClass = [
                  selectedId === item.id ? "sel" : "",
                  isUrgent(item, today) ? "urgent" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={item.id} data-live={item.id} className={rowClass} onClick={() => setSelectedId(item.id)}>
                    <td style={{ paddingLeft: 16 }}>
                      <div className="who">
                        <span className="avatar" style={{ background: "var(--adm-primary)", color: "#fff" }}>
                          {item.avatarInitial || initial(item.applicantName)}
                        </span>
                        <div>
                          <div className="who__nm">{item.applicantName}</div>
                          <div className="who__sub">{roleLabel(item.applicantRole, dictionary)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`typebadge ${typeBadgeClass(item.leaveType)}`}>
                        {typeLabel(item.leaveType, lc)}
                      </span>
                    </td>
                    <td className="mono">
                      {fmtMd(item.startDate)} – {fmtMd(item.endDate)}
                      {item.durationUnit !== "full" ? (
                        <span className="halftag">
                          {item.durationUnit === "am" ? lc.durationAmTag : lc.durationPmTag}
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">{lc.daysUnit(item.daysCount)}</td>
                    <td style={{ maxWidth: 240 }}>
                      <div
                        className="who__sub"
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 240,
                        }}
                      >
                        {item.reason || "—"}
                      </div>
                    </td>
                    <td className="dim-cell">{fmtSubmitted(item.submittedAt, localeTag)}</td>
                    <td>
                      <span className={`pill ${pill.cls}`}>
                        <span className="d" />
                        {pill.label}
                      </span>
                    </td>
                    <td className="colchev">
                      <Ic>
                        <ChevronRight />
                      </Ic>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </LiveWash>
        </div>
      )}

      {selectedItem ? (
        <LeavePanel
          item={selectedItem}
          lc={lc}
          dictionary={dictionary}
          localeTag={localeTag}
          onClose={() => setSelectedId(null)}
          onResolved={(msg) => showToast(msg)}
        />
      ) : null}

      {requestModal ? (
        <LeaveRequestModal
          mode={requestModal.mode}
          prefillDate={requestModal.date}
          applicants={applicants}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          locale={locale}
          lc={lc}
          onClose={() => setRequestModal(null)}
          onCreated={(msg) => showToast(msg)}
        />
      ) : null}

      {toast ? (
        <div key={toast.id} role="status" className="adm-toast" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

function LeavePanel({
  item,
  lc,
  dictionary,
  localeTag,
  onClose,
  onResolved,
}: {
  item: LeaveQueueItem;
  lc: Lc;
  dictionary: Dictionary;
  localeTag: string;
  onClose: () => void;
  onResolved: (msg: string, resolvedId?: string, resolvedStatus?: LeaveStatus) => void;
}) {
  const [pending, startTransition] = useTransition();
  // 승인 도장(2026-10-15, 시안 Motion-C-Confirm-PC) — 0.6초 꾹 → 버튼 자리에 체크 도장 → 0.85초 뒤 목록에 반영 · 닫힘.
  const [stamped, setStamped] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"reject" | "cancel" | null>(null);
  const [detail, setDetail] = useState<LeaveApprovalDetail | null>(null);
  const [status, setStatus] = useState<LeaveQueueItem["status"]>(item.status);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: modal !== null });

  useEffect(() => {
    let alive = true;
    loadLeaveApprovalDetail(item.id).then((res) => {
      if (alive) setDetail(res);
    });
    return () => {
      alive = false;
    };
  }, [item.id]);

  const pill = statusPill(status, lc);

  function submitApprove() {
    setErr(null);
    startTransition(async () => {
      const res = await approveLeaveRequestAction(item.id);
      if (res.ok) {
        setStamped(true);
        setTimeout(() => {
          setStatus("approved");
          onResolved(lc.actionDoneApprove, item.id, "approved");
          onClose();
        }, 850);
      } else {
        setErr(errLabel(res.error, lc));
      }
    });
  }

  function submitReject(reason: string) {
    setErr(null);
    startTransition(async () => {
      const res = await rejectLeaveRequestAction(item.id, reason.trim() || undefined);
      if (res.ok) {
        setModal(null);
        setStatus("rejected");
        onResolved(lc.actionDoneReject, item.id, "rejected");
        onClose();
      } else {
        setErr(errLabel(res.error, lc));
      }
    });
  }

  function submitCancel(reason: string) {
    setErr(null);
    startTransition(async () => {
      const res = await cancelApprovedLeaveAction(item.id, reason.trim() || undefined);
      if (res.ok) {
        setModal(null);
        setStatus("cancelled");
        onResolved(lc.actionDoneCancel, item.id, "cancelled");
        onClose();
      } else {
        setErr(errLabel(res.error, lc));
      }
    });
  }

  const canAct = status === "requested";

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on" role="dialog" aria-label={lc.panelKicker} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">{lc.panelKicker}</span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={dictionary.common.close}>
              <Ic>
                <X />
              </Ic>
            </button>
          </div>
          <div className="panel__title">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="avatar" style={{ background: "var(--adm-primary)", color: "#fff" }}>
                {item.avatarInitial || initial(item.applicantName)}
              </span>
              <span>
                <span
                  className="panel__sub"
                  style={{ display: "block", color: "var(--ink)", fontSize: 17, fontWeight: 900 }}
                >
                  {item.applicantName}
                </span>
                <span className="panel__sub">{roleLabel(item.applicantRole, dictionary)}</span>
              </span>
            </span>
          </div>
          <div className="panel__chips">
            <span className={`typebadge ${typeBadgeClass(item.leaveType)}`}>
              {typeLabel(item.leaveType, lc)}
            </span>
            <span className={`pill ${pill.cls}`}>
              <span className="d" />
              {pill.label}
            </span>
            <span className="pill pill--muted">{lc.daysUnit(item.daysCount)}</span>
          </div>
        </div>

        <div className="panel__body">
          <div className="pblock">
            <div className="pblock__t">{lc.panelSecApplication}</div>
            <div className="kv">
              <span className="kv__k">{lc.panelKvType}</span>
              <span className="kv__v">{typeLabel(item.leaveType, lc)}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.panelKvPeriod}</span>
              <span className="kv__v mono">
                {fmtYmd(item.startDate)} ~ {fmtYmd(item.endDate)}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.panelKvDuration}</span>
              <span className="kv__v">
                {durationLabel(item.durationUnit, lc)} · {lc.daysUnit(item.daysCount)}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.panelKvSubmitted}</span>
              <span className="kv__v mono">{fmtSubmitted(item.submittedAt, localeTag)}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.panelKvContact}</span>
              <span className="kv__v">{detail?.emergencyContact ?? "—"}</span>
            </div>
            <div className="kv">
              <span className="kv__k">{lc.panelKvAttachments}</span>
              <span className="kv__v">
                {detail && detail.imageUrls.length > 0
                  ? `${detail.imageUrls.length}`
                  : lc.attachmentsNone}
              </span>
            </div>
          </div>

          <div className="pblock">
            <div className="pblock__t">{lc.panelSecReason}</div>
            <div className="reason">{item.reason || "—"}</div>
          </div>

          {detail && detail.balancePool !== "none" && detail.balanceBefore != null && detail.balanceAfter != null ? (
            <div className="pblock">
              <div className="pblock__t">{lc.panelSecBalance}</div>
              <div className="limpact">
                <div className="limpact__row">
                  <span>{detail.balancePool === "paid" ? lc.poolPaid : lc.poolSpecial}</span>
                  <b className="mono">
                    {detail.balanceBefore}
                    {lc.unitDays} → {detail.balanceAfter}
                    {lc.unitDays}
                  </b>
                </div>
                <div className="limpact__bar">
                  {/* balanceAfter goes negative when the request exceeds the remaining balance
                      (an over-balance approval). A negative CSS width is invalid and would leave the
                      previous width painted, so both segments are clamped to 0–100%. */}
                  <i style={{ width: barPct(detail.balanceAfter, detail.balanceBefore) }} />
                  <em style={{ width: barPct(item.daysCount, detail.balanceBefore) }} />
                </div>
                {/* 잔여 초과 경고는 큐 상단 요약 카드에만 있었다. 정작 승인 버튼을 누르는 이
                    모달에는 없어서, 승인자가 음수(`2일 → -1일`)만 보고 초과인 줄 모른 채 승인할
                    수 있었다. 결정하는 화면에 경고를 둔다(2026-08-03). */}
                {detail.balanceAfter < 0 ? (
                  <div className="limpact__note limpact__note--warn">
                    <Ic>
                      <TriangleAlert />
                    </Ic>
                    {lc.balanceOverWarning(String(Math.abs(detail.balanceAfter)))}
                  </div>
                ) : (
                  <div className="limpact__note">
                    <Ic>
                      <Info />
                    </Ic>
                    {status === "requested"
                      ? lc.balanceDeductNote(String(item.daysCount))
                      : lc.balanceDeductedNote(String(item.daysCount))}
                  </div>
                )}
              </div>
            </div>
          ) : detail ? (
            <div className="pblock">
              <div className="pblock__t">{lc.panelSecBalance}</div>
              <div className="who__sub">{lc.balanceNoneNote}</div>
            </div>
          ) : null}

          {detail ? (
            <div className="pblock">
              <div className="pblock__t">
                {lc.panelSecOverlaps}
                {detail.overlaps.length > 0 ? (
                  <span className="pblock__cnt">{detail.overlaps.length}</span>
                ) : null}
              </div>
              {detail.overlaps.length === 0 ? (
                <div className="cvok">
                  <Ic>
                    <CircleCheck />
                  </Ic>
                  {lc.overlapEmpty}
                </div>
              ) : (
                <>
                  <div className="cvhead">
                    <Ic>
                      <Info />
                    </Ic>
                    {lc.overlapHead(String(detail.overlaps.length))}
                  </div>
                  <div className="cvlist">
                    {detail.overlaps.map((o: LeaveOverlap, i: number) => {
                      const op = statusPill(o.status, lc);
                      return (
                        <div className="cvrow" key={i}>
                          <span className="avatar" style={{ background: "var(--adm-primary)", color: "#fff" }}>
                            {o.avatarInitial || initial(o.applicantName)}
                          </span>
                          <div className="cvrow__b">
                            <div className="cvrow__t">{o.applicantName}</div>
                            <div className="cvrow__s mono">
                              {fmtMd(o.startDate)} – {fmtMd(o.endDate)}
                            </div>
                          </div>
                          <span className={`pill ${op.cls}`}>
                            <span className="d" />
                            {op.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : null}

          <div className="pblock">
            <div className="pblock__t">{lc.panelSecFlow}</div>
            <div className="tl">
              <div className="tlrow">
                <span className="tlrow__dot done" />
                <div className="tlrow__b">
                  <div className="tlrow__t">{lc.flowSubmittedBy}</div>
                  <div className="tlrow__s">{detail?.submittedVia ?? lc.flowSubmittedByNote}</div>
                </div>
              </div>
              {status === "requested" ? (
                <div className="tlrow">
                  <span className="tlrow__dot on" />
                  <div className="tlrow__b">
                    <div className="tlrow__t">{lc.flowPendingApprover}</div>
                    <div className="tlrow__s">{lc.flowPendingApproverNote}</div>
                  </div>
                </div>
              ) : (
                <div className="tlrow">
                  <span className="tlrow__dot done" />
                  <div className="tlrow__b">
                    <div className="tlrow__t">
                      {status === "approved" ? lc.flowResultApproved : lc.flowResultRejected}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

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

        {stamped ? (
          <div className="panel__foot" style={{ justifyContent: "center" }} aria-live="polite">
            <span className="cfm-stamp">
              <span className="cfm-stamp__d">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
                </svg>
              </span>
              <span className="cfm-stamp__t">{lc.panelApprovedStamp}</span>
            </span>
          </div>
        ) : canAct ? (
          <div className="panel__foot">
            <button
              type="button"
              className="btn btn--danger-ghost"
              style={{ flex: 1 }}
              onClick={() => setModal("reject")}
              disabled={pending}
            >
              <Ic>
                <Ban />
              </Ic>
              {pending ? lc.actionRejecting : lc.panelBtnReject}
            </button>
            <AdminHoldButton className="btn" style={{ flex: 1.4 }} onConfirm={submitApprove} disabled={pending}>
              <Ic>
                <Check />
              </Ic>
              {pending ? lc.actionApproving : lc.panelBtnApproveHold}
            </AdminHoldButton>
          </div>
        ) : null}
        {status === "approved" ? (
          <div className="panel__foot">
            <button
              type="button"
              className="btn btn--danger-ghost"
              style={{ flex: 1 }}
              onClick={() => setModal("cancel")}
              disabled={pending}
            >
              <Ic>
                <Ban />
              </Ic>
              {pending ? lc.actionCancelling : lc.panelBtnCancelApproval}
            </button>
          </div>
        ) : null}
      </aside>

      {modal === "reject" ? (
        <AdminReasonModal
          title={lc.panelBtnReject}
          description={lc.promptRejectReason}
          placeholder={lc.dialogReasonPlaceholder}
          confirmLabel={pending ? lc.actionRejecting : lc.panelBtnReject}
          cancelLabel={lc.dialogCancel}
          pending={pending}
          errorText={err}
          danger
          onConfirm={submitReject}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal === "cancel" ? (
        <AdminReasonModal
          title={lc.panelBtnCancelApproval}
          description={lc.promptCancelReason}
          placeholder={lc.dialogReasonPlaceholder}
          confirmLabel={pending ? lc.actionCancelling : lc.panelBtnCancelApproval}
          cancelLabel={lc.dialogCancel}
          pending={pending}
          errorText={err}
          danger
          onConfirm={submitCancel}
          onCancel={() => setModal(null)}
        />
      ) : null}
    </>
  );
}
