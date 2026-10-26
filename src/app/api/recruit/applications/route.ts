import { NextResponse, type NextRequest } from "next/server";
import { ingestJobApplication } from "@/lib/recruit/ingest";
import type { RecruitSource } from "@/lib/recruit/payload";
import { requestMatchesSecret } from "@/lib/api-secret";

/**
 * 채용 지원서 수신 엔드포인트 (2026-09-09).
 *
 * 보내는 쪽은 채용 사이트(haru-recruit)의 Cloud Function `onApplicationCreated` 다. 이미 지원서
 * 생성 시점에 실행되고 있어(현재는 Slack 알림), 거기에 이 호출만 덧붙인다. 백필도 같은 경로다.
 *
 * **브라우저에서 부르지 않는다.** 공유 시크릿이 번들에 노출되기 때문이다. 반드시 함수(서버)에서만
 * 호출한다.
 *
 * 계약:
 *   POST /api/recruit/applications
 *   Header: x-recruit-webhook-secret: <RECRUIT_WEBHOOK_SECRET>
 *   Body:   { source?: "applications" | "applicants",
 *             docId: string,
 *             document: { ...Firestore 문서 그대로 } }
 *           또는 여러 건: { items: [{ docId, document, source? }, ...] }
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

export const dynamic = "force-dynamic";

const SOURCES: readonly RecruitSource[] = ["applications", "applicants"];

// 시크릿 비교는 공용 헬퍼(api-secret)가 상수 시간 · 길이 무관으로 한다 — 앞글자부터 다르면 즉시 반환하는
// `===` 는 응답 시간으로 정답 접두사를 흘린다(공개 URL 이라 시도 횟수 제한 없음).

type Item = { source: RecruitSource; docId: string; document: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readItem(raw: unknown, fallbackSource: RecruitSource): Item | null {
  if (!isRecord(raw)) return null;
  const docId = typeof raw.docId === "string" ? raw.docId.trim() : "";
  const document = isRecord(raw.document) ? raw.document : null;
  if (!docId || !document) return null;
  const source =
    typeof raw.source === "string" && (SOURCES as readonly string[]).includes(raw.source)
      ? (raw.source as RecruitSource)
      : fallbackSource;
  return { source, docId, document };
}

export async function POST(request: NextRequest) {
  const requiredSecret = process.env.RECRUIT_WEBHOOK_SECRET?.trim();
  // 시크릿이 설정되지 않았으면 **열어 두지 않고 막는다.** Beds24 웹훅은 설정 전 배포를 견디려고
  // 미설정 시 통과시키지만, 이쪽은 개인정보가 들어오는 입구라 기본값이 거부여야 한다.
  if (!requiredSecret) {
    console.error("[recruit/webhook] RECRUIT_WEBHOOK_SECRET is not set — rejecting delivery");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  if (!requestMatchesSecret(request, [requiredSecret], { headers: ["x-recruit-webhook-secret"] })) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const fallbackSource =
    typeof body.source === "string" && (SOURCES as readonly string[]).includes(body.source)
      ? (body.source as RecruitSource)
      : "applications";

  const rawItems = Array.isArray(body.items) ? body.items : [body];
  const items = rawItems.map((raw) => readItem(raw, fallbackSource)).filter((v): v is Item => v !== null);

  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "no_items" }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  // 지워진 지원서는 되살리지 않는다. 재전송이 와도 마찬가지다.
  let skippedDeleted = 0;
  const failed: { docId: string; error: string }[] = [];

  for (const item of items) {
    const result = await ingestJobApplication({
      source: item.source,
      externalId: item.docId,
      document: item.document,
    });
    if (result.ok) {
      if ("skipped" in result) skippedDeleted += 1;
      else if (result.created) created += 1;
      else updated += 1;
    } else {
      failed.push({ docId: item.docId, error: result.error });
    }
  }

  // 일부만 실패해도 200 으로 답한다 — 성공한 건까지 재전송되면 무의미한 중복 처리가 생긴다.
  // 실패 목록은 응답에 담아 보내는 쪽 로그에 남게 한다.
  if (failed.length > 0) {
    console.error("[recruit/webhook] some items failed:", failed);
  }
  return NextResponse.json(
    { ok: failed.length === 0, created, updated, skippedDeleted, failed },
    { status: 200 },
  );
}
