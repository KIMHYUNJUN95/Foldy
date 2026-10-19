import type {
  OpsCellHistoryResult,
  OpsPriceConversionsResult,
  OpsRecentBookingsResult,
  OpsSendLogResult,
  PriceJobStatus,
} from "@/app/api/ops/calendar/reads";

/**
 * 판매 캘린더 읽기 전용 조회의 클라이언트 쪽 — `GET /api/ops/calendar/*`(서버 액션 큐 밖, 병렬).
 * 서버: `src/app/api/ops/calendar/[read]/route.ts`. 결과 모양은 예전 서버 액션과 같아 호출부는 그대로다.
 */

async function getJson<T>(path: string, params: URLSearchParams): Promise<T | null> {
  try {
    const response = await fetch(`/api/ops/calendar/${path}?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function appendProperties(params: URLSearchParams, properties?: readonly string[] | null) {
  for (const name of properties ?? []) params.append("property", name);
}

export async function fetchPriceJobStatus(jobId: string): Promise<PriceJobStatus | null> {
  return getJson<PriceJobStatus | null>("job-status", new URLSearchParams({ jobId }));
}

export async function fetchOpsSendLog(args: { before?: string | null }): Promise<OpsSendLogResult> {
  const params = new URLSearchParams();
  if (args.before) params.set("before", args.before);
  return (await getJson<OpsSendLogResult>("send-log", params)) ?? { error: "failed", ok: false };
}

export async function fetchOpsCellHistory(args: { roomIds: string[]; date: string }): Promise<OpsCellHistoryResult> {
  const params = new URLSearchParams({ date: args.date, roomIds: args.roomIds.join(",") });
  return (await getJson<OpsCellHistoryResult>("cell-history", params)) ?? { error: "failed", ok: false };
}

export async function fetchOpsPriceConversions(args: {
  properties?: readonly string[] | null;
  start: string;
  days: number;
}): Promise<OpsPriceConversionsResult> {
  const params = new URLSearchParams({ days: String(args.days), start: args.start });
  appendProperties(params, args.properties);
  return (await getJson<OpsPriceConversionsResult>("price-conversions", params)) ?? { error: "failed", ok: false };
}

export async function fetchOpsRecentBookings(args: {
  properties?: readonly string[] | null;
  start: string;
  days: number;
  from?: string | null;
  to?: string | null;
}): Promise<OpsRecentBookingsResult> {
  const params = new URLSearchParams({ days: String(args.days), start: args.start });
  if (args.from) params.set("from", args.from);
  if (args.to) params.set("to", args.to);
  appendProperties(params, args.properties);
  return (await getJson<OpsRecentBookingsResult>("recent-bookings", params)) ?? { error: "failed", ok: false };
}
