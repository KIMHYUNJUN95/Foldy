"use client";

// Admin cleaning console — content area for /admin/cleaning (AdminShell owns the sidebar/topbar).
// Two segmented views: 오늘 현황 (live room-status board) and 기록 (filterable history table), plus
// a shared right-side detail panel and the force-complete modal. Data is real (cleaning_sessions +
// reservations, via src/lib/admin-cleaning.ts) as of 2026-07-14 — see docs/product/07-cleaning-workflow.md
// → "2026-07-14 어드민 청소 대시보드 — 백엔드 연동". Mirrors clean-views.js shell()/opsbar()/viewtabs()
// from the original design handoff.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import type { AdminCleaningHistoryItem, AdminCleaningTask, AdminSettingTarget } from "@/lib/admin-cleaning";
import type { CleaningStaffOption } from "@/lib/cleaning";
import { fetchAdminCleaningHistory, forceCompleteCleaningSession } from "@/app/admin/cleaning/actions";
import "./cleaning-console.css";
import { BUILDING_ORDER, nowLabelTokyo, type BuildingKey, type CleaningTaskType } from "./cleaning-console-data";
import { buildConsoleCopy, buildStaffDirectory } from "./cleaning-console-shared";
import type { HistoryCompletionFilter, HistorySessionStatusFilter } from "./cleaning-history-board";
import { TodayBoard } from "./cleaning-today-board";
import { HistoryBoard } from "./cleaning-history-board";
import { CleaningDetailPanel } from "./cleaning-detail-panel";
import { CleaningForceCompleteModal, type ForceCompleteResult } from "./cleaning-force-complete-modal";
import { useRoomPlaceLabel } from "@/components/shared/building-names";

type CleaningConsoleProps = {
  locale: Locale;
  /** 보고 있는 운영일(YYYY-MM-DD). 오늘이 아닐 수 있다 — 과거·미래 조회(2026-08-04). */
  viewDate: string;
  /** 서버가 계산한 "오늘" 운영일. 클라이언트에서 Date 로 다시 구하면 시차·렌더 순수성 문제가 생긴다. */
  operatingToday: string;
  tasks: AdminCleaningTask[];
  setupTargets: AdminSettingTarget[];
  staff: CleaningStaffOption[];
  loadError: boolean;
  initialHistory: AdminCleaningHistoryItem[];
  initialHistoryFrom: string;
  initialHistoryTo: string;
  /**
   * 강제완료(관리자 대리 완료) 권한. 서버(canForceCompleteCleaning)에서 결정해 내려준다 —
   * UI 게이트일 뿐이며 서버 액션의 권한 검사를 대체하지 않는다.
   */
  canForceComplete: boolean;
};

function syncAgoText(lastSyncAt: number, t: Dictionary["cleaning"]["console"], locale: Locale): string {
  const mins = Math.round((Date.now() - lastSyncAt) / 60000);
  if (mins < 1) return t.syncAgo;
  return new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" }).format(-mins, "minute");
}

// Kept as a module-level helper (not inline in the component) so the impure `Date.now()` call sits
// outside the render-scope purity check; only invoked from event handlers below.
function nowTimestamp(): number {
  return Date.now();
}

export function CleaningConsole({
  locale,
  viewDate,
  operatingToday,
  tasks,
  setupTargets,
  staff,
  loadError,
  initialHistory,
  initialHistoryFrom,
  initialHistoryTo,
  canForceComplete,
}: CleaningConsoleProps) {
  const bRoom = useRoomPlaceLabel();
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const t = useMemo(() => buildConsoleCopy(dictionary), [dictionary]);
  const buildingLabels = dictionary.cleaning.buildingLabels;
  const shared = dictionary.admin.shared;
  const { toast, showToast, dismiss } = useAdminToast();

  const staffDirectory = useMemo(() => buildStaffDirectory(staff), [staff]);

  // 보고 있는 날짜의 성격. 과거·미래는 한계가 서로 달라 안내와 동작이 갈린다(2026-08-04).
  const isToday = viewDate === operatingToday;
  const isPast = viewDate < operatingToday;
  const isFuture = viewDate > operatingToday;

  const [view, setView] = useState<"today" | "history">("today");
  const [group, setGroup] = useState<"building" | "status">("building");
  const [propFilter, setPropFilter] = useState<BuildingKey | "all">("all");
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<CleaningTaskType | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSetupKey, setSelectedSetupKey] = useState<string | null>(null);
  const [modalTask, setModalTask] = useState<AdminCleaningTask | null>(null);

  const [history, setHistory] = useState<AdminCleaningHistoryItem[]>(initialHistory);
  const [historyFrom, setHistoryFrom] = useState(initialHistoryFrom);
  const [historyTo, setHistoryTo] = useState(initialHistoryTo);
  // 기록 탭에는 두 개의 서로 다른 축이 있다: 세션 상태(진행중/완료/취소)와 완료 유형(정상/대리).
  // 예전에는 후자 하나만 있으면서 이름이 "상태"라 모바일의 "상태"와 뜻이 어긋났다.
  const [historySessionStatus, setHistorySessionStatus] = useState<HistorySessionStatusFilter>("all");
  const [historyCompletion, setHistoryCompletion] = useState<HistoryCompletionFilter>("all");
  const [isHistoryPending, startHistoryFetch] = useTransition();
  // 기간을 빨리 바꿔 요청이 겹치면 늦게 온 옛 응답이 새 기간 위에 덮이지 않게 — 마지막 요청만 반영한다.
  const historyRequestSeq = useRef(0);
  const [isForcePending, startForceComplete] = useTransition();

  const [lastSyncAt, setLastSyncAt] = useState(() => Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (view !== "today") return;
    const id = setInterval(() => {
      router.refresh();
      setLastSyncAt(nowTimestamp());
    }, 60000);
    return () => clearInterval(id);
  }, [view, router]);

  // 취소 카드(예약 대상이 없는 임의 청소가 취소된 건)는 청소 "대상"이 아니므로 KPI 분모에서 뺀다.
  // 카드 자체는 오늘 현황 보드에 계속 보인다.
  const countableTasks = tasks.filter((task) => task.status !== "cancelled");
  const pendingCount = countableTasks.filter((task) => task.status === "pending").length;
  const progressCount = countableTasks.filter((task) => task.status === "progress").length;
  const doneCount = countableTasks.filter((task) => task.status === "done").length;
  const rate = countableTasks.length ? Math.round((doneCount / countableTasks.length) * 100) : 0;
  const setupCount = setupTargets.length;

  const selectedTask = view === "today" && selectedId ? (tasks.find((task) => task.id === selectedId) ?? null) : null;
  const selectedHistory = view === "history" && selectedId ? (history.find((h) => h.id === selectedId) ?? null) : null;
  const selectedSetupTarget =
    view === "today" && selectedSetupKey ? (setupTargets.find((target) => target.roomKey === selectedSetupKey) ?? null) : null;

  function handleSelect(id: string) {
    setSelectedSetupKey(null);
    setSelectedId(id);
  }

  function handleSelectSetupTarget(roomKey: string) {
    setSelectedId(null);
    setSelectedSetupKey(roomKey);
  }

  function handleCloseDetail() {
    setSelectedId(null);
    setSelectedSetupKey(null);
  }

  function handleClearFilters() {
    setPropFilter("all");
    setStaffFilter("all");
    setTypeFilter("all");
    setHistorySessionStatus("all");
    setHistoryCompletion("all");
    setQuery("");
  }

  function handleViewChange(next: "today" | "history") {
    if (next === view) return;
    setView(next);
    setQuery("");
    setSelectedId(null);
    setSelectedSetupKey(null);
  }

  // Navigates to the linked lost-item/maintenance-report record. History rows never carry `reports`
  // (only today's session-backed tasks do — see admin-cleaning.ts), so this only fires for the today
  // board. Multiple linked records for one session are rare; falls back to the list screen for them.
  function handleOpenReport(kind: "lost" | "issue") {
    const reports = selectedTask?.reports ?? selectedHistory?.reports;
    const ids = kind === "lost" ? reports?.lostIds : reports?.issueIds;
    if (!ids || ids.length === 0) return;
    const base = kind === "lost" ? "/admin/lost-found" : "/admin/maintenance";
    router.push(ids.length === 1 ? `${base}/${ids[0]}` : base);
  }

  function handleHistoryRangeChange(from: string, to: string) {
    setHistoryFrom(from);
    setHistoryTo(to);
    reloadHistory(from, to);
  }

  function reloadHistory(from: string, to: string) {
    const seq = ++historyRequestSeq.current;
    startHistoryFetch(async () => {
      const res = await fetchAdminCleaningHistory(from, to);
      if (seq !== historyRequestSeq.current) return;
      if (res.ok) {
        setHistory(res.items);
      } else {
        showToast(t.errS);
      }
    });
  }

  function handleForceCompleteConfirm(result: ForceCompleteResult) {
    const roomLabel = bRoom(modalTask?.room ?? "");
    startForceComplete(async () => {
      const res = await forceCompleteCleaningSession({ ...result, cleaningDate: viewDate });
      if (res.ok) {
        showToast(`${t.tDone} · ${roomLabel}`);
        setModalTask(null);
        // 기록 탭이 낡은 채로 남지 않게 지금 보는 기간을 다시 읽는다.
        reloadHistory(historyFrom, historyTo);
      } else {
        showToast(t.tDoneFailed);
      }
    });
  }

  function handleSync() {
    router.refresh();
    setLastSyncAt(nowTimestamp());
    showToast(t.tSynced);
  }

  const staffOptions = [...staffDirectory.values()].sort((x, y) => x.name.localeCompare(y.name, "ko"));
  const kpis: Array<{ k: string; v: string | number; unit?: string; tone?: "danger" | "live" }> = [
    { k: t.kpiTarget, v: countableTasks.length, unit: dictionary.admin.console.unitRooms },
    { k: t.kpiPending, v: pendingCount, unit: dictionary.admin.console.unitRooms, tone: pendingCount > 0 && !isFuture ? "danger" : undefined },
    { k: t.kpiProgress, v: progressCount, unit: dictionary.admin.console.unitRooms, tone: progressCount > 0 ? "live" : undefined },
    { k: t.kpiDone, v: doneCount, unit: dictionary.admin.console.unitRooms },
    { k: t.kpiRate, v: rate, unit: "%" },
    { k: t.kpiSetup, v: setupCount, unit: dictionary.admin.console.unitRooms },
  ];

  return (
    <>
      {/* 화이트 리디자인(2026-10-13): 보기 탭 · 날짜 · 실시간 줄이 맨 위, 오른쪽에 묶기 · 필터.
          숫자 줄은 오늘 현황에만 — 기록에는 기록 전용 숫자 줄이 따로 있다. */}
      <div className="cl-bar">
        <div className="cl-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === "today"} className={view === "today" ? "on" : ""} onClick={() => handleViewChange("today")}>
            {t.vToday}
          </button>
          <button type="button" role="tab" aria-selected={view === "history"} className={view === "history" ? "on" : ""} onClick={() => handleViewChange("history")}>
            {t.vHistory}
          </button>
        </div>
        {view === "today" ? (
          <>
            {/* 날짜 이동 — 공용 `AdminDatePicker` 의 nav 변형(CLAUDE.md §4a: 콘솔 달력은 공용
                프리미티브만). 청소 대상은 예약에서 파생되므로 미래도 계산된다 → allowFuture. */}
            <AdminDatePicker
              date={viewDate}
              todayDate={operatingToday}
              localeTag={locale}
              basePath="/admin/cleaning"
              allowFuture
              labels={{
                prevDay: shared.datePrevDay,
                nextDay: shared.dateNextDay,
                prevMonth: shared.datePrevMonth,
                nextMonth: shared.dateNextMonth,
                open: shared.dateSelect,
                today: shared.dateToday,
                todayTag: shared.dateTodayTag,
                pastTag: isFuture ? t.dateFutureTag : shared.datePastTag,
              }}
            />
            <button type="button" className="cl-sync" onClick={handleSync}>
              <i aria-hidden="true" />
              {t.syncLabel} · {syncAgoText(lastSyncAt, t, locale)}
            </button>
            <span className="cl-bar__sp" />
            <div className="cl-group" role="group">
              <button type="button" className={group === "building" ? "on" : ""} onClick={() => setGroup("building")}>
                {t.byBuilding}
              </button>
              <button type="button" className={group === "status" ? "on" : ""} onClick={() => setGroup("status")}>
                {t.byStatus}
              </button>
            </div>
            <AdmDropdown
              size="sm"
              value={propFilter}
              onChange={(v) => setPropFilter(v as BuildingKey | "all")}
              ariaLabel={t.building}
              options={[{ value: "all", label: t.allProp }, ...BUILDING_ORDER.map((b) => ({ value: b, label: buildingLabels[b] ?? b }))]}
            />
            <AdmDropdown
              size="sm"
              value={staffFilter}
              onChange={setStaffFilter}
              ariaLabel={t.staff}
              options={[{ value: "all", label: t.allStaff }, ...staffOptions.map((s) => ({ value: s.id, label: s.name }))]}
            />
            <AdmDropdown
              size="sm"
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as CleaningTaskType | "all")}
              ariaLabel={t.type}
              options={[
                { value: "all", label: t.allCleanType },
                { value: "checkout", label: t.tyCheckout },
                { value: "simple", label: t.tySimple },
                { value: "longstay", label: t.tyLongstay },
              ]}
            />
          </>
        ) : null}
      </div>

      {view === "today" ? (
        <div className="cl-kpis">
          {kpis.map((kpi) => (
            <div className="cl-kpi" key={kpi.k}>
              <span className="cl-kpi__k">{kpi.k}</span>
              <span className={`cl-kpi__v${kpi.tone ? ` is-${kpi.tone}` : ""}`}>
                {loadError ? "-" : kpi.v}
                {!loadError && kpi.unit ? <small>{kpi.unit}</small> : null}
              </span>
              {loadError ? <span className="cl-kpi__d">{t.errT}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* 오늘이 아닌 날짜의 한계를 명시한다. 과거는 재계산이라 그날 화면과 다를 수 있고, 미래는
          예약이 덜 차서 실제보다 적게 보인다 — 둘 다 말해 주지 않으면 숫자를 오해한다. */}
      {view === "today" && !isToday ? (
        <div className="cdatenote">
          <span className="ic">
            <Info />
          </span>
          {isPast ? t.datePastNotice : t.dateFutureNotice}
        </div>
      ) : null}

      <div className="cbody">
        {view === "today" ? (
          <TodayBoard
            tasks={tasks}
            setupTargets={setupTargets}
            staffDirectory={staffDirectory}
            t={t}
            buildingLabels={buildingLabels}
            group={group}
            propFilter={propFilter}
            staffFilter={staffFilter}
            typeFilter={typeFilter}
            query={query}
            selectedId={selectedId}
            onSelect={handleSelect}
            selectedSetupKey={selectedSetupKey}
            onSelectSetupTarget={handleSelectSetupTarget}
            onClearFilters={handleClearFilters}
          />
        ) : (
          <HistoryBoard
            history={history}
            t={t}
            sharedLabels={dictionary.admin.shared}
            buildingLabels={buildingLabels}
            staffDirectory={staffDirectory}
            locale={locale}
            propFilter={propFilter}
            onPropFilterChange={setPropFilter}
            staffFilter={staffFilter}
            onStaffFilterChange={setStaffFilter}
            sessionStatusFilter={historySessionStatus}
            onSessionStatusFilterChange={setHistorySessionStatus}
            completionFilter={historyCompletion}
            onCompletionFilterChange={setHistoryCompletion}
            query={query}
            onQueryChange={setQuery}
            from={historyFrom}
            to={historyTo}
            onRangeChange={handleHistoryRangeChange}
            rangeLoading={isHistoryPending}
            selectedId={selectedId}
            onSelect={handleSelect}
            onToast={showToast}
            onClearFilters={handleClearFilters}
          />
        )}
      </div>

      <CleaningDetailPanel
        task={selectedTask}
        history={selectedHistory}
        setupTarget={selectedSetupTarget}
        t={t}
        buildingLabels={buildingLabels}
        staffDirectory={staffDirectory}
        locale={locale}
        onClose={handleCloseDetail}
        onOpenForceComplete={setModalTask}
        onOpenReport={handleOpenReport}
        // 미래 날짜에는 대리 완료를 노출하지 않는다 — 아직 일어나지 않은 청소를 완료로 만들 수
        // 있으면 안 된다. 서버가 최종 방어선이고 이건 UI 게이트다(2026-08-04).
        canForceComplete={canForceComplete && !isFuture}
        disabled={modalTask !== null}
      />

      {modalTask && canForceComplete ? (
        <CleaningForceCompleteModal
          task={modalTask}
          nowLabel={nowLabelTokyo()}
          t={t}
          buildingLabels={buildingLabels}
          staffDirectory={staffDirectory}
          pending={isForcePending}
          onCancel={() => setModalTask(null)}
          onConfirm={handleForceCompleteConfirm}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
