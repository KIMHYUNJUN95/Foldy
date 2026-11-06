import "server-only";

import type { DeviceRow } from "../device/auth";
import type { CheckinServiceClient } from "../supabase/service";

const UNDEFINED_COLUMN = "42703";

/**
 * 이 기기 건물의 설정 줄 + `staff_call_enabled`. 줄이 없으면 null.
 * 코드가 마이그레이션보다 먼저 나가도 태블릿이 설정을 받도록, 칼럼이 없으면 꺼짐으로 읽는다.
 */
export async function readDeviceSettings(
  db: CheckinServiceClient,
  device: DeviceRow,
  columns: string,
): Promise<(Record<string, unknown> & { staff_call_enabled: boolean }) | null> {
  const select = (list: string) =>
    db.from("property_settings").select(list).eq("organization_id", device.organization_id).eq("property_key", device.property_key).maybeSingle();

  const { data, error } = await select(`${columns}, staff_call_enabled`);
  if (!error) return data as unknown as (Record<string, unknown> & { staff_call_enabled: boolean }) | null;
  if (error.code !== UNDEFINED_COLUMN) throw new Error(`property_settings 읽기 실패: ${error.message}`);

  const fallback = await select(columns);
  if (fallback.error) throw new Error(`property_settings 읽기 실패: ${fallback.error.message}`);
  return fallback.data ? { ...(fallback.data as unknown as Record<string, unknown>), staff_call_enabled: false } : null;
}
