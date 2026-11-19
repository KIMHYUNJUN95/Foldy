"use server";

/**
 * Beds24 크레딧 사용 — PC 상단 게이지 · 자동화 관제실 · 모바일 판매 캘린더 · 자동화가 같이 부른다(공용 액션).
 * 도메인 계약: docs/engineering/01-beds24-integration.md → 「크레딧 사용 기록」.
 *
 * - 권한: `canViewBeds24Credit`(조직 · `ops_admin.access` · 관리 웹 — 상단 게이지와 같은 판정). 아니면 redirect 없이
 *   `forbidden`(폰 사용자를 PC 화면으로 보내지 않게). 플랫폼 계정도 `forbidden`.
 * - 조직은 세션에서만. 읽기는 service role 이라 `credit-usage-read.ts` 가 조직을 직접 거른다.
 * - Beds24 를 부르지 않는다 — 우리 기록만 읽는다.
 */

import { getAdminSessionForApi } from "@/lib/admin-session";
import { canViewBeds24Credit } from "@/lib/beds24/credit-access";
import { isBeds24CreditCallFilter, isBeds24CreditCursor } from "@/lib/beds24/credit-usage-model";
import { getBeds24CreditCalls, getBeds24CreditDetail, getBeds24CreditSummary } from "@/lib/beds24/credit-usage-read";
import type {
  Beds24CreditCallCursor,
  Beds24CreditCallFilter,
  Beds24CreditCallPage,
  Beds24CreditDetail,
  Beds24CreditRange,
  Beds24CreditSummary,
} from "@/lib/beds24/credit-usage-types";

export type Beds24CreditErrorKey = "forbidden" | "invalid" | "failed";

const RANGES: readonly Beds24CreditRange[] = ["5m", "1h", "today", "7d"];

async function viewerOrganizationId(): Promise<string | null> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok || !canViewBeds24Credit(auth.session)) return null;
  return auth.session.organization.id;
}

export async function loadBeds24CreditSummary(): Promise<
  { ok: true; data: Beds24CreditSummary } | { ok: false; error: Beds24CreditErrorKey }
> {
  const organizationId = await viewerOrganizationId();
  if (!organizationId) return { ok: false, error: "forbidden" };
  try {
    return { ok: true, data: await getBeds24CreditSummary(organizationId) };
  } catch (error) {
    console.error("[beds24-credit] summary failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}

export async function loadBeds24CreditDetail(
  range: Beds24CreditRange,
): Promise<{ ok: true; data: Beds24CreditDetail } | { ok: false; error: Beds24CreditErrorKey }> {
  const organizationId = await viewerOrganizationId();
  if (!organizationId) return { ok: false, error: "forbidden" };
  if (!RANGES.includes(range)) return { ok: false, error: "invalid" };
  try {
    return { ok: true, data: await getBeds24CreditDetail(organizationId, range) };
  } catch (error) {
    console.error("[beds24-credit] detail failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}

/** 최근 호출 — 거르기 · 「더 보기」(커서 다음 50개). 권한 · 조직은 상세와 같다. 커서 · 거르기 값은 모양을 엄격히 본다(필터 글자에 들어간다). */
export async function loadBeds24CreditCalls(
  range: Beds24CreditRange,
  filter: Beds24CreditCallFilter,
  cursor: Beds24CreditCallCursor | null,
): Promise<{ ok: true; data: Beds24CreditCallPage } | { ok: false; error: Beds24CreditErrorKey }> {
  const organizationId = await viewerOrganizationId();
  if (!organizationId) return { ok: false, error: "forbidden" };
  if (!RANGES.includes(range) || !isBeds24CreditCallFilter(filter) || (cursor !== null && !isBeds24CreditCursor(cursor))) {
    return { ok: false, error: "invalid" };
  }
  try {
    return {
      ok: true,
      data: await getBeds24CreditCalls(organizationId, {
        range,
        filter: { actor: filter.actor, feature: filter.feature },
        cursor: cursor ? { calledAt: cursor.calledAt, id: cursor.id } : null,
      }),
    };
  } catch (error) {
    console.error("[beds24-credit] calls failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}
