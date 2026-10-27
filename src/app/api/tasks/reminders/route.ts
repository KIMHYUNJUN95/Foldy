import { NextResponse, type NextRequest } from "next/server";
import { cleanupUnconfirmedSignups } from "@/lib/auth/unconfirmed-signup-cleanup";
import { cleanupExpiredIdDocuments, cleanupOrphanIdUploads } from "@/lib/staff-documents/retention";
import { runTaskReminders } from "@/lib/notifications/task-reminders";
import { runIdDocumentExpiryReminders } from "@/lib/notifications/id-document-reminders";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requestMatchesSecret } from "@/lib/api-secret";

// 할 일 / 공유 할 일의 일일 알림 평가기(마감 임박 + 기한 초과).
//
// 이 두 알림 유형은 본질적으로 시간 기반이라 사용자 동작이 트리거하지 않는다 —
// 그래서 저빈도 예약 평가가 필요하다. 이 엔드포인트가 그 용도로만 좁게 쓰인다:
// 오늘 이하가 기한인 활성 할 일을 훑어, 할 일마다 수신자별로 중복 제거된 알림 한 건씩
// 내보낸다. 범용 스케줄러/인스턴스 생성 엔진이 아니다. 정확한 규칙과 중복 제거 방식은
// `src/lib/notifications/task-reminders.ts` 를 본다.
//
// Vercel Cron 이 하루 한 번 호출한다(vercel.json 참고). CRON_SECRET 으로 인증해
// 익명 호출자가 트리거할 수 없다.
//
// 같은 하루 한 번에 「확인 안 된 오래된 가입 정리」도 돈다(2026-10-09) — 크론 칸을 하나 더 쓰지 않으려고 여기 붙였다.
// 알림과 서로 막지 않게 따로 감싼다(정리가 실패해도 알림 결과는 그대로 돌려준다).
// 「신분 서류 보관 기한 정리」(퇴사 3년 뒤 삭제, docs/product/41 §6)도 같은 이유로 여기 붙였다(2026-10-23).
// 「재류카드 만료 알림」(90 · 30일 전 · 만료, docs/product/41 「만료 알림」)도 같다(2026-10-23) — 조직 지정 실행이면 그 조직만.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return { ok: false, status: 404 };
  // 비교는 상수 시간 · 길이 무관(api-secret). 헤더와 쿼리 중 하나라도 맞으면 통과한다(2026-10-26).
  if (!requestMatchesSecret(request, [cronSecret], { query: true })) return { ok: false, status: 403 };
  return { ok: true };
}

function isUuid(value: string | null) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handle(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 404 ? "not_found" : "forbidden" },
      { status: auth.status },
    );
  }

  const organizationIdParam = request.nextUrl.searchParams.get("organizationId");
  if (organizationIdParam && !isUuid(organizationIdParam)) {
    return NextResponse.json({ ok: false, error: "invalid_organization_id" }, { status: 400 });
  }

  try {
    const service = getSupabaseServiceClient();
    const result = await runTaskReminders(service, {
      organizationId: organizationIdParam ?? undefined,
    });
    let signupCleanup: Awaited<ReturnType<typeof cleanupUnconfirmedSignups>> | { checked: false; error: string };
    try {
      signupCleanup = organizationIdParam ? { checked: false, error: "skipped_for_org_run" } : await cleanupUnconfirmedSignups(service);
    } catch (error) {
      console.error("[tasks/reminders] unconfirmed signup cleanup failed", error);
      signupCleanup = { checked: false, error: "cleanup_failed" };
    }
    let idDocumentCleanup: Awaited<ReturnType<typeof cleanupExpiredIdDocuments>> | { checked: false; error: string };
    try {
      idDocumentCleanup = organizationIdParam
        ? { checked: false, error: "skipped_for_org_run" }
        : await cleanupExpiredIdDocuments(service);
    } catch (error) {
      console.error("[tasks/reminders] id document retention cleanup failed", error);
      idDocumentCleanup = { checked: false, error: "cleanup_failed" };
    }
    let idUploadCleanup: Awaited<ReturnType<typeof cleanupOrphanIdUploads>> | { checked: false; error: string };
    try {
      idUploadCleanup = organizationIdParam
        ? { checked: false, error: "skipped_for_org_run" }
        : await cleanupOrphanIdUploads(service);
    } catch (error) {
      console.error("[tasks/reminders] orphan id upload cleanup failed", error);
      idUploadCleanup = { checked: false, error: "cleanup_failed" };
    }
    let idDocumentExpiry: Awaited<ReturnType<typeof runIdDocumentExpiryReminders>> | { checked: false; error: string };
    try {
      idDocumentExpiry = await runIdDocumentExpiryReminders(service, { organizationId: organizationIdParam ?? undefined });
    } catch (error) {
      console.error("[tasks/reminders] id document expiry reminders failed", error);
      idDocumentExpiry = { checked: false, error: "expiry_reminders_failed" };
    }
    return NextResponse.json({ ok: true, ...result, signupCleanup, idDocumentCleanup, idUploadCleanup, idDocumentExpiry });
  } catch (error) {
    console.error("[tasks/reminders] failed", error);
    return NextResponse.json({ ok: false, error: "reminders_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
