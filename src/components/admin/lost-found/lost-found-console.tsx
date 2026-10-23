"use client";

// Admin 분실물 console — content area for /admin/lost-found (AdminShell owns the sidebar/topbar).
// Four views: 보관 중 / 반환 / 폐기 내역 / 전체 기록 (화이트 리디자인 2026-10-14, 시안 LF-PC · LFReturn-PC · LFDisposed-PC · LFAll-PC). Unlike 수리·점검 (read-centric), this console is
// where admins actively process items — 반환 / 폐기 / 보관 연장 — plus 예외 개입(상태 정정 / 삭제).
// Mirrors maintenance-console.tsx wiring 1:1. See docs/product/09-lost-found-workflow.md.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, TriangleAlert, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { AdminLostItemVM } from "@/lib/admin-lost-found";
import type { LostReturnMethod } from "@/lib/lost-found-constants";
import {
  correctLostItemStatus,
  deleteLostItemById,
  disposeLostItem,
  extendLostItemStorage,
  restoreLostItem,
  returnLostItem,
} from "@/app/admin/lost-found/actions";
import "@/components/admin/maintenance/maintenance-console.css";
import "./lost-found-console.css";
import {
  CATEGORY_ORDER,
  buildingOptionsOf,
  defaultRangeTokyo,
  reporterOptionsOf,
  type LFFilters,
} from "./lost-found-console-data";
import { categoryLabel, localeTagOf, statusLabel } from "./lost-found-console-shared";
import { lostItemStatuses } from "@/lib/lost-found-constants";
import { LostFoundBoard } from "./lost-found-board";
import { LostFoundList } from "./lost-found-list";
import { LostFoundDone } from "./lost-found-done";
import { LostFoundDisposal } from "./lost-found-disposal";
import { LostFoundDetailPanel, type LFActionKind } from "./lost-found-detail-panel";
import {
  LostFoundActionModal,
  type LFActionPayload,
} from "./lost-found-action-modal";

type LostFoundConsoleProps = {
  locale: Locale;
  items: AdminLostItemVM[];
  loadError: boolean;
};

type LFView = "board" | "list" | "done" | "disposal";

function isThisMonthTokyo(dateOrDateTime: string | null, monthKey: string): boolean {
  if (!dateOrDateTime) return false;
  return dateOrDateTime.slice(0, 7) === monthKey;
}

export function LostFoundConsole({ locale, items, loadError }: LostFoundConsoleProps) {
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const t = dictionary.lostFound.console;
  const { toast, showToast, dismiss } = useAdminToast();

  const [view, setView] = useState<LFView>("board");
  const [filters, setFilters] = useState<LFFilters>(() => {
    const range = defaultRangeTokyo();
    return { status: "all", category: "all", method: "all", building: "all", reporter: "all", from: range.from, to: range.to, query: "" };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: LFActionKind; id: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const thisMonth = useMemo(() => defaultRangeTokyo().from.slice(0, 7), []);

  const returnedMonth = useMemo(
    () => items.filter((i) => i.status === "returned" && isThisMonthTokyo(i.handledAt, thisMonth)),
    [items, thisMonth],
  );
  const disposedMonth = useMemo(
    () => items.filter((i) => i.status === "disposed" && isThisMonthTokyo(i.disposedDate, thisMonth)),
    [items, thisMonth],
  );
  const kpi = useMemo(
    () => ({
      active: items.filter((i) => i.status !== "returned" && i.status !== "disposed").length,
      soon: items.filter((i) => i.isDueSoon || i.isExpired).length,
      returnedMonth: returnedMonth.length,
      retDelivery: returnedMonth.filter((i) => i.returnMethod === "delivery").length,
      retPickup: returnedMonth.filter((i) => i.returnMethod === "pickup").length,
      disposedMonth: disposedMonth.length,
      dispAuto: disposedMonth.filter((i) => i.isAutoDisposed).length,
      log: items.filter((i) => i.status === "disposed").length,
      delSoon: items.filter((i) => i.status === "disposed" && i.isDeleteSoon).length,
    }),
    [items, returnedMonth, disposedMonth],
  );

  const selected = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;
  const confirmItem = confirm ? (items.find((i) => i.id === confirm.id) ?? null) : null;

  function handleFilterChange<K extends keyof LFFilters>(key: K, value: LFFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearFilters() {
    setFilters((prev) => ({ ...prev, status: "all", category: "all", method: "all", building: "all", reporter: "all", query: "" }));
  }

  function handleViewChange(next: LFView) {
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
   * 액션 뒤에 `router.refresh()` 를 부르지 않는다.
   *
   * 여기서 부르는 액션은 **전부 서버에서 `revalidateItem()`**(= `/admin/lost-found` +
   * `/mobile/requests/lost-found/{id}` 재검증)을 호출한다. 서버 액션이 경로를 재검증하면 그
   * 응답에 갱신된 RSC 페이로드가 함께 오므로 화면은 이미 새로 그려진다. 거기에
   * `router.refresh()` 를 더하면 **같은 데이터를 한 번 더 받아오는 두 번째 왕복**이 될 뿐이다
   * (2026-08-11 제거).
   *
   * 새 액션을 추가할 때는 그 액션이 `revalidateItem()` 을 호출하는지 확인한다. 호출하지 않는다면
   * `router.refresh()` 를 붙이는 대신 **액션 쪽에 재검증을 추가하는 것이 맞다** — 그래야 이 화면과
   * 모바일 상세가 함께 갱신된다.
   */
  function handleConfirmAction(kind: LFActionKind, id: string, payload: LFActionPayload) {
    startTransition(async () => {
      if (kind === "delete") {
        const result = await deleteLostItemById(id);
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        setSelectedId(null);
        showToast(t.tDel);
        return;
      }

      if (kind === "return") {
        const result = await returnLostItem({
          itemId: id,
          method: (payload.method ?? "pickup") as LostReturnMethod,
          tracking: payload.tracking ?? "",
          memo: payload.memo ?? "",
        });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        setSelectedId(null);
        showToast(t.tReturn);
        return;
      }

      if (kind === "dispose") {
        const result = await disposeLostItem({ itemId: id, memo: payload.memo ?? "" });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        setSelectedId(null);
        showToast(t.tDispose);
        return;
      }

      if (kind === "extend") {
        const result = await extendLostItemStorage({
          itemId: id,
          dueDate: payload.dueDate ?? "",
          reason: payload.memo ?? "",
        });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(t.tExtend);
        return;
      }

      if (kind === "restore") {
        const result = await restoreLostItem({ itemId: id, reason: payload.memo ?? "" });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        setSelectedId(null);
        showToast(t.tRestore);
        return;
      }

      // correct
      const result = await correctLostItemStatus({
        itemId: id,
        status: (payload.status ?? "registered") as "registered" | "stored" | "disposal_scheduled",
        memo: payload.memo ?? "",
      });
      if (!result.ok) {
        showToast(t.errS);
        return;
      }
      setConfirm(null);
      showToast(t.tCorrect);
    });
  }

  const V = (value: number) => (loadError ? "–" : value);
  const shared = dictionary.admin.shared;
  const buildings = buildingOptionsOf(items);
  const buildingDd = (
    <AdmDropdown
      size="sm"
      value={filters.building}
      onChange={(v) => handleFilterChange("building", v)}
      ariaLabel={t.colBuilding}
      options={[{ value: "all", label: t.allProp }, ...buildings.map((b) => ({ value: b, label: b }))]}
    />
  );
  const range = (
    <AdminDateRangePicker
      from={filters.from}
      to={filters.to}
      onChange={(from, to) => setFilters((prev) => ({ ...prev, from, to }))}
      localeTag={localeTagOf(locale)}
      ariaLabel={shared.pickRange}
      labels={{
        prevMonth: shared.datePrevMonth,
        nextMonth: shared.dateNextMonth,
        thisMonth: shared.dateThisMonth,
        reset: shared.dateReset,
        typeStart: shared.dateTypeStart,
        typeEnd: shared.dateTypeEnd,
        pickYear: shared.datePickYear,
        pickMonth: shared.datePickMonth,
        apply: shared.dateApply,
      }}
    />
  );
  const views: { key: LFView; label: string }[] = [
    { key: "board", label: t.vStored },
    { key: "done", label: t.vReturned },
    { key: "disposal", label: t.vDisposal },
    { key: "list", label: t.vAll },
  ];

  return (
    <>
      {/* 화이트 리디자인(2026-10-14, 시안 LF-PC 외): 보기 탭 넷(아이콘 없음) + 보기마다 고르기가 한 줄에. */}
      <div className="cviewbar mw-viewbar lfw-viewbar">
        <div className="lviews" style={{ margin: 0 }}>
          {views.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? "on" : ""} onClick={() => handleViewChange(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        {view === "board" ? (
          <button type="button" className="mw-live" onClick={handleSync}>
            <i aria-hidden="true" />
            {t.syncLabel} · {t.syncAgo}
          </button>
        ) : (
          range
        )}
        <span className="lfw-viewbar__sp" />
        {view === "list" ? (
          <div className="qsearch qsearch--inline">
            <span className="ic">
              <Search aria-hidden="true" />
            </span>
            <input
              placeholder={t.search}
              aria-label={t.search}
              value={filters.query}
              onChange={(e) => handleFilterChange("query", e.target.value)}
            />
            {filters.query ? (
              <button type="button" className="qsearch__clear" onClick={() => handleFilterChange("query", "")} aria-label={t.clearFilter}>
                <span className="ic">
                  <X aria-hidden="true" />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
        {view === "list" ? (
          <AdmDropdown
            size="sm"
            value={filters.status}
            onChange={(v) => handleFilterChange("status", v as LFFilters["status"])}
            ariaLabel={t.colStatus}
            options={[{ value: "all", label: t.allStatus }, ...lostItemStatuses.map((s) => ({ value: s, label: statusLabel(s, t) }))]}
          />
        ) : null}
        {view === "done" ? (
          <AdmDropdown
            size="sm"
            value={filters.method}
            onChange={(v) => handleFilterChange("method", v as LFFilters["method"])}
            ariaLabel={t.colMethod}
            options={[
              { value: "all", label: t.allMethod },
              { value: "delivery", label: t.methodDelivery },
              { value: "pickup", label: t.methodPickup },
            ]}
          />
        ) : null}
        {buildingDd}
        {view === "board" ? (
          <AdmDropdown
            size="sm"
            value={filters.category}
            onChange={(v) => handleFilterChange("category", v as LFFilters["category"])}
            ariaLabel={t.pCategory}
            options={[{ value: "all", label: t.allCategory }, ...CATEGORY_ORDER.map((c) => ({ value: c, label: categoryLabel(c, t) }))]}
          />
        ) : null}
        {view === "list" ? (
          <AdmDropdown
            size="sm"
            value={filters.reporter}
            onChange={(v) => handleFilterChange("reporter", v)}
            ariaLabel={t.colReporter}
            options={[{ value: "all", label: t.allReporter }, ...reporterOptionsOf(items).map((r) => ({ value: r.id, label: r.name }))]}
          />
        ) : null}
      </div>

      {view === "board" ? (
        <div className="wkpis lfw-kpis">
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiStored}</span>
            <span className="wkpi__v">
              {V(kpi.active)}
              <small>{t.countUnit}</small>
            </span>
            <span className="wkpi__d">{t.kpiActiveSub}</span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiSoon}</span>
            <span className={`wkpi__v${!loadError && kpi.soon > 0 ? " is-danger" : ""}`}>
              {V(kpi.soon)}
              <small>{t.countUnit}</small>
            </span>
            <span className="wkpi__d">{t.kpiSoonAuto}</span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiReturned}</span>
            <span className="wkpi__v">
              {V(kpi.returnedMonth)}
              <small>{t.countUnit}</small>
            </span>
            <span className="wkpi__d">
              {t.methodDelivery} {V(kpi.retDelivery)} · {t.methodPickup} {V(kpi.retPickup)}
            </span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiDisposed}</span>
            <span className="wkpi__v">
              {V(kpi.disposedMonth)}
              <small>{t.countUnit}</small>
            </span>
            <span className="wkpi__d">
              {t.modeAuto} {V(kpi.dispAuto)} · {t.modeManual} {V(kpi.disposedMonth - kpi.dispAuto)}
            </span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.vDisposal}</span>
            <span className="wkpi__v">
              {V(kpi.log)}
              <small>{t.countUnit}</small>
            </span>
            <span className="wkpi__d">
              {t.deleteSoon} {V(kpi.delSoon)} · {t.keep90}
            </span>
          </div>
        </div>
      ) : null}

      <div className="cbody lfw-body">
        {view === "board" ? (
          loadError ? (
            <div className="lfw-empty">
              <TriangleAlert aria-hidden="true" />
              <b>{t.errT}</b>
              <span>{t.errS}</span>
              <button type="button" className="btn btn--pri btn--sm" onClick={handleSync}>
                {t.retry}
              </button>
            </div>
          ) : (
            <LostFoundBoard
              items={items}
              t={t}
              locale={locale}
              filters={filters}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onClearFilters={handleClearFilters}
            />
          )
        ) : view === "list" ? (
          <LostFoundList
            items={items}
            t={t}
            locale={locale}
            filters={filters}
            onClearFilters={handleClearFilters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loadError={loadError}
            onRetry={handleSync}
          />
        ) : view === "done" ? (
          <LostFoundDone
            items={items}
            t={t}
            locale={locale}
            filters={filters}
            onClearFilters={handleClearFilters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loadError={loadError}
            onRetry={handleSync}
          />
        ) : (
          <LostFoundDisposal
            items={items}
            t={t}
            locale={locale}
            filters={filters}
            onClearFilters={handleClearFilters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loadError={loadError}
            onRetry={handleSync}
          />
        )}
      </div>

      <LostFoundDetailPanel
        item={selected}
        t={t}
        adminRestoreLabel={dictionary.lostFound.adminRestoreMemoLabel}
        autoDisposeLabel={dictionary.lostFound.autoDisposeMemoLabel}
        locale={locale}
        onClose={() => setSelectedId(null)}
        onAction={(kind, id) => setConfirm({ kind, id })}
        disabled={confirm !== null}
      />

      {confirm && confirmItem ? (
        <LostFoundActionModal
          kind={confirm.kind}
          item={confirmItem}
          t={t}
          locale={locale}
          sharedLabels={shared}
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirmAction}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
