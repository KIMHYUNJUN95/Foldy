"use client";

import { AdminExportButtons, type AdminExportLabels } from "@/components/admin/shared/admin-export-buttons";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import {
  exportOrdersReport,
  exportOrdersWorkbook,
  type OrdersExportFilters,
} from "@/app/admin/orders/actions";

/**
 * 서버에서 렌더링한 주문·비품 필터 바와 공용 내보내기 버튼을 잇는 클라이언트 브리지.
 * 현재 필터 값만 경계를 넘는다 — 서버 액션이 행을 다시 조회한다.
 */
export function OrdersExportBar({
  filters,
  disabled,
  labels,
}: {
  filters: OrdersExportFilters;
  disabled: boolean;
  labels: AdminExportLabels;
}) {
  const { toast, showToast, dismiss } = useAdminToast();

  return (
    <div className="flex items-center gap-2">
      <AdminExportButtons
        onExportXls={() => exportOrdersWorkbook(filters)}
        onExportPdf={() => exportOrdersReport(filters)}
        disabled={disabled}
        onToast={showToast}
        labels={labels}
      />
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
