"use client";

// Admin 주문·비품 console — content area for /admin/orders (AdminShell owns the sidebar/topbar).
// 화이트 리디자인(2026-10-14, 시안 Order-PC · OrderCal-PC · OrderAll-PC): 보기 셋 — 처리 중 / 배송 캘린더 / 전체 기록.
// 예전 「현황 보드」 · 「완료」는 처리 중 큐와 전체 기록(상태 고르기)으로 합쳤다. 처리형 콘솔: 승인 → 주문 처리 →
// 배송일 기입 → 캘린더 반영을 사무실에서 직접 진행하고, 예외 개입(요청 수정/상태 정정/다시 열기/삭제)도 여기서 한다.
// See docs/product/10-order-request-workflow.md.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { AdminOrderVM } from "@/lib/admin-orders";
import {
  rejectOrder,
  reopenOrder,
  correctOrderStatus,
  editOrder,
} from "@/app/admin/orders/actions";
import { updateOrderRequestStatus, updateOrderDeliveryDate } from "@/actions/orders";
import { deleteOrderRequest } from "@/actions/request-delete";
import "@/components/admin/maintenance/maintenance-console.css";
import "@/components/admin/lost-found/lost-found-console.css";
import "./orders-console.css";
import {
  LIST_STATUS,
  STATUS,
  dateToNum,
  delivOnDate,
  delivStart,
  inThisMonth,
  iso,
  isActiveStatus,
  isDelivThisWeek,
  parseTs,
  tpl,
  type OrderStatus,
} from "./orders-console-data";
import { buildingOptionsOf, copyOf, localeTagOf, type OrdersFilters } from "./orders-console-shared";
import { OrdersExportBar } from "./orders-export-bar";
import { OrdersQueue } from "./orders-queue";
import { OrdersList } from "./orders-list";
import { OrdersCalendar, OrdersMonthNav, type CalMonth } from "./orders-calendar";
import { OrdersDetailPanel, type OrdActionKind } from "./orders-detail-panel";
import { OrdersActionModal, type OrdActionPayload } from "./orders-action-modal";

type OrdersConsoleProps = {
  locale: Locale;
  orders: AdminOrderVM[];
  loadError: boolean;
  todayKey: string;
};

type OrdView = "queue" | "cal" | "all";

function defaultRange(todayKey: string): { from: string; to: string } {
  // 전체 기록 기본 기간 = 오늘까지 30일(시안 OrderAll-PC 「9월 10일 – 10월 9일」).
  const n = dateToNum(todayKey) - 29;
  const d = new Date(n * 86400000);
  return { from: iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), to: todayKey };
}

export function OrdersConsole({ locale, orders, loadError, todayKey }: OrdersConsoleProps) {
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const t = dictionary.admin.orders.console;
  const shared = dictionary.admin.shared;
  const { toast, showToast, dismiss } = useAdminToast();

  const [view, setView] = useState<OrdView>("queue");
  const [filters, setFilters] = useState<OrdersFilters>(() => {
    const range = defaultRange(todayKey);
    return { status: "all", urgency: "all", prop: "all", reporter: "all", from: range.from, to: range.to, query: "" };
  });
  const [calSel, setCalSel] = useState<string | null>(todayKey);
  const [calMonth, setCalMonth] = useState<CalMonth>(() => ({
    y: +todayKey.slice(0, 4),
    m: +todayKey.slice(5, 7) - 1,
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: OrdActionKind; id: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // 건물 고르기는 처리 중 · 배송 캘린더 · 전체 기록이 함께 쓴다.
  const scoped = useMemo(
    () => (filters.prop === "all" ? orders : orders.filter((o) => o.buildingKey === filters.prop)),
    [orders, filters.prop],
  );

  const kpi = useMemo(() => {
    const requested = scoped.filter((o) => o.status === "requested");
    const oldest = requested.reduce<number | null>((min, o) => {
      const n = dateToNum(o.reqDate);
      return min === null || n < min ? n : min;
    }, null);
    return {
      requested: requested.length,
      oldestDays: oldest === null ? null : dateToNum(todayKey) - oldest,
      approved: scoped.filter((o) => o.status === "approved").length,
      urgent: scoped.filter((o) => o.urgency === "high" && isActiveStatus(o.status)).length,
      delivWeek: scoped.filter((o) => isDelivThisWeek(o, todayKey)).length,
      delivToday: scoped.filter((o) => o.status === "ordered" && delivOnDate(o.deliv, todayKey)).length,
      orderedMo: scoped.filter((o) => o.status === "ordered" && inThisMonth(delivStart(o.deliv), todayKey)).length,
    };
  }, [scoped, todayKey]);

  const selected = selectedId ? (orders.find((o) => o.id === selectedId) ?? null) : null;
  const confirmOrder = confirm ? (orders.find((o) => o.id === confirm.id) ?? null) : null;

  function handleFilterChange<K extends keyof OrdersFilters>(key: K, value: OrdersFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearFilters() {
    setFilters((prev) => ({ ...prev, status: "all", urgency: "all", prop: "all", reporter: "all", query: "" }));
  }

  function handleViewChange(next: OrdView) {
    if (next === view) return;
    setView(next);
    setFilters((prev) => ({ ...prev, query: "" }));
    setSelectedId(null);
  }

  function handleSync() {
    router.refresh();
    showToast(t.tSynced);
  }

  /**
   * `router.refresh()` 는 **여기서 섞여 있다** — 액션마다 다르므로 일괄 제거하면 안 된다.
   *
   *   reject / reopen / correct / edit → `revalidateOrders()` 가 /admin/orders 포함  ⇒ 제거함
   *   deleteOrderRequest               → `revalidateAfterDelete` 가 포함              ⇒ 제거함
   *   updateOrderRequestStatus         → /mobile/requests · /mobile/notifications 만  ⇒ 유지
   *   updateOrderDeliveryDate          → 같음                                        ⇒ 유지
   *
   * 유지 쪽을 지우면 **처리 후 이 목록이 갱신되지 않는다.** (2026-08-11)
   */
  function handleConfirmAction(kind: OrdActionKind, id: string, payload: OrdActionPayload) {
    startTransition(async () => {
      if (kind === "approve") {
        const result = await updateOrderRequestStatus({ orderId: id, targetStatus: "approved" });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(t.tApprove);
        router.refresh();
        return;
      }

      if (kind === "reject") {
        const result = await rejectOrder({ orderId: id, reason: payload.memo ?? "" });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(t.tReject);
        return;
      }

      if (kind === "process" || kind === "editdeliv") {
        const delivery = {
          deliveryMode: payload.mode === "range" ? ("range" as const) : ("exact" as const),
          deliveryDate: payload.date,
          deliveryStartDate: payload.start,
          deliveryEndDate: payload.end,
        };
        const result =
          kind === "process"
            ? await updateOrderRequestStatus({ orderId: id, targetStatus: "ordered", ...delivery })
            : await updateOrderDeliveryDate({ orderId: id, ...delivery });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(kind === "process" ? t.tProcess : t.tEditDeliv);
        router.refresh();
        return;
      }

      if (kind === "reopen") {
        const result = await reopenOrder({ orderId: id });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(t.tReopen);
        return;
      }

      if (kind === "correct") {
        const result = await correctOrderStatus({
          orderId: id,
          status: payload.newStatus ?? "requested",
          memo: payload.memo ?? "",
        });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(t.tCorrect);
        return;
      }

      if (kind === "edit") {
        const result = await editOrder({
          orderId: id,
          title: payload.title ?? "",
          urgency: payload.urgency ?? "normal",
          reason: payload.reason ?? "",
          items: payload.items ?? [],
        });
        if (!result.ok) {
          showToast(t.errS);
          return;
        }
        setConfirm(null);
        showToast(t.tEdit);
        return;
      }

      // delete
      const result = await deleteOrderRequest(id);
      if (!result.ok) {
        showToast(t.errS);
        return;
      }
      setConfirm(null);
      setSelectedId(null);
      showToast(t.tDel);
    });
  }

  // 전체 기록 행 — 고르기 · 검색 · 기간을 모두 적용, 요청일 최신 순.
  const listRows = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return scoped
      .filter((o) => {
        if (o.reqDate < filters.from || o.reqDate > filters.to) return false;
        if (filters.status !== "all" && o.status !== filters.status) return false;
        if (filters.urgency !== "all" && o.urgency !== filters.urgency) return false;
        if (
          q &&
          !(
            o.title.toLowerCase().includes(q) ||
            o.reporterName.toLowerCase().includes(q) ||
            o.items.some((it) => it.name.toLowerCase().includes(q))
          )
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (parseTs(b.reqAt) ?? 0) - (parseTs(a.reqAt) ?? 0));
  }, [scoped, filters]);

  const V = (value: number) => (loadError ? "–" : value);
  const buildings = buildingOptionsOf(orders);
  const views: { key: OrdView; label: string }[] = [
    { key: "queue", label: t.wVQueue },
    { key: "cal", label: t.wVCal },
    { key: "all", label: t.wVAll },
  ];

  const exportBar = (
    <OrdersExportBar
      disabled={loadError || (view === "all" && listRows.length === 0)}
      filters={{
        startDate: filters.from,
        endDate: filters.to,
        status: view === "all" && filters.status !== "all" ? filters.status : undefined,
        urgency: view === "all" && filters.urgency !== "all" ? filters.urgency : undefined,
        building: filters.prop !== "all" ? filters.prop : undefined,
        query: view === "all" && filters.query.trim() ? filters.query.trim() : undefined,
      }}
      labels={shared}
    />
  );

  return (
    <>
      {/* 화이트 리디자인(2026-10-14): 보기 탭 셋(아이콘 없음) + 보기마다 고르기가 한 줄에. */}
      <div className="cviewbar mw-viewbar lfw-viewbar ow-viewbar">
        <div className="lviews" style={{ margin: 0 }}>
          {views.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? "on" : ""} onClick={() => handleViewChange(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        {view === "queue" ? (
          <button type="button" className="mw-live" onClick={handleSync}>
            <i aria-hidden="true" />
            {t.syncLabel} · {t.syncAgo}
          </button>
        ) : null}
        {view === "cal" ? (
          <OrdersMonthNav
            t={t}
            locale={locale}
            todayKey={todayKey}
            calMonth={calMonth}
            onCalMonthChange={setCalMonth}
            onToday={() => {
              setCalMonth({ y: +todayKey.slice(0, 4), m: +todayKey.slice(5, 7) - 1 });
              setCalSel(todayKey);
            }}
          />
        ) : null}
        {view === "all" ? (
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
        ) : null}
        <span className="lfw-viewbar__sp" />
        {view !== "all" ? (
          <AdmDropdown
            size="sm"
            value={filters.prop}
            onChange={(v) => handleFilterChange("prop", v)}
            ariaLabel={t.calBuilding}
            options={[{ value: "all", label: t.allProp }, ...buildings.map((b) => ({ value: b.key, label: b.label }))]}
          />
        ) : null}
        {view !== "cal" ? exportBar : null}
      </div>

      {view === "all" ? (
        <div className="ow-filters">
          <div className="qsearch qsearch--inline ow-search">
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
          <AdmDropdown
            size="sm"
            value={filters.status}
            onChange={(v) => handleFilterChange("status", v as OrderStatus | "all")}
            ariaLabel={t.colStatus}
            options={[
              { value: "all", label: t.allStatus },
              ...LIST_STATUS.map((s) => ({ value: s, label: s === "closed" ? t.wStClosed : copyOf(t, STATUS[s].key) })),
            ]}
          />
          <AdmDropdown
            size="sm"
            value={filters.prop}
            onChange={(v) => handleFilterChange("prop", v)}
            ariaLabel={t.allProp}
            options={[{ value: "all", label: t.allProp }, ...buildings.map((b) => ({ value: b.key, label: b.label }))]}
          />
          <AdmDropdown
            size="sm"
            value={filters.urgency}
            onChange={(v) => handleFilterChange("urgency", v as OrdersFilters["urgency"])}
            ariaLabel={t.allUrgency}
            options={[
              { value: "all", label: t.allUrgency },
              { value: "high", label: t.urgent },
              { value: "normal", label: t.normal },
            ]}
          />
          <span className="ow-filters__count">{loadError ? null : tpl(t.wCountLine, { n: listRows.length })}</span>
        </div>
      ) : null}

      {view === "queue" ? (
        <div className="wkpis lfw-kpis">
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiRequested}</span>
            <span className="wkpi__v">
              {V(kpi.requested)}
              <small>{t.wCountUnit}</small>
            </span>
            <span className="wkpi__d">
              {kpi.oldestDays === null ? t.clear : kpi.oldestDays === 0 ? t.wKpiOldestToday : tpl(t.wKpiOldest, { n: kpi.oldestDays })}
            </span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiApproved}</span>
            <span className="wkpi__v">
              {V(kpi.approved)}
              <small>{t.wCountUnit}</small>
            </span>
            <span className="wkpi__d">{t.wKpiApprovedSub}</span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiUrgent}</span>
            <span className={`wkpi__v${!loadError && kpi.urgent > 0 ? " is-danger" : ""}`}>
              {V(kpi.urgent)}
              <small>{t.wCountUnit}</small>
            </span>
            <span className="wkpi__d">{t.wKpiUrgentSub}</span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiDelivWeek}</span>
            <span className="wkpi__v">
              {V(kpi.delivWeek)}
              <small>{t.wCountUnit}</small>
            </span>
            <span className="wkpi__d">{tpl(t.wKpiWeekSub, { n: kpi.delivToday })}</span>
          </div>
          <div className="wkpi">
            <span className="wkpi__k">{t.kpiOrderedMo}</span>
            <span className="wkpi__v">
              {V(kpi.orderedMo)}
              <small>{t.wCountUnit}</small>
            </span>
            <span className="wkpi__d">{t.wKpiMonthSub}</span>
          </div>
        </div>
      ) : null}

      <div className="cbody lfw-body">
        {view === "queue" ? (
          <OrdersQueue
            orders={scoped}
            t={t}
            locale={locale}
            todayKey={todayKey}
            selectedId={selectedId}
            loadError={loadError}
            onRetry={handleSync}
            onSelect={setSelectedId}
            onAction={(kind, id) => setConfirm({ kind, id })}
            onOpenCalendar={() => handleViewChange("cal")}
          />
        ) : view === "cal" ? (
          <OrdersCalendar
            orders={scoped}
            t={t}
            locale={locale}
            todayKey={todayKey}
            calMonth={calMonth}
            calSel={calSel}
            onCalSelChange={setCalSel}
            onSelectOrder={setSelectedId}
            loadError={loadError}
            onRetry={handleSync}
          />
        ) : (
          <OrdersList
            rows={listRows}
            t={t}
            locale={locale}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onClearFilters={handleClearFilters}
            loadError={loadError}
            onRetry={handleSync}
          />
        )}
      </div>

      <OrdersDetailPanel
        order={selected}
        t={t}
        locale={locale}
        todayKey={todayKey}
        onClose={() => setSelectedId(null)}
        onAction={(kind, id) => setConfirm({ kind, id })}
        disabled={confirm !== null}
      />

      {confirm && confirmOrder ? (
        <OrdersActionModal
          kind={confirm.kind}
          order={confirmOrder}
          t={t}
          locale={locale}
          todayKey={todayKey}
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={handleConfirmAction}
          onValidationError={(message) => showToast(message)}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
