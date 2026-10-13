"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import {
  Ban,
  CalendarPlus,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Filter,
  LogOut,
  MessageSquare,
  Pencil,
  Search,
  Shield,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ManualSessionModal } from "./manual-session-modal";
import type { ReviewQueueItem } from "@/lib/attendance-review";
import type { AdminCorrectionRow, AdminCorrectionField } from "@/lib/admin-attendance";
import type { AttendanceCorrectionStatus } from "@/lib/attendance";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import {
  approveCorrectionRequest,
  invalidateAttendanceSession,
  loadSessionAuditTrail,
  rejectCorrectionRequest,
  restoreAttendanceSession,
  setCorrectionInReview,
  updateAttendanceSessionAdmin,
  type SessionAuditEntry,
} from "@/app/admin/attendance/actions";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { AdmDropdown } from "../shared/adm-dropdown";
import { AdminTimePicker } from "../shared/admin-time-picker";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";

type Att = Dictionary["admin"]["attendanceConsole"];
type Filter = "review" | "pending" | "corr" | "all";
type PanelRoute =
  | { kind: "sess"; id: string }
  | { kind: "corr"; id: string }
  | null;

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function initial(name: string): string {
  return name.trim().slice(0, 1) || "·";
}

function fmtSec(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type IssueKind = "clockout_missing" | "correction_pending" | "abnormal" | "incomplete" | "review";

function classifyIssue(item: ReviewQueueItem): IssueKind {
  if (item.status === "open" && !item.clockOutLabel) return "clockout_missing";
  if (item.correctionStatus === "requested" || item.correctionStatus === "in_review")
    return "correction_pending";
  if (item.isAbnormal) return "abnormal";
  if (!item.clockOutLabel) return "incomplete";
  return "review";
}

function issueLabel(kind: IssueKind, c: Att): { t: string; s: string } {
  switch (kind) {
    case "clockout_missing":
      return { t: c.issueClockoutMissing, s: c.issueClockoutMissingNote };
    case "correction_pending":
      return { t: c.issueCorrectionPending, s: c.issueCorrectionPendingNote };
    case "abnormal":
      return { t: c.issueAbnormal, s: c.issueAbnormalNote };
    case "incomplete":
      return { t: c.issueIncomplete, s: c.issueIncompleteNote };
    default:
      return { t: c.issueGenericReview, s: c.issueGenericReviewNote };
  }
}

function methodLabel(method: string | null, c: Att): string {
  if (!method) return c.methodFallback;
  if (method === "qr" || method === "qr_gps") return c.methodQr;
  if (method === "manual") return c.methodManual;
  return method;
}

function isUrgent(item: ReviewQueueItem): boolean {
  return (
    item.reviewState === "review_required" && (item.isAbnormal || !item.clockOutLabel)
  );
}

function statusPill(item: ReviewQueueItem, c: Att): { label: string; cls: string } {
  if (item.status === "invalid") return { label: c.statusInvalid, cls: "pill--muted" };
  if (item.correctionStatus === "requested" || item.correctionStatus === "in_review")
    return { label: c.statusPending, cls: "pill--info" };
  if (item.reviewState === "review_required") return { label: c.statusReview, cls: "pill--warn" };
  if (item.status === "open") return { label: c.statusOpen, cls: "pill--open" };
  if (item.status === "completed") return { label: c.statusCompleted, cls: "pill--done" };
  return { label: c.statusNormal, cls: "pill--muted" };
}

function isPending(item: ReviewQueueItem): boolean {
  return (
    item.correctionStatus === "requested" ||
    item.correctionStatus === "in_review" ||
    item.reviewState === "pending_correction"
  );
}

/** Compact per-employee-group status breakdown for the collapsed 전체 세션 group header. */
function groupSummary(
  sessions: ReviewQueueItem[],
  c: Att,
): { label: string; cls: string; n: number }[] {
  let done = 0;
  let review = 0;
  let pending = 0;
  let invalid = 0;
  let open = 0;
  for (const s of sessions) {
    if (s.status === "invalid") invalid += 1;
    else if (isPending(s)) pending += 1;
    else if (s.reviewState === "review_required") review += 1;
    else if (s.status === "open") open += 1;
    else done += 1;
  }
  return [
    { label: c.statusCompleted, cls: "pill--done", n: done },
    { label: c.statusReview, cls: "pill--warn", n: review },
    { label: c.statusPending, cls: "pill--info", n: pending },
    { label: c.statusOpen, cls: "pill--open", n: open },
    { label: c.statusInvalid, cls: "pill--muted", n: invalid },
  ].filter((x) => x.n > 0);
}

/** One session row in the queue table (shared by the flat list and the per-employee grouped list). */
function SessionRow({
  item,
  on,
  c,
  onToggle,
  onOpen,
}: {
  item: ReviewQueueItem;
  on: boolean;
  c: Att;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const urgent = isUrgent(item);
  const issue = issueLabel(classifyIssue(item), c);
  const pill = statusPill(item, c);
  return (
    <tr
      className={`${on ? "sel" : ""} ${urgent && !on ? "urgent" : ""}`.trim()}
      onClick={() => onOpen(item.sessionId)}
    >
      <td className="colchk" onClick={(e) => e.stopPropagation()}>
        <span
          className={`ckbx${on ? " on" : ""}`}
          onClick={() => onToggle(item.sessionId)}
          role="checkbox"
          aria-checked={on}
        >
          {on ? (
            <Ic>
              <Check />
            </Ic>
          ) : null}
        </span>
      </td>
      <td>
        <div className="who">
          <span
            className="uhead__av"
            style={{ width: 32, height: 32 }}
          >
            {initial(item.userName)}
          </span>
          <div>
            <div className="who__nm">{item.userName}</div>
            <div className="who__sub">{item.clockInSiteName ?? "—"}</div>
          </div>
        </div>
      </td>
      <td>
        <span className="mono">{item.operatingDate.slice(5)}</span>{" "}
        <span className="dim-cell">{item.dateLabel.split(" ").pop()}</span>
      </td>
      <td>
        <span className="issue">{issue.t}</span>
        {urgent ? (
          <>
            {" "}
            <span className="pill pill--danger" style={{ height: 18, marginLeft: 4 }}>
              {c.tagUrgent}
            </span>
          </>
        ) : null}
        <div className="who__sub" style={{ marginTop: 2 }}>
          {issue.s}
        </div>
      </td>
      <td className="mono">
        {item.clockInLabel ?? "—"} <span className="dim-cell">→</span>{" "}
        {item.clockOutLabel ? (
          item.clockOutLabel
        ) : (
          <b style={{ color: "var(--danger)", fontFamily: "var(--font)" }}>{c.missingOut}</b>
        )}
      </td>
      <td className="mono">{fmtSec(item.paidDurationSec)}</td>
      <td>{item.clockInSiteName ?? "—"}</td>
      <td>
        <span className="tag tag--method">
          <Ic>
            <Shield />
          </Ic>
          {methodLabel(item.clockInMethod, c)}
        </span>
      </td>
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
}

function isReviewRow(item: ReviewQueueItem): boolean {
  return item.reviewState === "review_required" && !isPending(item);
}

function filterRows(items: ReviewQueueItem[], f: Filter): ReviewQueueItem[] {
  if (f === "review") return items.filter(isReviewRow);
  if (f === "pending") return items.filter(isPending);
  if (f === "all") return items;
  return [];
}

function corrFieldLabel(field: AdminCorrectionField, c: Att): string {
  switch (field) {
    case "clock_in":
      return c.corrFieldClockIn;
    case "clock_out":
      return c.corrFieldClockOut;
    case "site":
      return c.corrFieldSite;
    default:
      return c.corrFieldOther;
  }
}

function corrStatusPill(
  status: AttendanceCorrectionStatus,
  c: Att,
): { label: string; cls: string } {
  switch (status) {
    case "cancelled":
      return { label: c.corrStatusCancelled, cls: "pill--muted" };
    case "requested":
      return { label: c.corrStatusRequested, cls: "pill--info" };
    case "in_review":
      return { label: c.corrStatusInReview, cls: "pill--warn" };
    case "approved":
      return { label: c.corrStatusApproved, cls: "pill--done" };
    case "rejected":
      return { label: c.corrStatusRejected, cls: "pill--muted" };
  }
}

export function AttendanceQueueClient({
  initialItems,
  initialCorrections,
  initialSessionId = null,
  initialFilter = "review",
  initialSearch = "",
  staff = [],
  defaultDate,
  locale,
}: {
  initialItems: ReviewQueueItem[];
  initialCorrections: AdminCorrectionRow[];
  initialSessionId?: string | null;
  initialFilter?: Filter;
  initialSearch?: string;
  staff?: { userId: string; userName: string }[];
  defaultDate: string;
  locale: Locale;
}) {
  const c = getDictionary(locale).admin.attendanceConsole;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const router = useRouter();
  const [manualOpen, setManualOpen] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [corrections, setCorrections] = useState(initialCorrections);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [siteFilter, setSiteFilter] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<IssueKind | null>(null);
  const [nameQuery, setNameQuery] = useState(initialSearch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<PanelRoute>(() => {
    // Explicit session deep link wins.
    if (initialSessionId) return { kind: "sess", id: initialSessionId };
    // Payroll blocker-card deep link (?filter=&q=<name>): open the first matching session /
    // correction panel for that staff member on arrival so their side panel appears immediately.
    const q = initialSearch.trim().toLowerCase();
    if (q) {
      if (initialFilter === "corr") {
        const first = initialCorrections.find((r) => r.requesterName.toLowerCase().includes(q));
        if (first) return { kind: "corr", id: first.id };
      } else {
        const first = filterRows(initialItems, initialFilter).find((r) =>
          r.userName.toLowerCase().includes(q),
        );
        if (first) return { kind: "sess", id: first.sessionId };
      }
    }
    return null;
  });
  const [toast, setToast] = useState<{ id: number; msg: string; sticky?: boolean } | null>(null);
  const showToast = (msg: string, sticky = false) => setToast({ id: Date.now(), msg, sticky });
  const [bulkModal, setBulkModal] = useState<"invalidate" | "approve" | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();

  // Auto-dismiss the toast ~1.8s after it appears (no click needed).
  useEffect(() => {
    if (!toast) return;
    if (toast.sticky) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(
    () => ({
      review: items.filter(isReviewRow).length,
      pending: items.filter(isPending).length,
      corr: corrections.length,
      all: items.length,
    }),
    [items, corrections],
  );

  const siteOptions = useMemo(() => {
    const names = Array.from(
      new Set(items.map((i) => i.clockInSiteName).filter((n): n is string => Boolean(n))),
    );
    names.sort((a, b) => a.localeCompare(b));
    return names.map((n) => ({ value: n, label: n }));
  }, [items]);

  const issueOptions = useMemo(() => {
    const kinds: IssueKind[] = [
      "review",
      "clockout_missing",
      "correction_pending",
      "abnormal",
      "incomplete",
    ];
    return kinds.map((kind) => ({ value: kind, label: issueLabel(kind, c).t }));
  }, [c]);

  const rows = useMemo(() => {
    let base = filterRows(items, filter);
    if (siteFilter) base = base.filter((r) => r.clockInSiteName === siteFilter);
    if (issueFilter) base = base.filter((r) => classifyIssue(r) === issueFilter);
    const q = nameQuery.trim().toLowerCase();
    if (q) base = base.filter((r) => r.userName.toLowerCase().includes(q));
    return base;
  }, [items, filter, siteFilter, issueFilter, nameQuery]);

  const filteredCorrections = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return corrections;
    return corrections.filter((r) => r.requesterName.toLowerCase().includes(q));
  }, [corrections, nameQuery]);

  // On the "전체 세션" tab, collapse the flat list into per-employee groups (expandable) so one
  // worker's many sessions don't stretch the page. Other tabs stay flat (they're short + action-first).
  const grouped = useMemo(() => {
    if (filter !== "all") return null;
    const map = new Map<string, { userId: string; userName: string; sessions: ReviewQueueItem[] }>();
    for (const it of rows) {
      let g = map.get(it.userId);
      if (!g) {
        g = { userId: it.userId, userName: it.userName, sessions: [] };
        map.set(it.userId, g);
      }
      g.sessions.push(it);
    }
    return Array.from(map.values());
  }, [rows, filter]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  function toggleGroup(userId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  // Rows the header "select all" acts on: in grouped mode, only sessions inside EXPANDED groups
  // (collapsed groups' sessions aren't visible, so selecting them would be surprising); flat otherwise.
  const selectableRows = useMemo(() => {
    if (!grouped) return rows;
    return grouped.filter((g) => expandedGroups.has(g.userId)).flatMap((g) => g.sessions);
  }, [grouped, expandedGroups, rows]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const ids = selectableRows.map((r) => r.sessionId);
      if (ids.length === 0) return prev;
      const allOn = ids.every((id) => prev.has(id));
      if (allOn) return new Set([...prev].filter((id) => !ids.includes(id)));
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  function changeFilter(f: Filter) {
    setFilter(f);
    setPanel(null);
    setSelected(new Set());
  }
  function changeSiteFilter(v: string | null) {
    setSiteFilter(v);
    setSelected(new Set());
  }
  function changeIssueFilter(v: string | null) {
    setIssueFilter(v as IssueKind | null);
    setSelected(new Set());
  }

  function applyUpdated(updated: ReviewQueueItem) {
    setItems((prev) => prev.map((i) => (i.sessionId === updated.sessionId ? updated : i)));
  }
  function removeOrUpdateAfterInvalidate(sessionId: string) {
    setItems((prev) =>
      prev.map((i) =>
        i.sessionId === sessionId
          ? { ...i, status: "invalid", reviewState: "normal" }
          : i,
      ),
    );
    setPanel(null);
  }
  function updateCorrection(updated: AdminCorrectionRow) {
    if (updated.status === "approved" || updated.status === "rejected") {
      setCorrections((prev) => prev.filter((r) => r.id !== updated.id));
      return;
    }
    setCorrections((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  function openBulk(kind: "invalidate" | "approve") {
    setBulkErr(null);
    setBulkModal(kind);
  }

  function runBulk(reason: string) {
    const kind = bulkModal;
    if (!kind) return;
    if (!reason.trim()) {
      setBulkErr(c.actionReasonRequired);
      return;
    }
    // invalidate → any selected non-invalid session; mark-reviewed → only sessions flagged
    // review_required (already-normal ones have nothing to review; invalid needs single-session restore).
    const targets = items.filter((i) => {
      if (!selected.has(i.sessionId) || i.status === "invalid") return false;
      return kind === "invalidate" ? true : i.reviewState === "review_required";
    });
    if (targets.length === 0) {
      setBulkErr(c.bulkNoApplicable);
      return;
    }
    setBulkErr(null);
    startBulk(async () => {
      const results = await Promise.all(
        targets.map((i) =>
          kind === "invalidate"
            ? invalidateAttendanceSession(i.sessionId, reason.trim())
            : updateAttendanceSessionAdmin({
                sessionId: i.sessionId,
                reason: reason.trim(),
                reviewState: "normal",
              }),
        ),
      );
      const okIds = new Set(
        targets.filter((_, idx) => results[idx].ok).map((i) => i.sessionId),
      );
      const failed = targets.filter((i) => !okIds.has(i.sessionId));
      const failCount = failed.length;
      setItems((prev) =>
        prev.map((i) =>
          okIds.has(i.sessionId)
            ? kind === "invalidate"
              ? { ...i, status: "invalid", reviewState: "normal" }
              : { ...i, reviewState: "normal", isAbnormal: false }
            : i,
        ),
      );
      setSelected(new Set());
      setBulkModal(null);
      if (failCount > 0) {
        const failedNames = failed
          .slice(0, 3)
          .map((i) => `${i.userName} ${i.operatingDate.slice(5)}`)
          .join(", ");
        const more = failCount > 3 ? ` +${failCount - 3}` : "";
        showToast(`${c.bulkPartial(okIds.size, failCount)} ${c.bulkPartialDetail(failedNames + more)}`, true);
      } else {
        showToast(
          kind === "invalidate" ? c.bulkDoneInvalidate(okIds.size) : c.bulkDoneApprove(okIds.size),
        );
      }
    });
  }

  const allOn =
    selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.sessionId));
  const someOn = !allOn && selectableRows.some((r) => selected.has(r.sessionId));
  const selectedCount = selected.size;
  const panelSession =
    panel?.kind === "sess" ? items.find((i) => i.sessionId === panel.id) ?? null : null;
  const panelCorrection =
    panel?.kind === "corr" ? corrections.find((r) => r.id === panel.id) ?? null : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Filter toolbar */}
      <div className="toolbar">
        <div className="fseg" role="tablist">
          <button
            type="button"
            className={filter === "review" ? "on" : ""}
            onClick={() => changeFilter("review")}
          >
            {c.filterReview}
            <span className="cnt">{counts.review}</span>
          </button>
          <button
            type="button"
            className={filter === "pending" ? "on" : ""}
            onClick={() => changeFilter("pending")}
          >
            {c.filterPending}
            <span className="cnt">{counts.pending}</span>
          </button>
          <button
            type="button"
            className={filter === "corr" ? "on" : ""}
            onClick={() => changeFilter("corr")}
          >
            {c.filterCorr}
            <span className="cnt">{counts.corr}</span>
          </button>
          <button
            type="button"
            className={filter === "all" ? "on" : ""}
            onClick={() => changeFilter("all")}
          >
            {c.filterAll}
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
            onChange={(e) => {
              setNameQuery(e.target.value);
              setSelected(new Set());
            }}
            placeholder={c.searchNamePlaceholder}
            aria-label={c.searchNamePlaceholder}
          />
          {nameQuery ? (
            <button
              type="button"
              className="qsearch__clear"
              aria-label={c.searchClear}
              onClick={() => {
                setNameQuery("");
                setSelected(new Set());
              }}
            >
              <Ic>
                <X />
              </Ic>
            </button>
          ) : null}
        </div>
        <div style={{ width: 168, flex: "0 0 auto" }}>
          <AdmDropdown
            size="sm"
            options={[{ value: "", label: c.filterChipAllOption }, ...siteOptions]}
            value={siteFilter ?? ""}
            onChange={(v) => changeSiteFilter(v || null)}
            ariaLabel={c.filterChipSite(c.filterChipAllOption)}
          />
        </div>
        <div style={{ width: 156, flex: "0 0 auto" }}>
          <AdmDropdown
            size="sm"
            options={[{ value: "", label: c.filterChipIssue }, ...issueOptions]}
            value={issueFilter ?? ""}
            onChange={(v) => changeIssueFilter(v || null)}
            ariaLabel={c.filterChipIssue}
          />
        </div>
        <button
          type="button"
          className="btn btn--pri btn--sm"
          onClick={() => setManualOpen(true)}
        >
          <Ic>
            <CalendarPlus />
          </Ic>
          {c.manualAddBtn}
        </button>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && filter !== "corr" ? (
        <div className="bulkbar">
          <span className="bulkbar__n">
            <span className="badge">{selectedCount}</span>
            {c.bulkSelected(selectedCount)}
          </span>
          <button type="button" className="bulkbar__clear" onClick={clearSel}>
            {c.bulkClear}
          </button>
          <span className="bulkbar__sp" />
          <button type="button" className="bbtn" disabled title={c.bulkMessagePendingNote}>
            <Ic>
              <MessageSquare />
            </Ic>
            {c.bulkMessage}
          </button>
          <button type="button" className="bbtn" disabled title={c.bulkEditPendingNote}>
            <Ic>
              <Pencil />
            </Ic>
            {c.bulkEdit}
          </button>
          <button
            type="button"
            className="bbtn bbtn--reject"
            onClick={() => openBulk("invalidate")}
            disabled={bulkPending}
          >
            <Ic>
              <Ban />
            </Ic>
            {c.bulkInvalidate}
          </button>
          <button
            type="button"
            className="bbtn bbtn--approve"
            onClick={() => openBulk("approve")}
            disabled={bulkPending}
          >
            <Ic>
              <CheckCheck />
            </Ic>
            {c.bulkApprove}
          </button>
        </div>
      ) : null}

      {bulkModal ? (
        <AdminReasonModal
          title={bulkModal === "invalidate" ? c.bulkInvalidateTitle : c.bulkApproveTitle}
          description={
            bulkModal === "invalidate"
              ? c.bulkInvalidateDesc(selectedCount)
              : c.bulkApproveDesc(selectedCount)
          }
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={
            bulkPending
              ? c.bulkRunning
              : bulkModal === "invalidate"
                ? c.bulkInvalidate
                : c.bulkApprove
          }
          cancelLabel={c.dialogCancel}
          pending={bulkPending}
          errorText={bulkErr}
          danger={bulkModal === "invalidate"}
          onConfirm={runBulk}
          onCancel={() => setBulkModal(null)}
        />
      ) : null}

      {/* Table or correction list */}
      {filter === "corr" ? (
        filteredCorrections.length === 0 ? (
          <div className="card">
            <div className="state">
              <span className="state__ic ok">
                <Ic>
                  <CircleCheck />
                </Ic>
              </span>
              <div className="state__t">{c.corrEmptyTitle}</div>
              <div className="state__s">{c.corrEmptyBody}</div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="qtbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 16 }}>{c.corrColRequester}</th>
                  <th>{c.corrColTargetDate}</th>
                  <th>{c.corrColField}</th>
                  <th>{c.corrColChange}</th>
                  <th>{c.corrColReason}</th>
                  <th>{c.corrColStatus}</th>
                  <th>{c.corrColSubmitted}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredCorrections.map((r) => {
                  const pill = corrStatusPill(r.status, c);
                  const fieldLabel = corrFieldLabel(r.field, c);
                  const sel = panel?.kind === "corr" && panel.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={sel ? "sel" : ""}
                      onClick={() => setPanel({ kind: "corr", id: r.id })}
                    >
                      <td style={{ paddingLeft: 16 }}>
                        <div className="who">
                          <span
                            className="uhead__av"
                            style={{ width: 32, height: 32 }}
                          >
                            {initial(r.requesterName)}
                          </span>
                          <div>
                            <div className="who__nm">{r.requesterName}</div>
                            <div className="who__sub">{r.requesterRole ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {r.dateLabel ? (
                          <span className="mono">{r.operatingDate?.slice(5) ?? "—"}</span>
                        ) : (
                          <span className="dim-cell">—</span>
                        )}
                      </td>
                      <td>
                        <span className="issue">{fieldLabel}</span>
                      </td>
                      <td>
                        <span
                          className="dim-cell"
                          style={{
                            textDecoration: "line-through",
                            fontSize: 12.5,
                            fontFamily: "var(--mono)",
                          }}
                        >
                          {r.beforeLabel}
                        </span>{" "}
                        <span className="dim-cell">→</span>{" "}
                        <b
                          className="mono"
                          style={{ color: "var(--done)" }}
                        >
                          {r.afterLabel}
                        </b>
                      </td>
                      <td style={{ maxWidth: 280 }}>
                        <div
                          className="who__sub"
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 280,
                          }}
                        >
                          {r.memo ?? "—"}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${pill.cls}`}>
                          <span className="d" />
                          {pill.label}
                        </span>
                      </td>
                      <td className="dim-cell">{r.submittedLabel}</td>
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
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="state">
            <span className="state__ic ok">
              <Ic>
                <CircleCheck />
              </Ic>
            </span>
            <div className="state__t">{c.emptyTitle}</div>
            <div className="state__s">
              {c.emptyBody(
                filter === "review"
                  ? c.filterReview
                  : filter === "pending"
                    ? c.filterPending
                    : c.filterAll,
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="qtbl">
            <thead>
              <tr>
                <th className="colchk">
                  <span
                    className={`ckbx${allOn ? " on" : someOn ? " dash" : ""}`}
                    onClick={toggleAll}
                    role="checkbox"
                    aria-checked={allOn}
                  >
                    {allOn ? (
                      <Ic>
                        <Check />
                      </Ic>
                    ) : null}
                  </span>
                </th>
                <th>{c.colStaff}</th>
                <th>{c.colDate}</th>
                <th>{c.colIssue}</th>
                <th>{c.colInOut}</th>
                <th>{c.colWorked}</th>
                <th>{c.colSite}</th>
                <th>{c.colMethod}</th>
                <th>{c.colStatus}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grouped
                ? grouped.map((g) => {
                    const gOpen = expandedGroups.has(g.userId);
                    const summary = groupSummary(g.sessions, c);
                    const site =
                      g.sessions.find((s) => s.clockInSiteName)?.clockInSiteName ?? "—";
                    return (
                      <Fragment key={g.userId}>
                        <tr
                          className={`grouphdr${gOpen ? " on" : ""}`}
                          onClick={() => toggleGroup(g.userId)}
                        >
                          <td colSpan={10}>
                            <div className="grp">
                              <span className={`grp__chev${gOpen ? " on" : ""}`}>
                                <Ic>
                                  <ChevronDown />
                                </Ic>
                              </span>
                              <span
                                className="uhead__av"
                                style={{
                                  background: "#ede7fc",
                                  color: "#5a30cf",
                                  width: 30,
                                  height: 30,
                                  borderRadius: "50%",
                                  fontSize: 12,
                                }}
                              >
                                {initial(g.userName)}
                              </span>
                              <div className="grp__id">
                                <span className="grp__nm">{g.userName}</span>
                                <span className="grp__site">{site}</span>
                              </div>
                              <span className="grp__cnt">
                                {g.sessions.length}
                                {c.unitCount}
                              </span>
                              <span className="grp__badges">
                                {summary.map((s, i) => (
                                  <span key={i} className={`pill ${s.cls}`}>
                                    <span className="d" />
                                    {s.label} {s.n}
                                  </span>
                                ))}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {gOpen
                          ? g.sessions.map((item) => (
                              <SessionRow
                                key={item.sessionId}
                                item={item}
                                on={selected.has(item.sessionId)}
                                c={c}
                                onToggle={toggleRow}
                                onOpen={(id) => setPanel({ kind: "sess", id })}
                              />
                            ))
                          : null}
                      </Fragment>
                    );
                  })
                : rows.map((item) => (
                    <SessionRow
                      key={item.sessionId}
                      item={item}
                      on={selected.has(item.sessionId)}
                      c={c}
                      onToggle={toggleRow}
                      onOpen={(id) => setPanel({ kind: "sess", id })}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Right detail panel — session OR correction */}
      {panelSession ? (
        <SessionPanel
          item={panelSession}
          c={c}
          onClose={() => setPanel(null)}
          onInvalidated={(id) => {
            removeOrUpdateAfterInvalidate(id);
            showToast(c.actionDoneInvalidate);
          }}
          onApproved={(updated) => {
            applyUpdated(updated);
            showToast(c.actionDoneApprove);
          }}
          onRestored={(updated) => {
            applyUpdated(updated);
            showToast(c.actionDoneRestore);
          }}
          onEdited={(updated) => {
            applyUpdated(updated);
            showToast(c.actionDoneEdit);
          }}
        />
      ) : null}
      {panelCorrection ? (
        <CorrectionPanel
          row={panelCorrection}
          c={c}
          onClose={() => setPanel(null)}
          onUpdated={(updated, msg) => {
            updateCorrection(updated);
            showToast(msg);
          }}
          onOpenSession={(sessionId) => setPanel({ kind: "sess", id: sessionId })}
        />
      ) : null}

      {manualOpen ? (
        <ManualSessionModal
          staff={staff}
          defaultDate={defaultDate}
          locale={locale}
          localeTag={localeTag}
          onClose={() => setManualOpen(false)}
          onDone={(msg) => {
            setManualOpen(false);
            showToast(msg);
            router.refresh();
          }}
        />
      ) : null}

      {toast ? (
        <div
          key={toast.id}
          role="status"
          className="adm-toast"
          onClick={() => setToast(null)}
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

function SessionPanel({
  item,
  c,
  onClose,
  onInvalidated,
  onApproved,
  onRestored,
  onEdited,
}: {
  item: ReviewQueueItem;
  c: Att;
  onClose: () => void;
  onInvalidated: (sessionId: string) => void;
  onApproved: (updated: ReviewQueueItem) => void;
  onRestored: (updated: ReviewQueueItem) => void;
  onEdited: (updated: ReviewQueueItem) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"invalidate" | "approve" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editClockIn, setEditClockIn] = useState(item.clockInLabel ?? "");
  const [editClockOut, setEditClockOut] = useState(item.clockOutLabel ?? "");
  const [editReason, setEditReason] = useState("");
  const [auditState, setAuditState] = useState<{ key: string; entries: SessionAuditEntry[] }>({
    key: "",
    entries: [],
  });
  const [auditReloadKey, setAuditReloadKey] = useState(0);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: modal !== null });
  const issueKind = classifyIssue(item);
  const issue = issueLabel(issueKind, c);
  const pill = statusPill(item, c);
  const urgent = isUrgent(item);
  const isInvalid = item.status === "invalid";
  const needsReview = item.reviewState === "review_required";
  // Restoring an invalid session must yield a COMPLETE session — if a clock end is still missing,
  // the admin must fill it via 수동 정정 first, so "복구 및 완료 처리" is blocked until then.
  const restoreBlocked = isInvalid && (!item.clockInLabel || !item.clockOutLabel);
  // "검토 완료 처리" only makes sense for a session flagged review_required (or an invalid one → restore).
  // An already-normal session has nothing to review, so the button is disabled (avoids no-op audit noise).
  const approveDisabled = pending || restoreBlocked || (!isInvalid && !needsReview);

  const auditKey = `${item.sessionId}:${auditReloadKey}`;
  // Derived loading: null until the async load for the CURRENT key resolves (no sync setState in effect).
  const audits: SessionAuditEntry[] | null = auditState.key === auditKey ? auditState.entries : null;

  useEffect(() => {
    let alive = true;
    loadSessionAuditTrail(item.sessionId).then((res) => {
      if (alive) setAuditState({ key: auditKey, entries: res.ok ? res.entries : [] });
    });
    return () => {
      alive = false;
    };
  }, [item.sessionId, auditKey]);

  function openEdit() {
    setErr(null);
    setModal(null);
    setEditClockIn(item.clockInLabel ?? "");
    setEditClockOut(item.clockOutLabel ?? "");
    setEditReason("");
    setEditOpen(true);
  }

  function submitEdit() {
    if (!editReason.trim()) {
      setErr(c.actionReasonRequired);
      return;
    }
    const input: {
      sessionId: string;
      reason: string;
      clockInTime?: string | null;
      clockOutTime?: string | null;
    } = { sessionId: item.sessionId, reason: editReason.trim() };

    const baseIn = item.clockInLabel ?? "";
    const baseOut = item.clockOutLabel ?? "";
    if (editClockIn !== baseIn && editClockIn.trim() !== "") input.clockInTime = editClockIn;
    if (editClockOut !== baseOut) input.clockOutTime = editClockOut.trim() === "" ? null : editClockOut;

    if (input.clockInTime === undefined && input.clockOutTime === undefined) {
      setErr(c.actionNoChanges);
      return;
    }

    setErr(null);
    startTransition(async () => {
      const res = await updateAttendanceSessionAdmin(input);
      if (res.ok) {
        setEditOpen(false);
        const nextIn = input.clockInTime !== undefined ? input.clockInTime : item.clockInLabel;
        const nextOut =
          input.clockOutTime !== undefined ? input.clockOutTime : item.clockOutLabel;
        onEdited({
          ...item,
          clockInLabel: nextIn,
          clockOutLabel: nextOut,
          // An invalid session stays invalid after a manual edit (server keeps it invalid); the admin
          // still has to run "복구 및 완료 처리" — which is now unblocked since both ends are present.
          status:
            item.status === "invalid" ? item.status : nextIn && nextOut ? "completed" : item.status,
        });
        setAuditReloadKey((k) => k + 1);
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "reason_required") {
        setErr(c.actionReasonRequired);
      } else if (res.reason === "invalid") {
        setErr(c.actionInvalidTime);
      } else {
        setErr(c.actionFailed);
      }
    });
  }

  function submitInvalidate(reason: string) {
    if (!reason.trim()) {
      setErr(c.actionReasonRequired);
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await invalidateAttendanceSession(item.sessionId, reason.trim());
      if (res.ok) {
        setModal(null);
        onInvalidated(item.sessionId);
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "reason_required") {
        setErr(c.actionReasonRequired);
      } else {
        setErr(c.actionFailed);
      }
    });
  }

  function submitApprove(comment: string) {
    setErr(null);
    if (isInvalid) {
      startTransition(async () => {
        const res = await restoreAttendanceSession(
          item.sessionId,
          comment.trim() || c.actionRestoreDefaultReason,
        );
        if (res.ok) {
          setModal(null);
          onRestored({
            ...item,
            reviewState: "normal",
            status: "completed",
            isAbnormal: false,
          });
          onClose();
        } else if (res.reason === "forbidden") {
          setErr(c.actionForbidden);
        } else if (res.reason === "reason_required") {
          setErr(c.actionReasonRequired);
        } else if (res.reason === "incomplete") {
          setErr(c.restoreNeedsCompleteNote);
        } else if (res.reason === "open_conflict") {
          setErr(c.actionOpenConflict);
        } else {
          setErr(c.actionFailed);
        }
      });
      return;
    }
    startTransition(async () => {
      const res = await updateAttendanceSessionAdmin({
        sessionId: item.sessionId,
        reason: comment.trim() || c.auditDefaultReviewedReason,
        reviewState: "normal",
      });
      if (res.ok) {
        setModal(null);
        onApproved({ ...item, reviewState: "normal", isAbnormal: false });
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "reason_required") {
        setErr(c.actionReasonRequired);
      } else {
        setErr(c.actionFailed);
      }
    });
  }

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside
        ref={panelRef}
        className="panel on"
        role="dialog"
        aria-label={c.panelKickerSession}
        tabIndex={-1}
      >
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">
              {c.panelKickerSession} · {item.clockInSiteName ?? "—"}
            </span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={c.panelClose}>
              <Ic>
                <X />
              </Ic>
            </button>
          </div>
          <div className="panel__title">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                className="uhead__av"
                style={{ background: "var(--adm-primary)" }}
              >
                {initial(item.userName)}
              </span>
              <span>
                <span
                  className="panel__sub"
                  style={{
                    display: "block",
                    color: "var(--ink)",
                    fontSize: 17,
                    fontWeight: 900,
                  }}
                >
                  {item.userName}
                </span>
                <span className="panel__sub">{item.dateLabel}</span>
              </span>
            </span>
          </div>
          <div className="panel__chips">
            <span className={`pill ${pill.cls}`}>
              <span className="d" />
              {pill.label}
            </span>
            <span className={`pill ${urgent ? "pill--danger" : "pill--warn"}`}>{issue.t}</span>
            <span className="pill pill--muted">
              <span className="mono">{item.operatingDate.slice(5)}</span>
            </span>
          </div>
        </div>

        <div className="panel__body">
          {/* 세션 정보 */}
          <div className="pblock">
            <div className="pblock__t">{c.panelSecInfo}</div>
            <div className="kv">
              <span className="kv__k">{c.panelKvIn}</span>
              <span className="kv__v">
                {item.clockInDate ? (
                  <span className="dim-cell mono" style={{ marginRight: 6, fontSize: 11.5 }}>
                    {item.clockInDate.slice(5)}
                  </span>
                ) : null}
                <span className="mono">{item.clockInLabel ?? "—"}</span>
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.panelKvOut}</span>
              <span className="kv__v">
                {item.clockOutDate ? (
                  <span className="dim-cell mono" style={{ marginRight: 6, fontSize: 11.5 }}>
                    {item.clockOutDate.slice(5)}
                    {item.clockOutDate !== item.clockInDate ? ` (${c.panelDateNextDay})` : ""}
                  </span>
                ) : null}
                {item.clockOutLabel ? (
                  <span className="mono">{item.clockOutLabel}</span>
                ) : (
                  <b style={{ color: "var(--danger)" }}>{c.missingOut}</b>
                )}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.panelKvWorked}</span>
              <span className="kv__v">
                <span className="mono">{fmtSec(item.paidDurationSec)}</span>
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.panelKvBreak}</span>
              <span className="kv__v">
                <span className="mono">{fmtSec(item.breakTotalSec)}</span>
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.panelKvMethod}</span>
              <span className="kv__v">
                <span className="tag tag--method">
                  <Ic>
                    <Shield />
                  </Ic>
                  {methodLabel(item.clockInMethod, c)}
                </span>
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">{c.panelKvSite}</span>
              <span className="kv__v">{item.clockInSiteName ?? "—"}</span>
            </div>
          </div>

          {/* 이상 내역 */}
          <div className="pblock">
            <div className="pblock__t">{c.panelSecAnomaly}</div>
            <div className={`errbar${urgent ? "" : " is-warn"}`} style={{ margin: 0 }}>
              <span className="errbar__ic">
                <Ic>
                  <Clock />
                </Ic>
              </span>
              <div>
                <div className="errbar__t">{issue.t}</div>
                <div className="errbar__s">{issue.s}</div>
              </div>
            </div>
          </div>

          {/* 활동 기록 */}
          <div className="pblock">
            <div className="pblock__t">{c.panelSecActivity}</div>
            <div className="tl">
              {item.reviewState === "review_required" ? (
                <div className="tlrow">
                  <span className="tlrow__dot on" />
                  <div className="tlrow__b">
                    <div className="tlrow__t">{c.panelActReview}</div>
                    <div className="tlrow__s">{issue.t}</div>
                  </div>
                </div>
              ) : null}
              {item.correctionStatus === "requested" || item.correctionStatus === "in_review" ? (
                <div className="tlrow">
                  <span className="tlrow__dot on" />
                  <div className="tlrow__b">
                    <div className="tlrow__t">{c.panelActCorrPending}</div>
                    <div className="tlrow__s">{c.issueCorrectionPendingNote}</div>
                  </div>
                </div>
              ) : null}
              {item.clockOutLabel ? (
                <div className="tlrow">
                  <span className="tlrow__dot done" />
                  <div className="tlrow__b">
                    <div className="tlrow__t">{c.panelActClockOut}</div>
                    <div className="tlrow__s">
                      {item.clockOutLabel}
                      {item.clockOutSiteName ? ` · ${item.clockOutSiteName}` : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="tlrow">
                  <span className="tlrow__dot" />
                  <div className="tlrow__b">
                    <div className="tlrow__t">{c.panelActMissingOut}</div>
                    <div className="tlrow__s">{c.issueClockoutMissingNote}</div>
                  </div>
                </div>
              )}
              <div className="tlrow">
                <span className="tlrow__dot done" />
                <div className="tlrow__b">
                  <div className="tlrow__t">{c.panelActOpen}</div>
                  <div className="tlrow__s">
                    {item.clockInLabel ?? "—"}
                    {item.clockInSiteName ? ` · ${item.clockInSiteName}` : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 변경 내역 (감사 로그) */}
          <div className="pblock">
            <div className="pblock__t">{c.auditTitle}</div>
            {audits === null ? (
              <div className="empty">{c.auditLoading}</div>
            ) : audits.length === 0 ? (
              <div className="empty">{c.auditEmpty}</div>
            ) : (
              <div className="audlist">
                {audits.map((a) => (
                  <div className="audrow" key={a.id}>
                    <div className="audrow__head">
                      <span className="audrow__action">{a.actionLabel}</span>
                      <span className="audrow__at mono">{a.atLabel}</span>
                    </div>
                    <div className="audrow__actor">{a.actorName}</div>
                    {a.changes.length > 0 ? (
                      <div className="audrow__changes">
                        {a.changes.map((ch, i) => (
                          <div className="audchange" key={i}>
                            <span className="audchange__f">{ch.label}</span>
                            <span className="audchange__from mono">{ch.from}</span>
                            <span className="audchange__arw">→</span>
                            <span className="audchange__to mono">{ch.to}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {a.reason ? (
                      <div className="audrow__reason">
                        <span className="audrow__reasonlbl">{c.auditReasonLabel}</span>
                        {a.reason}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 수동 정정 인라인 폼 */}
          {editOpen ? (
            <div className="pblock">
              <div className="wedit">
                <div className="wedit__h">
                  <span className="wedit__t">
                    <Ic>
                      <Pencil />
                    </Ic>
                    &nbsp;{c.panelBtnEdit}
                  </span>
                  <span className="wedit__role">
                    <Ic>
                      <Shield />
                    </Ic>
                    {c.panelPermRole}
                  </span>
                </div>
                <div className="wgrid">
                  <div>
                    <div className="wfield__l">{c.panelEditFieldClockIn}</div>
                    <AdminTimePicker
                      value={editClockIn}
                      onChange={setEditClockIn}
                      ariaLabel={c.panelEditFieldClockIn}
                    />
                  </div>
                  <div>
                    <div className="wfield__l">{c.panelEditFieldClockOut}</div>
                    <AdminTimePicker
                      value={editClockOut}
                      onChange={setEditClockOut}
                      ariaLabel={c.panelEditFieldClockOut}
                    />
                  </div>
                </div>
                <div className="wreason">
                  <div className="wfield__l">{c.panelEditReasonLabel}</div>
                  <input
                    type="text"
                    placeholder={c.dialogReasonPlaceholder}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                  />
                </div>
                <div className="wedit__btns">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ flex: 1 }}
                    onClick={() => setEditOpen(false)}
                    disabled={pending}
                  >
                    {c.dialogCancel}
                  </button>
                  <button
                    type="button"
                    className="btn btn--pri btn--sm"
                    style={{ flex: 1.5 }}
                    onClick={submitEdit}
                    disabled={pending}
                  >
                    <Ic>
                      <Check />
                    </Ic>
                    {pending ? c.actionEditing : c.panelEditBtnApply}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* 관리자 강제 조치 */}
          <div className="pblock">
            <div className="permzone">
              <div className="permzone__h">
                <span className="permzone__ic">
                  <Ic>
                    <Shield />
                  </Ic>
                </span>
                <div>
                  <div className="permzone__t">{c.panelPermTitle}</div>
                  <div className="permzone__s">{c.panelPermSub}</div>
                </div>
                <span className="permzone__role">
                  <Ic>
                    <Shield />
                  </Ic>
                  {c.panelPermRole}
                </span>
              </div>
              <div className="permbtns">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ flex: 1 }}
                  onClick={openEdit}
                  disabled={pending}
                >
                  <Ic>
                    <Pencil />
                  </Ic>
                  {c.panelBtnEdit}
                </button>
                <button
                  type="button"
                  className="btn btn--danger-ghost btn--sm"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setEditOpen(false);
                    setModal("invalidate");
                  }}
                  disabled={pending || item.status === "invalid"}
                >
                  <Ic>
                    <Ban />
                  </Ic>
                  {pending ? c.actionInvalidating : c.panelBtnInvalidate}
                </button>
              </div>
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

        <div className="panel__foot">
          <button
            type="button"
            className="btn btn--ghost"
            style={{ flex: 1 }}
            disabled
            title={c.panelMsgPendingNote}
          >
            <Ic>
              <MessageSquare />
            </Ic>
            {c.panelBtnMessage}
          </button>
          <button
            type="button"
            className="btn btn--ok"
            style={{ flex: 1.4 }}
            onClick={() => {
              setEditOpen(false);
              setModal("approve");
            }}
            disabled={approveDisabled}
            title={
              approveDisabled && !pending
                ? restoreBlocked
                  ? c.restoreNeedsCompleteNote
                  : c.panelReviewedNote
                : undefined
            }
          >
            <Ic>
              <Check />
            </Ic>
            {pending
              ? isInvalid
                ? c.actionRestoring
                : c.actionApproving
              : isInvalid
                ? c.panelBtnRestore
                : needsReview
                  ? c.panelBtnApprove
                  : c.panelBtnReviewed}
          </button>
        </div>
      </aside>

      {modal === "invalidate" ? (
        <AdminReasonModal
          title={c.panelBtnInvalidate}
          description={c.promptInvalidateReason}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={pending ? c.actionInvalidating : c.panelBtnInvalidate}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          danger
          onConfirm={submitInvalidate}
          onCancel={() => setModal(null)}
        />
      ) : null}
      {modal === "approve" ? (
        <AdminReasonModal
          title={isInvalid ? c.panelBtnRestore : c.panelBtnApprove}
          description={isInvalid ? c.promptRestoreReason : c.promptApproveComment}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={
            pending
              ? isInvalid
                ? c.actionRestoring
                : c.actionApproving
              : isInvalid
                ? c.panelBtnRestore
                : c.panelBtnApprove
          }
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          onConfirm={submitApprove}
          onCancel={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

function CorrectionPanel({
  row,
  c,
  onClose,
  onUpdated,
  onOpenSession,
}: {
  row: AdminCorrectionRow;
  c: Att;
  onClose: () => void;
  onUpdated: (updated: AdminCorrectionRow, toast: string) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"approve" | "reject" | null>(null);
  // Evidence photos the requester attached — same lightbox carousel the transport panel uses.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = row.imageUrls;
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, {
    disabled: modal !== null || lightboxIndex !== null,
  });
  const pill = corrStatusPill(row.status, c);
  const resolved = row.status === "approved" || row.status === "rejected";

  function submitApprove(comment: string) {
    setErr(null);
    startTransition(async () => {
      const res = await approveCorrectionRequest({
        requestId: row.id,
        comment: comment.trim() ? comment.trim() : null,
      });
      if (res.ok) {
        setModal(null);
        onUpdated(
          { ...row, status: "approved", reviewComment: comment.trim() || null },
          c.corrActionDoneApprove,
        );
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else {
        setErr(c.actionFailed);
      }
    });
  }
  function submitReject(comment: string) {
    if (!comment.trim()) {
      setErr(c.corrActionCommentRequired);
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await rejectCorrectionRequest(row.id, comment.trim());
      if (res.ok) {
        setModal(null);
        onUpdated(
          { ...row, status: "rejected", reviewComment: comment.trim() },
          c.corrActionDoneReject,
        );
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "comment_required") {
        setErr(c.corrActionCommentRequired);
      } else {
        setErr(c.actionFailed);
      }
    });
  }
  function doClaim() {
    setErr(null);
    startTransition(async () => {
      const res = await setCorrectionInReview(row.id);
      if (res.ok) {
        onUpdated({ ...row, status: "in_review" }, c.corrActionDoneClaim);
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else {
        setErr(c.actionFailed);
      }
    });
  }

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside
        ref={panelRef}
        className="panel on"
        role="dialog"
        aria-label={c.corrPanelKicker}
        tabIndex={-1}
      >
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">
              {c.corrPanelKicker} · {corrFieldLabel(row.field, c)}
            </span>
            <button type="button" className="panel__x" onClick={onClose} aria-label={c.panelClose}>
              <Ic>
                <X />
              </Ic>
            </button>
          </div>
          <div className="panel__title">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="uhead__av" style={{ background: "var(--adm-primary)" }}>
                {initial(row.requesterName)}
              </span>
              <span>
                <span
                  className="panel__sub"
                  style={{
                    display: "block",
                    color: "var(--ink)",
                    fontSize: 17,
                    fontWeight: 900,
                  }}
                >
                  {row.requesterName}
                </span>
                <span className="panel__sub">
                  {row.dateLabel ? row.dateLabel : "—"}
                  {row.requesterRole ? ` · ${row.requesterRole}` : ""}
                </span>
              </span>
            </span>
          </div>
          <div className="panel__chips">
            <span className={`pill ${pill.cls}`}>
              <span className="d" />
              {pill.label}
            </span>
            <span className="pill pill--muted">{c.corrPanelSubmittedAt(row.submittedLabel)}</span>
          </div>
        </div>

        <div className="panel__body">
          {/* diffs */}
          {row.diffs.map((d, i) => (
            <div className="pblock" key={i}>
              <div className="pblock__t">{c.corrPanelDiffSection(corrFieldLabel(d.field, c))}</div>
              <div className="diff">
                <div className="diff__cell before">
                  <div className="diff__lbl">{c.corrPanelDiffBefore}</div>
                  <div className="diff__v strike">{d.beforeLabel}</div>
                </div>
                <div className="diff__arrow">
                  <Ic>
                    <ChevronRight />
                  </Ic>
                </div>
                <div className="diff__cell after">
                  <div className="diff__lbl">{c.corrPanelDiffAfter}</div>
                  <div className="diff__v">{d.afterLabel}</div>
                </div>
              </div>
            </div>
          ))}

          {/* reason */}
          <div className="pblock">
            <div className="pblock__t">{c.corrPanelReasonSection}</div>
            <div className="reason">
              <div className="reason__q">{c.corrPanelReasonHeader}</div>
              {row.memo ?? c.corrPanelReasonEmpty}
            </div>
          </div>

          {/* evidence photos — the reviewer must never approve/reject without seeing them */}
          <div className="pblock">
            <div className="pblock__t">{c.trPanelEvidenceCount(photos.length)}</div>
            {photos.length > 0 ? (
              <div className="trthumbs" style={{ flexWrap: "wrap", gap: 6 }}>
                {photos.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    className="trthumb"
                    style={{ width: 64, height: 64 }}
                    onClick={() => setLightboxIndex(i)}
                    aria-label={c.trPanelEvidenceCount(photos.length)}
                  >
                    <Image src={url} alt="" width={34} height={34} />
                  </button>
                ))}
              </div>
            ) : (
              <span className="trthumb trthumb--missing" title={c.trEvidenceMissing}>
                <Camera />
              </span>
            )}
          </div>

          {/* linked session */}
          {row.sessionId ? (
            <div className="pblock">
              <div className="pblock__t">{c.corrPanelLinkedSection}</div>
              <div
                className="qrow"
                style={{
                  border: "1px solid var(--line-soft)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
                onClick={() => onOpenSession(row.sessionId!)}
              >
                <span className="qrow__ic bg-warn">
                  <Ic>
                    <Clock />
                  </Ic>
                </span>
                <div className="qrow__b">
                  <div className="qrow__t">{c.corrPanelLinkedRowTitle}</div>
                  <div className="qrow__s">
                    {c.corrPanelLinkedRowSub(row.dateLabel ?? row.operatingDate ?? "—")}
                  </div>
                </div>
                <span className="ic qrow__chev">
                  <ChevronRight />
                </span>
              </div>
            </div>
          ) : null}

          {/* permission zone OR resolved note */}
          {resolved ? (
            <div className="pblock">
              <div className="locknote">
                <Ic>
                  {row.status === "approved" ? <Check /> : <Ban />}
                </Ic>
                {c.corrPanelResolvedNote(
                  pill.label,
                  row.reviewerName ?? c.corrReviewerUnknown,
                  row.submittedLabel,
                )}
              </div>
            </div>
          ) : (
            <div className="pblock">
              <div className="permzone">
                <div className="permzone__h">
                  <span className="permzone__ic">
                    <Ic>
                      <Shield />
                    </Ic>
                  </span>
                  <div>
                    <div className="permzone__t">{c.corrPanelPermTitle}</div>
                    <div className="permzone__s">{c.corrPanelPermSub}</div>
                  </div>
                  <span className="permzone__role">
                    <Ic>
                      <Shield />
                    </Ic>
                    {c.panelPermRole}
                  </span>
                </div>
                {row.status === "requested" ? (
                  <div className="permbtns">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ flex: 1 }}
                      onClick={doClaim}
                      disabled={pending}
                    >
                      <Ic>
                        <Pencil />
                      </Ic>
                      {pending ? c.corrActionClaiming : c.corrPanelBtnClaim}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
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
          {resolved ? (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ flex: 1 }}
                disabled
                title={c.corrPendingNote}
              >
                <Ic>
                  <Clock />
                </Ic>
                {c.corrPanelBtnHistory}
              </button>
              <button
                type="button"
                className="btn btn--subtle"
                style={{ flex: 1 }}
                disabled
                title={c.corrPendingNote}
              >
                {c.corrPanelBtnReopen}
              </button>
            </>
          ) : (
            <>
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
                {pending ? c.corrActionRejecting : c.corrPanelBtnReject}
              </button>
              <button
                type="button"
                className="btn btn--ok"
                style={{ flex: 1.4 }}
                onClick={() => setModal("approve")}
                disabled={pending}
              >
                <Ic>
                  <Check />
                </Ic>
                {pending ? c.corrActionApproving : c.corrPanelBtnApprove}
              </button>
            </>
          )}
        </div>
      </aside>

      {modal === "approve" ? (
        <AdminReasonModal
          title={c.corrPanelBtnApprove}
          description={c.corrPromptApproveComment}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={pending ? c.corrActionApproving : c.corrPanelBtnApprove}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          onConfirm={submitApprove}
          onCancel={() => setModal(null)}
        />
      ) : null}
      {modal === "reject" ? (
        <AdminReasonModal
          title={c.corrPanelBtnReject}
          description={c.corrPromptRejectReason}
          placeholder={c.dialogReasonPlaceholder}
          confirmLabel={pending ? c.corrActionRejecting : c.corrPanelBtnReject}
          cancelLabel={c.dialogCancel}
          pending={pending}
          errorText={err}
          danger
          onConfirm={submitReject}
          onCancel={() => setModal(null)}
        />
      ) : null}

      <ImageLightbox
        urls={photos}
        openIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        closeLabel={c.panelClose}
      />
    </>
  );
}
