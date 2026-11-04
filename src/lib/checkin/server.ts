import "server-only";

import type { Capability } from "@/config/capabilities";
import { getAdminSessionForApi } from "@/lib/admin-session";
import { hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

/**
 * 셀프 체크인 직원 서버 공용 — 문(권한) · DB · 기록.
 *
 * 읽기 · 쓰기 모두 service_role + 서버 권한 확인뿐이다. `checkin` 스키마는 authenticated 에 usage · 표 권한 · 정책이 없어(RLS 만 켜짐)
 * 직원 JWT 로 직접 읽는 길이 없다 — 권한 판정은 이 파일의 `checkinGate` 한 곳이다. 그러니 service 클라이언트를 쓰는 곳은 이 문을 먼저 지나야 한다.
 */

export type CheckinGate =
  | { ok: true; organizationId: string; userId: string; capabilities: readonly Capability[] }
  | { ok: false; errorKey: "forbidden" };

export async function checkinGate(capability: Capability): Promise<CheckinGate> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok || !hasOrganizationContext(auth.session)) return { ok: false, errorKey: "forbidden" };
  if (!auth.session.capabilities.includes(capability)) return { ok: false, errorKey: "forbidden" };
  return {
    ok: true,
    organizationId: auth.session.organization.id,
    userId: auth.session.user.id,
    capabilities: auth.session.capabilities,
  };
}

/** PostgREST 는 스키마가 API 에 노출돼야 service_role 로도 읽힌다. */
export function checkinDb() {
  return getSupabaseServiceClient().schema("checkin");
}

export const CHECKIN_DOCUMENTS_BUCKET = "checkin-documents";

/** 마이그레이션 미적용(표 · 스키마 없음) 또는 API 노출 설정 전. */
export class CheckinNotReadyError extends Error {}

const NOT_READY_CODES = new Set(["PGRST106", "PGRST205", "42P01", "3F000"]);

/** 쿼리 오류를 던진다. 메시지 · details 에 값이 섞일 수 있어 로그에는 코드만 남긴다. */
export function throwOnCheckinError(error: { code?: string } | null, where: string): void {
  if (!error) return;
  if (error.code && NOT_READY_CODES.has(error.code)) throw new CheckinNotReadyError(where);
  throw new Error(`${where}: ${error.code ?? "unknown"}`);
}

/** 액션 바깥 틀 — 표가 없으면 not_ready, 나머지는 failed. 페이지가 터지지 않게 던지지 않는다. */
export async function runCheckinAction<T>(where: string, run: () => Promise<T>): Promise<T | { ok: false; errorKey: "not_ready" | "failed" }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CheckinNotReadyError) return { ok: false, errorKey: "not_ready" };
    console.error(`[checkin] ${where}:`, error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export type CheckinAuditEntry = {
  organizationId: string;
  userId: string;
  action:
    | "document_viewed"
    | "checkin_code_revealed"
    | "stay_verified"
    | "enrollment_code_issued"
    | "enrollment_code_invalidated"
    | "device_renamed"
    | "device_revoked"
    | "property_settings_updated";
  stayId?: string | null;
  guestId?: string | null;
  documentId?: string | null;
  /** 코드 · 이름 · 번호 등 값은 넣지 않는다 — 종류 · 키만. */
  meta?: Json;
};

/** 기록 한 줄. 실패하면 던진다 — 부르는 쪽이 「기록 못 하면 안 보여 주기」와 「이미 끝난 변경은 성공」을 고른다. */
export async function writeCheckinAudit(entry: CheckinAuditEntry): Promise<void> {
  const { error } = await checkinDb()
    .from("audit_log")
    .insert({
      organization_id: entry.organizationId,
      actor_user_id: entry.userId,
      action: entry.action,
      stay_id: entry.stayId ?? null,
      guest_id: entry.guestId ?? null,
      document_id: entry.documentId ?? null,
      meta: entry.meta ?? {},
    });
  throwOnCheckinError(error, "audit_log");
}

/** 변경은 이미 끝났으니 기록 실패로 실패라고 답하지 않는다(손님 정보 없는 로그만). */
export async function writeCheckinAuditAfterChange(entry: CheckinAuditEntry): Promise<void> {
  try {
    await writeCheckinAudit(entry);
  } catch (error) {
    console.error(`[checkin] audit ${entry.action}:`, error instanceof Error ? error.message : "unknown");
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
