import { NextResponse, type NextRequest } from "next/server";
import {
  readOpsCellHistoryFor,
  readOpsPriceConversionsFor,
  readOpsRecentBookingsFor,
  readOpsSendLog,
  readPriceJobStatus,
} from "../reads";
import { getOpsReadSession } from "../route-auth";

/**
 * 판매 캘린더 읽기 전용 조회 — 작업 상태 · 전송 기록 · 칸 이력 · 가격 개입 · 최근 예약.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md → 「읽기는 서버 액션 큐 밖」
 *
 * 서버 액션은 한 줄로 하나씩 처리돼 폴링이 사용자의 저장 · 예약 열기를 막았다. GET 은 병렬로 돈다.
 * 클라이언트: `src/components/admin/ops/ops-reads.ts`.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: NO_STORE, status });
}

function intParam(value: string | null) {
  if (value === null || value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export async function GET(request: NextRequest, context: { params: Promise<{ read: string }> }) {
  const { read } = await context.params;
  const session = await getOpsReadSession();
  if (!session) return json({ error: "forbidden", ok: false }, 403);

  const query = request.nextUrl.searchParams;
  const properties = query.getAll("property");

  switch (read) {
    case "job-status": {
      const jobId = query.get("jobId") ?? "";
      if (!jobId) return json(null);
      return json(await readPriceJobStatus(session, jobId));
    }
    case "send-log":
      return json(await readOpsSendLog(session, { before: query.get("before") }));
    case "cell-history":
      return json(
        await readOpsCellHistoryFor(session, {
          date: query.get("date") ?? "",
          roomIds: (query.get("roomIds") ?? "").split(",").filter(Boolean),
        }),
      );
    case "price-conversions":
      return json(
        await readOpsPriceConversionsFor(session, {
          days: intParam(query.get("days")),
          properties,
          start: query.get("start") ?? "",
        }),
      );
    case "recent-bookings":
      return json(
        await readOpsRecentBookingsFor(session, {
          days: intParam(query.get("days")),
          from: query.get("from"),
          properties,
          start: query.get("start") ?? "",
          to: query.get("to"),
        }),
      );
    default:
      return json({ error: "not_found", ok: false }, 404);
  }
}
