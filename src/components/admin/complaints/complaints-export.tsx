"use client";

// 게스트 피드백 보기바의 Excel · PDF(2026-10-28, 시안 캔버스 92CCRr…). 공용 <AdminExportButtons> 를 그대로 쓰고,
// 넘기는 건 지금 주소의 쿼리뿐이다 — 행은 서버 액션이 같은 조건으로 다시 읽는다. 로케일도 서버가 정한다.
// 보이는 사람은 `complaint.manage` 뿐(콘솔이 가린다) — 서버 액션도 같은 권한을 다시 본다.
import { AdminExportButtons, type AdminExportLabels } from "@/components/admin/shared/admin-export-buttons";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import {
  exportComplaintsReport,
  exportComplaintsWorkbook,
  type ComplaintsExportQuery,
} from "@/app/admin/complaints/export-actions";

export function ComplaintsExport({
  query,
  disabled,
  labels,
}: {
  query: ComplaintsExportQuery;
  disabled: boolean;
  labels: AdminExportLabels;
}) {
  const { toast, showToast, dismiss } = useAdminToast();
  return (
    <>
      <AdminExportButtons
        onExportXls={() => exportComplaintsWorkbook(query)}
        onExportPdf={() => exportComplaintsReport(query)}
        disabled={disabled}
        onToast={showToast}
        labels={labels}
      />
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}
