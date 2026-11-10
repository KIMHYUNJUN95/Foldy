import { redirect } from "next/navigation";
import { requireAdminPageSession } from "@/lib/admin-page-auth";

// 예전 수리·점검 상세 주소. 2026-11-10 에 화면을 지우고 콘솔로 넘긴다 — 이 화면의 상태 바꾸기 폼은 권한 키 검사도, 감사 흔적(처리
// 메모 덧붙이기)도 없이 아무 상태로나 바꿀 수 있었다. 콘솔이 `?report=<id>` 로 그 건의 오른쪽 패널을 바로 연다(처리는 거기서 같은
// 규칙으로). 알림 · 북마크로 남은 옛 주소가 깨지지 않게 주소만 남겨 둔다. docs/product/08-maintenance-workflow.md
type PageProps = { params: Promise<{ id: string }> };

export default async function AdminMaintenanceDetailRedirect({ params }: PageProps) {
  const { id } = await params;
  await requireAdminPageSession({ nextPath: `/admin/maintenance/${encodeURIComponent(id)}` });
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  redirect(valid ? `/admin/maintenance?report=${id}` : "/admin/maintenance");
}
