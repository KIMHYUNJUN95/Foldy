import "server-only";
import { memberCapabilities } from "@/lib/capabilities-server";

/**
 * 수리 상태 변경 권한 = 권한 키 `maintenance_status_change`(역할 기본 + 개인 부여 · 차단). 아르바이트 · 아르바이트 리더는 역할로 못 받는다.
 * PC 콘솔 강제 완료 · 무효(`applyMaintenanceException`)도 같은 키다(2026-11-10). 「use server」 파일에 두면 누구나 부를 수 있는 액션이 돼서 lib 로 뺐다.
 */
export async function canHandleMaintenance(organizationId: string, userId: string): Promise<boolean> {
  return (await memberCapabilities(organizationId, userId)).includes("maintenance_status_change");
}
