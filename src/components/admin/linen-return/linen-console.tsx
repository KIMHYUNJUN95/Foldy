"use client";

// Admin 린넨 반품 콘솔 — /admin/linen-return 의 본문 (사이드바/탑바는 AdminShell 소유).
// 뷰 2개: 「기록」(반품 한 건 = 한 행) / 「품목별 수량」(같은 조건의 품목별 대조표).
//
// 이 화면은 사무실의 기록 관리 콘솔이다. 신규 등록은 계속 현장 모바일 전용이라 "등록" 액션이 없고,
// 대신 이미 등록된 기록의 확인 · 수정 · 삭제만 한다. 조회 기간은 URL(searchParams)로 관리해서
// 서버에서 조직 스코프 쿼리로 좁힌다 — 다른 조직/기간의 행이 브라우저로 내려오지 않는다.
// 참고: docs/product/19-linen-defect-workflow.md → "Admin Dashboard — Linen Return Record Management".

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, SearchX, TriangleAlert } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import {
  deleteAdminLinenRecord,
  exportLinenReturnReport,
  exportLinenReturnWorkbook,
  updateAdminLinenRecord,
} from "@/app/admin/linen-return/actions";
import type { AdminLinenReturnData } from "@/lib/admin-linen-returns";
import { getDictionary, type Locale } from "@/lib/i18n";
import "@/components/admin/maintenance/maintenance-console.css";
import "@/components/admin/lost-found/lost-found-console.css";
import "@/components/admin/orders/orders-console.css";
import "./linen-console.css";
import {
  buildingOptionsOf,
  linenSaveFailureOutcome,
  localeTagOf,
  registrantOptionsOf,
  type LinenExportQuery,
  type LinenFilters,
} from "./linen-console-data";
import { LinenRecordList } from "./linen-record-list";
import { LinenItemSummary } from "./linen-item-summary";
import { LinenDetailPanel, LinenEditModal, type LinenEditPayload } from "./linen-detail-panel";
import { LinenDeleteModal } from "./linen-delete-modal";

type LinenView = "records" | "items";

type Props = {
  locale: Locale;
  organizationId: string;
  data: AdminLinenReturnData;
  /** 서버가 실제로 조회한 기간 (Tokyo, inclusive). */
  from: string;
  to: string;
  /** 기본 기간(이번 달 Tokyo) — "이번 달로 보기" 복귀용. */
  defaultFrom: string;
  defaultTo: string;
};

export function LinenReturnConsole({
  locale,
  organizationId,
  data,
  from,
  to,
  defaultFrom,
  defaultTo,
}: Props) {
  const router = useRouter();
  const dictionary = getDictionary(locale);
  const linen = dictionary.linenReturn;
  const t = linen.console;
  const shared = dictionary.admin.shared;
  const localeTag = localeTagOf(locale);
  const { toast, showToast, dismiss } = useAdminToast();

  const [view, setView] = useState<LinenView>("records");
  const [filters, setFilters] = useState<Omit<LinenFilters, "from" | "to">>({
    building: "all",
    item: "all",
    registrant: "all",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { records, items, buildings, loadError } = data;

  const buildingOptions = useMemo(
    () => buildingOptionsOf(records, buildings, localeTag),
    [records, buildings, localeTag],
  );
  const registrantOptions = useMemo(() => registrantOptionsOf(records, localeTag), [records, localeTag]);

  // 기간은 이미 서버 쿼리에서 적용됐다. 여기서는 건물/품목/등록자만 좁힌다.
  const scopedRecords = useMemo(
    () =>
      records.filter((record) => {
        if (filters.building !== "all" && record.buildingName !== filters.building) return false;
        if (filters.registrant !== "all" && record.registeredById !== filters.registrant) return false;
        return true;
      }),
    [records, filters.building, filters.registrant],
  );

  // 「기록」 뷰만 품목 필터를 적용한다 — 「품목별 수량」은 항상 전체 품목 대조표다.
  const listRecords = useMemo(
    () =>
      filters.item === "all"
        ? scopedRecords
        : scopedRecords.filter((record) => record.lines.some((l) => l.itemId === filters.item)),
    [scopedRecords, filters.item],
  );

  // 건물을 좁혔을 때 나란히 보여줄 "전체 건물" 대조값 (같은 기간·등록자 조건).
  const allBuildingRecords = useMemo(
    () =>
      records.filter(
        (record) => filters.registrant === "all" || record.registeredById === filters.registrant,
      ),
    [records, filters.registrant],
  );

  const visible = view === "items" ? scopedRecords : listRecords;
  const selected = selectedId ? (records.find((r) => r.id === selectedId) ?? null) : null;
  const confirmRecord = confirmId ? (records.find((r) => r.id === confirmId) ?? null) : null;
  const itemFilterName =
    items.find((item) => item.id === filters.item)?.name ?? t.allItems;
  // 건물 표시는 정규명이 아니라 현지화 라벨로 — 필터/저장 키는 계속 정규명(`name`)을 쓴다.
  const buildingFilterLabel =
    filters.building === "all"
      ? null
      : (buildingOptions.find((option) => option.name === filters.building)?.label ??
        filters.building);
  const hasFilter =
    filters.building !== "all" || filters.registrant !== "all" || (view !== "items" && filters.item !== "all");

  // 내보내기는 기간 · 보기 · 필터만 보낸다 — 표는 서버가 같은 규칙(buildLinenExportPayload)으로 다시 만든다(2026-11-10).
  // 로케일은 서버가 세션에서 정하므로 여기서 넘기지 않는다(공용 export 계약).
  const exportQuery: LinenExportQuery = {
    from,
    to,
    view,
    building: filters.building,
    item: filters.item,
    registrant: filters.registrant,
  };

  function applyRange(nextFrom: string, nextTo: string) {
    setSelectedId(null);
    startTransition(() => {
      router.replace(`/admin/linen-return?from=${nextFrom}&to=${nextTo}`, { scroll: false });
    });
  }

  function clearFilters() {
    setFilters({ building: "all", item: "all", registrant: "all" });
    setSelectedId(null);
  }

  function changeView(next: LinenView) {
    if (next === view) return;
    setView(next);
    setSelectedId(null);
  }

  function handleSave(payload: LinenEditPayload) {
    if (!selected) return;
    startTransition(async () => {
      const result = await updateAdminLinenRecord({ recordId: selected.id, updatedAt: selected.updatedAt, ...payload });
      if (!result.ok) {
        showToast(
          result.reason === "stale"
            ? t.tStale
            : result.reason === "invalid_photo"
              ? t.ePhotoInvalid
              : (linen.errors[result.reason] ?? t.tError),
        );
        // 그사이 바뀐 · 사라진 기록이면 수정 창을 닫고 상세 패널을 새 값으로 다시 그린다(예전 입력값으로 덮어쓰지 않게).
        const outcome = linenSaveFailureOutcome(result.reason);
        if (outcome.closeEditor) setEditOpen(false);
        if (outcome.refresh) router.refresh();
        return;
      }
      setEditOpen(false);
      showToast(t.tSaved);
    });
  }

  function handleDelete() {
    if (!confirmId) return;
    startTransition(async () => {
      const result = await deleteAdminLinenRecord(confirmId);
      if (!result.ok) {
        showToast(linen.errors[result.reason] ?? t.tError);
        return;
      }
      setConfirmId(null);
      setSelectedId(null);
      showToast(t.tDeleted);
    });
  }

  // 화이트 리디자인(2026-10-14, 시안 Linen-PC · LinenItems-PC): 보기 탭(아이콘 없음) · 기간 · 고르기 · 내보내기를 한 줄에.
  const viewbar = (
    <div className="cviewbar mw-viewbar lfw-viewbar ow-viewbar lnp-viewbar">
      <div className="lviews" style={{ margin: 0 }}>
        <button className={view === "records" ? "on" : ""} onClick={() => changeView("records")} type="button">
          {t.vRecords}
        </button>
        <button className={view === "items" ? "on" : ""} onClick={() => changeView("items")} type="button">
          {t.vItems}
        </button>
      </div>
      <AdminDateRangePicker
        ariaLabel={shared.pickRange}
        from={from}
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
        localeTag={localeTag}
        onChange={applyRange}
        to={to}
      />
      <span className="lfw-viewbar__sp" />
      <AdmDropdown
          ariaLabel={t.colBuilding}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, building: value }));
            setSelectedId(null);
          }}
          options={[
            { value: "all", label: t.allBuildings },
            ...buildingOptions.map((option) => ({ value: option.name, label: option.label })),
          ]}
          size="sm"
          value={filters.building}
        />
      {view === "items" ? null : (
        <AdmDropdown
          ariaLabel={t.colItems}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, item: value }));
            setSelectedId(null);
          }}
          options={[{ value: "all", label: t.allItems }, ...items.map((item) => ({ value: item.id, label: item.name }))]}
          size="sm"
          value={filters.item}
        />
      )}
      <AdmDropdown
        ariaLabel={t.colRegistrant}
        noResultLabel={t.noSearchResult}
        onChange={(value) => {
          setFilters((prev) => ({ ...prev, registrant: value }));
          setSelectedId(null);
        }}
        options={[
          { value: "all", label: t.allRegistrants },
          ...registrantOptions.map((option) => ({ value: option.id, label: option.name })),
        ]}
        searchPlaceholder={t.searchRegistrant}
        searchable
        size="sm"
        value={filters.registrant}
      />
      <AdminExportButtons
        disabled={loadError || visible.length === 0}
        labels={shared}
        onExportPdf={() => exportLinenReturnReport(exportQuery)}
        onExportXls={() => exportLinenReturnWorkbook(exportQuery)}
        onToast={showToast}
      />
    </div>
  );

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <div className="lfw-empty">
        <TriangleAlert aria-hidden="true" />
        <b>{t.errT}</b>
        <span>{t.errS}</span>
        <button className="btn btn--pri btn--sm" onClick={() => router.refresh()} type="button">
          {t.retry}
        </button>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="lfw-empty">
        <SearchX aria-hidden="true" />
        <b>{t.emptyTitle}</b>
        <span>{t.emptySub}</span>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {hasFilter ? (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters} type="button">
              {t.clearFilter}
            </button>
          ) : null}
          <button className="btn btn--ghost btn--sm" onClick={() => applyRange(defaultFrom, defaultTo)} type="button">
            <span className="ic">
              <CalendarDays aria-hidden="true" />
            </span>
            {t.emptyThisMonth}
          </button>
        </div>
      </div>
    );
  } else if (view === "items") {
    body = (
      <LinenItemSummary
        allBuildingRecords={allBuildingRecords}
        buildingLabel={buildingFilterLabel}
        catalog={items}
        onSelectItem={(itemId) => {
          setFilters((prev) => ({ ...prev, item: itemId }));
          setView("records");
        }}
        records={scopedRecords}
        selectedItem={filters.item}
        t={t}
        units={linen}
      />
    );
  } else {
    body = (
      <LinenRecordList
        itemFilter={filters.item}
        itemFilterName={itemFilterName}
        localeTag={localeTag}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
        records={listRecords}
        selectedId={selectedId}
        t={t}
        units={linen}
      />
    );
  }

  return (
    <>
      {viewbar}
      <div className="cbody lfw-body">{body}</div>

      {selected ? (
        <LinenDetailPanel
          disabled={editOpen || confirmId !== null}
          localeTag={localeTag}
          onClose={() => setSelectedId(null)}
          onDelete={() => setConfirmId(selected.id)}
          onEdit={() => setEditOpen(true)}
          record={selected}
          t={t}
          units={linen}
        />
      ) : null}

      {selected && editOpen ? (
        <LinenEditModal
          buildings={buildings}
          catalog={items}
          errors={linen.errors}
          localeTag={localeTag}
          onCancel={() => setEditOpen(false)}
          onSave={handleSave}
          organizationId={organizationId}
          record={selected}
          saving={isPending}
          t={t}
        />
      ) : null}

      {confirmRecord ? (
        <LinenDeleteModal
          onCancel={() => setConfirmId(null)}
          onConfirm={handleDelete}
          pending={isPending}
          record={confirmRecord}
          t={t}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
