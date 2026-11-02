import "server-only";

import type { CheckinServiceClient } from "../supabase/service";
import { hashGuestToken, isTokenShaped } from "../guest/token";

// 기기 토큰 확인(FR-D01 · D06) — `Authorization: Bearer <기기 토큰>`. DB 에는 sha256 만. 폐기된 기기는 바로 무효.
export type DeviceRow = { id: string; organization_id: string; property_key: string; name: string };

export function bearerOf(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : null;
}

export async function authenticateDevice(
  db: CheckinServiceClient,
  request: Request,
): Promise<{ device: DeviceRow } | { error: "unauthorized" | "revoked" }> {
  const raw = bearerOf(request);
  if (!raw || !isTokenShaped(raw)) return { error: "unauthorized" };
  const { data, error } = await db
    .from("devices")
    .select("id, organization_id, property_key, name, revoked_at")
    .eq("token_hash", hashGuestToken(raw))
    .maybeSingle();
  if (error) throw new Error(`devices 읽기 실패: ${error.message}`);
  if (!data) return { error: "unauthorized" };
  if (data.revoked_at) return { error: "revoked" };
  return { device: data as DeviceRow };
}
