// 모든 관리자 콘솔 Excel/PDF 내보내기 서버 액션이 공유하는 반환 타입. 일반
// (`server-only` 아닌) 모듈에 두어, 클라이언트 컴포넌트가 exceljs 를 브라우저 번들로 끌어오지 않고
// 타입을 가져올 수 있게 한다. 대표 사용처는 <AdminExportButtons>
// (src/components/admin/shared/admin-export-buttons.tsx) 이다.

export type AdminExportFailureReason = "forbidden" | "empty" | "error";

export type AdminWorkbookExportResult =
  | { ok: true; filename: string; base64: string; rowCount: number }
  | { ok: false; reason: AdminExportFailureReason };

export type AdminReportExportResult =
  | { ok: true; html: string; rowCount: number }
  | { ok: false; reason: AdminExportFailureReason };
