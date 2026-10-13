"use client";

// Admin 수리·점검 console — content area for /admin/maintenance (AdminShell owns the sidebar/topbar).
// Three views: 현황 보드 / 목록·이력 / 완료. READ-CENTRIC — 배정·칸반 드래그·채팅이 없고, 처리(확인·
// 상태 변경·처리 메모·완료 사진)는 현장이 모바일에서 한다. 관리자는 열람 + 예외 개입만.
//
// Data is REAL (src/lib/admin-maintenance.ts) as of 2026-07-14 — 예외 개입(강제 완료 / 무효 처리 /
// 삭제)도 실제 서버 액션이다. See docs/product/08-maintenance-workflow.md.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, TriangleAlert } from "lucide-react";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { AdminMaintenanceReport } from "@/lib/admin-maintenance";
import { applyMaintenanceException, deleteMaintenanceReportById } from "@/app/admin/maintenance/actions";
import "./maintenance-console.css";
import { defaultRangeTokyo, isActive } from "./maintenance-console-data";
import { MaintenanceBoard } from "./maintenance-board";
import { MaintenanceList, type MaintFilters } from "./maintenance-list";
import { MaintenanceDetailPanel, type MaintExceptionKind } from "./maintenance-detail-panel";
import { MaintenanceConfirmModal } from "./maintenance-confirm-modal";

type MaintenanceConsoleProps = {
  locale: Locale;
  reports: AdminMaintenanceReport[];
  loadError: boolean;
};

type MaintView = "board" | "list" | "done";

export function MaintenanceConsole({ locale, reports, loadError }: MaintenanceConsoleProps) {
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const t = dictionary.maintenance.console;
  const { toast, showToast, dismiss } = useAdminToast();

  const [view, setView] = useState<MaintView>("board");
  const [filters, setFilters] = useState<MaintFilters>(() => {
    const range = defaultRangeTokyo();
    return {
      status: "all",
      priority: "all",
      category: "all",
      building: "all",
      reporter: "all",
      from: range.from,
      to: range.to,
      query: "",
    };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: MaintExceptionKind; id: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const kpi = useMemo(
    () => ({
      open: reports.filter((r) => r.status === "open").length,
      progress: reports.filter((r) => r.status === "in_progress").length,
      urgent: reports.filter((r) => r.priority === "urgent" && isActive(r)).length,
      aging: reports.filter((r) => r.aging).length,
      resolved: reports.filter((r) => r.status === "closed").length,
    }),
    [reports],
  );

  const selected = selectedId ? (reports.find((r) => r.id === selectedId) ?? null) : null;
  const confirmReport = confirm ? (reports.find((r) => r.id === confirm.id) ?? null) : null;

  function handleFilterChange<K extends keyof MaintFilters>(key: K, value: MaintFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearFilters() {
    setFilters((prev) => ({
      ...prev,
      status: "all",
      priority: "all",
      category: "all",
      building: "all",
      reporter: "all",
      query: "",
    }));
  }

  function handleViewChange(next: MaintView) {
    if (next === view) return;
    setView(next);
    setFilters((prev) => ({ ...prev, query: "" }));
    setSelectedId(null);
  }

  /** 여기 `router.refresh()` 는 「새로고침」 버튼 그 자체다 — 아래 규칙의 예외로 남겨 둔다. */
  function handleSync() {
    router.refresh();
    showToast(t.tSynced);
  }

  /**
   * 액션 뒤에 `router.refresh()` 를 부르지 않는다 — `applyMaintenanceException` ·
   * `deleteMaintenanceReportById` 가 **서버에서 이미 `/admin/maintenance` 를 재검증**한다.
   * 서버 액션이 경로를 재검증하면 그 응답에 갱신된 RSC 페이로드가 함께 오므로, 추가 호출은
   * 같은 데이터를 한 번 더 받아오는 두 번째 왕복이 될 뿐이다 (2026-08-11 제거).
   *
   * 새 액션을 붙일 때는 그 액션이 재검증하는지 먼저 확인한다. 안 한다면 여기서 새로고침하는
   * 대신 **액션 쪽에 재검증을 추가하는 것이 맞다.**
   */
  function handleConfirmException(kind: MaintExceptionKind, id: string, memo: string) {
    startTransition(async () => {
      if (kind === "del") {
        const result = await deleteMaintenanceReportById(id);
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        setSelectedId(null);
        showToast(t.tDel);
        return;
      }

      const result = await applyMaintenanceException({ kind, memo, reportId: id });
      if (!result.ok) {
        showToast(t.errS);
        return;
      }
      setConfirm(null);
      showToast(kind === "force" ? t.tForce : t.tVoid);
    });
  }

  const V = (value: number) => (loadError ? "–" : value);

  return (
    <>
      {/* 화이트 리디자인(2026-10-13, 시안 Maint-PC · MaintList-PC · MaintDone-PC): 보기 탭(아이콘 없음) · 실시간 한 줄이 맨 위,
          그 아래 숫자 다섯(현황 보드에서만) · 「읽기 전용 · 정렬」 한 줄. */}
      <div className="cviewbar mw-viewbar">
        <div className="lviews" style={{ margin: 0 }}>
          <button type="button" className={view === "board" ? "on" : ""} onClick={() => handleViewChange("board")}>
            {t.vBoard}
          </button>
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => handleViewChange("list")}>
            {t.vList}
          </button>
          <button type="button" className={view === "done" ? "on" : ""} onClick={() => handleViewChange("done")}>
            {t.vDone}
          </button>
        </div>
        {view === "board" ? (
          <button type="button" className="mw-live" onClick={handleSync}>
            <i aria-hidden="true" />
            {t.syncLabel} · {t.syncAgo}
          </button>
        ) : null}
      </div>

      {view === "board" ? (
        <>
          <div className="wkpis mw-kpis">
            <div className="wkpi">
              <span className="wkpi__k">{t.kpiOpen}</span>
              <span className="wkpi__v">
                {V(kpi.open)}
                <small>{t.unit}</small>
              </span>
              <span className="wkpi__d">{t.kpiOpenSub}</span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{t.kpiProg}</span>
              <span className="wkpi__v">
                {V(kpi.progress)}
                <small>{t.unit}</small>
              </span>
              <span className="wkpi__d">{t.kpiProgSub}</span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{t.kpiUrgent}</span>
              <span className={`wkpi__v${!loadError && kpi.urgent > 0 ? " is-danger" : ""}`}>
                {V(kpi.urgent)}
                <small>{t.unit}</small>
              </span>
              <span className="wkpi__d">{t.kpiUrgentSub}</span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{t.kpiOld}</span>
              <span className={`wkpi__v${!loadError && kpi.aging > 0 ? " is-warn" : ""}`}>
                {V(kpi.aging)}
                <small>{t.unit}</small>
              </span>
              <span className="wkpi__d">{t.oldSub}</span>
            </div>
            <div className="wkpi">
              <span className="wkpi__k">{t.kpiResolved}</span>
              <span className="wkpi__v">
                {V(kpi.resolved)}
                <small>{t.unit}</small>
              </span>
              <span className="wkpi__d">{t.within}</span>
            </div>
          </div>
          <p className="mw-note">
            <span className="ic">
              <Eye />
            </span>
            {t.readonly}. {t.sortNote}
          </p>
        </>
      ) : null}

      <div className="cbody">
        {view === "board" ? (
          loadError ? (
            <div className="card">
              <div className="state">
                <div className="state__ic err">
                  <TriangleAlert aria-hidden="true" />
                </div>
                <div className="state__t">{t.errT}</div>
                <div className="state__s">{t.errS}</div>
                <button type="button" className="btn btn--pri btn--sm" style={{ marginTop: 16 }} onClick={handleSync}>
                  {t.retry}
                </button>
              </div>
            </div>
          ) : (
            <MaintenanceBoard
              reports={reports}
              t={t}
              locale={locale}
              query={filters.query}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onClearQuery={() => handleFilterChange("query", "")}
            />
          )
        ) : (
          <MaintenanceList
            scope={view}
            reports={reports}
            allReports={reports}
            t={t}
            sharedLabels={dictionary.admin.shared}
            locale={locale}
            filters={filters}
            onFilterChange={handleFilterChange}
            onRangeChange={(from, to) => setFilters((prev) => ({ ...prev, from, to }))}
            onClearFilters={handleClearFilters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loadError={loadError}
            onRetry={handleSync}
          />
        )}
      </div>

      <MaintenanceDetailPanel
        report={selected}
        t={t}
        locale={locale}
        onClose={() => setSelectedId(null)}
        onException={(kind, id) => setConfirm({ kind, id })}
        onOpenLink={() => showToast(t.tLink)}
        disabled={confirm !== null}
      />

      {confirm && confirmReport ? (
        <MaintenanceConfirmModal
          kind={confirm.kind}
          report={confirmReport}
          t={t}
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirmException}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
