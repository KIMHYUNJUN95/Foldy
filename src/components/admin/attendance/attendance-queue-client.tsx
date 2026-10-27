"use client";

import { LiveWash } from "@/components/shared/live-wash";
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
  updateAttendanceSessionAdmin,
  type ClosedCorrections,
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

/** 수동 정정 · 수기 입력 뒤 토스트 — 같이 닫힌 정정 요청 수를 덧붙인다. */
function withClosedCorrections(c: Att, base: string, closed?: ClosedCorrections): string {
  const parts = [base];
  if (closed?.approved) parts.push(c.corrClosedApproved.replace("{n}", String(closed.approved)));
  if (closed?.rejected) parts.push(c.corrClosedRejected.replace("{n}", String(closed.rejected)));
  return parts.join(" ");
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
    item.reviewState === "review_required" &&
    item.status !== "invalid" &&
    (item.isAbnormal || !item.clockOutLabel)
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

/** 접힌 전체 세션 묶음 헤더에 쓰는, 직원 묶음별 상태 요약. */
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

/** 대기열 표의 세션 한 줄 (평면 목록과 직원별 묶음 목록이 함께 쓴다). */
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
  return item.reviewState === "review_required" && item.status !== "invalid" && !isPending(item);
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
  // router.refresh() 로 서버가 새 목록을 내려주면 그걸로 맞춘다 — 정정 승인 · 직접 수정 뒤 세션 목록이
  // 옛 값(시각 · updated_at)으로 남지 않게(2026-10-26). 렌더 중 조정 패턴(effect 없이).
  const [syncedItems, setSyncedItems] = useState(initialItems);
  const [syncedCorrections, setSyncedCorrections] = useState(initialCorrections);
  if (initialItems !== syncedItems) {
    setSyncedItems(initialItems);
    setItems(initialItems);
  }
  if (initialCorrections !== syncedCorrections) {
    setSyncedCorrections(initialCorrections);
    setCorrections(initialCorrections);
  }
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [siteFilter, setSiteFilter] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<IssueKind | null>(null);
  const [nameQuery, setNameQuery] = useState(initialSearch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<PanelRoute>(() => {
    // 명시적인 세션 딥링크가 우선한다.
    if (initialSessionId) return { kind: "sess", id: initialSessionId };
    // 급여 막힘 카드 딥링크(?filter=&q=<이름>): 도착 시 해당 직원의 첫 일치 세션 /
    // 정정 패널을 열어 그 직원의 사이드 패널이 바로 나타나게 한다.
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

  // 토스트가 뜬 뒤 약 1.8초 후 자동으로 닫는다 (클릭 불필요).
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

  // "전체 세션" 탭에서는 평면 목록을 직원별 묶음(펼치기 가능)으로 접어 한
  // "전체 세션" 탭에서는 평면 목록을 직원별 묶음(펼치기 가능)으로 접어 한
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

  // 헤더의 "전체 선택"이 적용되는 행: 묶음 모드에서는 펼쳐진 묶음 안의 세션만
  // (접힌 묶음의 세션은 보이지 않아 선택되면 놀랄 수 있음), 평면 모드에서는 전체.
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
    // 무효 처리 → 무효가 아닌 선택된 모든 세션; 검토 완료 → 검토 필요로
    // 표시된 세션만 (이미 정상인 것은 검토할 게 없고, 무효는 단건 복원이 필요).
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
                expectedUpdatedAt: i.updatedAt,
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
      router.refresh();
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
      {/* 필터 툴바 */}
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

      {/* 일괄 액션 바 */}
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

      {/* 표 또는 정정 목록 */}
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
            <LiveWash move sig={filteredCorrections.map((r) => r.id).join(",")}>
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
                      data-live={r.id}
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
            </LiveWash>
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

      {/* 우측 상세 패널 — 세션 또는 정정 */}
      {panelSession ? (
        <SessionPanel
          item={panelSession}
          c={c}
          onClose={() => setPanel(null)}
          onInvalidated={(id) => {
            removeOrUpdateAfterInvalidate(id);
            showToast(c.actionDoneInvalidate);
            router.refresh();
          }}
          onApproved={(updated) => {
            applyUpdated(updated);
            showToast(c.actionDoneApprove);
            router.refresh();
          }}
          onRestored={(updated) => {
            applyUpdated(updated);
            showToast(c.actionDoneRestore);
            router.refresh();
          }}
          onEdited={(updated, closed) => {
            applyUpdated(updated);
            showToast(withClosedCorrections(c, c.actionDoneEdit, closed));
            router.refresh();
          }}
          onStale={() => router.refresh()}
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
            // 승인은 세션 시각을 바꾼다 — 세션 목록도 서버에서 다시 받는다(2026-10-26).
            router.refresh();
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
  onStale,
}: {
  item: ReviewQueueItem;
  c: Att;
  onClose: () => void;
  /** 그 사이 다른 사람이 세션을 바꿨을 때(`stale`) — 부모가 서버에서 목록을 다시 받는다. */
  onStale: () => void;
  onInvalidated: (sessionId: string) => void;
  onApproved: (updated: ReviewQueueItem) => void;
  onRestored: (updated: ReviewQueueItem) => void;
  onEdited: (updated: ReviewQueueItem, closed?: ClosedCorrections) => void;
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
  const correctionPending = item.correctionStatus === "requested" || item.correctionStatus === "in_review";
  // 무효 세션을 복원하면 완전한 세션이 되어야 한다 — 출퇴근 한쪽이 아직 비어 있으면
  // 관리자가 먼저 수동 정정으로 채워야 하므로, 그때까지 "복구 및 완료 처리" 는 막힌다.
  const restoreBlocked = isInvalid && (!item.clockInLabel || !item.clockOutLabel);
  // "검토 완료 처리" 는 review_required 로 표시된 세션(또는 복원할 무효 세션)에만 의미가 있다.
  // 이미 정상인 세션은 검토할 게 없으므로 버튼 자체를 숨긴다(아래 panel__foot, 2026-10-27).

  const auditKey = `${item.sessionId}:${auditReloadKey}`;
  // 파생 로딩: 현재 키의 비동기 로드가 끝나기 전까지 null (effect 안에서 동기 setState 금지).
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
      expectedUpdatedAt?: string;
    } = { sessionId: item.sessionId, reason: editReason.trim(), expectedUpdatedAt: item.updatedAt };

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
          updatedAt: res.updatedAt ?? item.updatedAt,
          clockInLabel: nextIn,
          clockOutLabel: nextOut,
          // 무효 세션은 수동 수정 후에도 무효로 남는다 (서버가 무효로 유지함). 관리자가
          // "복구 및 완료 처리" 를 실행해야 한다 — 이제 양쪽이 모두 채워져 막힘이 풀린다.
          status:
            item.status === "invalid" ? item.status : nextIn && nextOut ? "completed" : item.status,
          // 대기 중이던 정정 요청은 서버가 같이 닫았다(승인 · 반려).
          ...(res.correctionsClosed && res.correctionsClosed.approved + res.correctionsClosed.rejected > 0
            ? { correctionStatus: res.correctionsClosed.approved > 0 ? "approved" : "rejected" }
            : {}),
        }, res.correctionsClosed);
        setAuditReloadKey((k) => k + 1);
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "reason_required") {
        setErr(c.actionReasonRequired);
      } else if (res.reason === "invalid") {
        setErr(c.actionInvalidTime);
      } else if (res.reason === "overlap") {
        setErr(c.actionOverlap);
      } else if (res.reason === "stale") {
        setErr(c.actionStale);
        onStale();
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
        } else if (res.reason === "overlap") {
          setErr(c.actionOverlap);
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
        expectedUpdatedAt: item.updatedAt,
      });
      if (res.ok) {
        setModal(null);
        onApproved({ ...item, reviewState: "normal", isAbnormal: false, updatedAt: res.updatedAt ?? item.updatedAt });
        onClose();
      } else if (res.reason === "forbidden") {
        setErr(c.actionForbidden);
      } else if (res.reason === "reason_required") {
        setErr(c.actionReasonRequired);
      } else if (res.reason === "stale") {
        setErr(c.actionStale);
        onStale();
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
                {correctionPending ? <p className="wedit__note">{c.panelEditCorrNote}</p> : null}
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

        {/* 할 일이 없는(이미 정상인) 세션엔 완료 버튼을 숨긴다 — 막힌 버튼은 헷갈린다(2026-10-27). */}
        {isInvalid || needsReview ? (
          <div className="panel__foot">
            <button
              type="button"
              className="btn btn--ok"
              style={{ flex: 1 }}
              onClick={() => {
                setEditOpen(false);
                setModal("approve");
              }}
              disabled={pending || restoreBlocked}
              title={restoreBlocked && !pending ? c.restoreNeedsCompleteNote : undefined}
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
                  : c.panelBtnApprove}
            </button>
          </div>
        ) : null}
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
  /** 그 사이 바뀐 걸 알았을 때 — 부모가 서버에서 목록을 다시 받는다. */
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"approve" | "reject" | null>(null);
  // 요청자가 첨부한 증빙 사진 — 교통비 패널이 쓰는 것과 같은 라이트박스 캐러셀.
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
      } else if (res.reason === "overlap") {
        setErr(c.actionOverlap);
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
          {/* 변경 내용 */}
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

          {/* 사유 */}
          <div className="pblock">
            <div className="pblock__t">{c.corrPanelReasonSection}</div>
            <div className="reason">
              <div className="reason__q">{c.corrPanelReasonHeader}</div>
              {row.memo ?? c.corrPanelReasonEmpty}
            </div>
          </div>

          {/* 증빙 사진 — 검토자는 사진을 보지 않고 승인/반려하면 안 된다 */}
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

          {/* 연결된 세션 */}
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

          {/* 권한 구역 또는 처리 완료 메모 */}
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

        {/* 처리 끝난 요청엔 누를 버튼이 없다 — 막힌 「처리 이력 · 재오픈」은 지웠다(2026-10-27). */}
        {!resolved ? (
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
          </div>
        ) : null}
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
