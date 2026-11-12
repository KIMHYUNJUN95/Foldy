"use server";

/**
 * 손님 메시지 과거 가져오기 서버 액션 — docs/product/47-guest-messaging.md 「과거 메시지 가져오기」.
 *
 * - 권한: `guest_messages.manage` 만(아니면 redirect 없이 `forbidden` — 공용 액션 규칙). 조직 id 는 언제나 세션에서 온다.
 * - `startGuestMessageBackfill({ mode: "run" })`: 한 번 실행(최대 10페이지)을 `after()` 로 뒤에서 돌리고 바로 돌아온다.
 *   화면은 `getGuestMessageBackfillStatus()` 로 진행을 다시 읽는다. 이미 도는 중이면 `busy`, 끝났으면 `done`(다시 하려면 `restart: true`).
 * - `startGuestMessageBackfill({ mode: "measure" })`: 재기(maxAge=7 첫 페이지, 넣지 않음)를 바로 돌려 결과를 돌려준다. 5분에 한 번(아니면 `too_soon`).
 * - **이 액션을 부르는 화면(설정 페이지)은 `export const maxDuration = 300` 을 둬야 한다** — `after()` 실행이 그 페이지 함수 시간 안에서 돈다
 *   (가져오기 시간 예산 240초 · lease 120초를 페이지마다 늘림).
 * - 화면 단추는 다른 작업에서 붙인다(이 파일은 계약만).
 */

import { after } from "next/server";
import { backfillGuestMessageHistory, readGuestMessageBackfillState, type BackfillMeasure } from "@/lib/guest-messages/backfill";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type GuestMessageBackfillErrorKey = "forbidden" | "busy" | "done" | "too_soon" | "failed";

export type GuestMessageBackfillStatus = {
  status: "idle" | "running" | "paused" | "done" | "failed";
  nextPage: number;
  pagesDone: number;
  fetched: number;
  imported: number;
  skipped: number;
  unrouted: number;
  failedBookings: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  resumeAfter: string | null;
  measure: BackfillMeasure | null;
};

type Failure = { ok: false; errorKey: GuestMessageBackfillErrorKey };

async function gate(): Promise<{ ok: true; organizationId: string } | Failure> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  if (!session.capabilities.includes("guest_messages.manage")) return { ok: false, errorKey: "forbidden" };
  return { ok: true, organizationId: session.organization.id };
}

const IDLE: GuestMessageBackfillStatus = {
  status: "idle",
  nextPage: 1,
  pagesDone: 0,
  fetched: 0,
  imported: 0,
  skipped: 0,
  unrouted: 0,
  failedBookings: 0,
  startedAt: null,
  finishedAt: null,
  lastRunAt: null,
  lastError: null,
  resumeAfter: null,
  measure: null,
};

async function readStatus(organizationId: string): Promise<GuestMessageBackfillStatus> {
  const row = await readGuestMessageBackfillState(getSupabaseServiceClient(), organizationId);
  if (!row) return IDLE;
  const leaseLive = !!row.lease_until && Date.parse(row.lease_until) > Date.now();
  return {
    // lease 가 지난 running 은 끊긴 실행 — 이어 받을 수 있으니 paused 로 보여 준다.
    status: row.status === "running" && !leaseLive ? "paused" : (row.status as GuestMessageBackfillStatus["status"]),
    nextPage: row.next_page,
    pagesDone: row.pages_done,
    fetched: row.fetched_count,
    imported: row.imported_count,
    skipped: row.skipped_count,
    unrouted: row.unrouted_count,
    failedBookings: row.failed_bookings,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    resumeAfter: row.resume_after,
    measure: (row.last_measure ?? null) as BackfillMeasure | null,
  };
}

export async function getGuestMessageBackfillStatus(): Promise<
  { ok: true; status: GuestMessageBackfillStatus } | Failure
> {
  const access = await gate();
  if (!access.ok) return access;
  try {
    return { ok: true, status: await readStatus(access.organizationId) };
  } catch (error) {
    console.error("[guest-messages/backfill] status read failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export async function startGuestMessageBackfill(
  input: { mode?: "run" | "measure"; restart?: boolean } = {},
): Promise<{ ok: true; status: GuestMessageBackfillStatus } | Failure> {
  const access = await gate();
  if (!access.ok) return access;
  const organizationId = access.organizationId;
  const mode = input?.mode === "measure" ? "measure" : "run";
  const restart = input?.restart === true;
  try {
    if (mode === "measure") {
      const measured = await backfillGuestMessageHistory(organizationId, { mode: "measure" });
      if (measured.skipped === "too_soon") return { ok: false, errorKey: "too_soon" };
      return { ok: true, status: await readStatus(organizationId) };
    }
    const current = await readStatus(organizationId);
    if (current.status === "running") return { ok: false, errorKey: "busy" };
    if (current.status === "done" && !restart) return { ok: false, errorKey: "done" };
    after(async () => {
      try {
        await backfillGuestMessageHistory(organizationId, { mode: "run", restart });
      } catch (error) {
        console.error("[guest-messages/backfill] run failed", error instanceof Error ? error.message : "unknown");
      }
    });
    return { ok: true, status: current };
  } catch (error) {
    console.error("[guest-messages/backfill] start failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}
