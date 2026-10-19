import { NextResponse, type NextRequest } from "next/server";
import {
  fetchFirestoreCollection,
  fetchFirestoreCollectionSince,
  type FirestoreRecord,
} from "@/lib/recruit/firestore";
import {
  firestoreAuthState,
  hasFirestoreServiceAccount,
  type FirestoreAuthState,
} from "@/lib/recruit/firestore-auth";
import { ingestJobApplication } from "@/lib/recruit/ingest";
import type { RecruitSource } from "@/lib/recruit/payload";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

/**
 * 채용 지원서 당겨오기 (2026-09-09).
 *
 * **왜 push 가 아니라 pull 인가.** 문서는 채용 사이트에 `onApplicationCreated` Cloud Function 이
 * 이미 돌고 있다고 적어 두었지만, 저장소를 확인하니 **함수가 존재하지 않는다**(`functions/` 없음,
 * `firebase.json` 은 hosting 만). 지원서는 브라우저가 Firestore 에 직접 쓴다
 * (`ApplicationPage.tsx` → `addDoc`). 함수를 새로 만들려면 Firebase Blaze(카드 등록)가 필요해
 * 「무료」 조건과 충돌한다. 그래서 Foldy 가 당겨온다.
 *
 * 변환은 `ingestJobApplication` 을 그대로 쓴다 — 웹훅·백필과 **같은 코드**다. 나중에 Cloud Function
 * 을 붙여도 재전송이 안전하므로(유니크 + 지원자 정보만 갱신) 두 경로가 겹쳐도 중복이 생기지 않는다.
 *
 * **최신분은 시크릿이 없다(전량은 있다 — `authorizeFullSync`).** 이 경로는 외부 입력을 받지 않는다 — 하는 일이 「공개 Firestore 를 읽어 우리
 * DB 에 넣는다」로 고정이라 호출자가 데이터를 위조할 수 없다. 남는 위험은 남용(Firestore 무료 읽기
 * 한도 소진)이고, `recruit_sync_state` 의 마지막 실행 시각으로 창을 두어 막는다. 창 안의 재호출은
 * **Firestore 를 읽지 않고** 돌아간다.
 *
 * 모드:
 *   POST /api/recruit/sync           마지막 성공 이후에 생긴 것만 (기본, 5분 주기 · 콘솔 열 때)
 *   POST /api/recruit/sync?mode=full 전량 훑기 (하루 1회) — 조건 조회에서 빠지는 구 문서까지 줍는다
 *
 * **평소에는 거의 아무것도 읽지 않는다.** 처음에는 5분마다 최신 50건을 통째로 다시 읽었는데,
 * 지원이 하루 한두 건이라 그 중 99% 는 「이미 갖고 있는 걸 또 읽어 또 덮어쓰는」 일이었다
 * (하루 14,400건 = Firestore 무료 읽기의 30%). 조건 조회로 바꿔 새 문서가 없으면 0건이 온다.
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 한 번에 가져올 문서 수 상한.
 *
 * 평소 경로는 조건 조회라 실제로는 0~1건이 온다. 이 값은 「기준 시각이 한참 뒤로 밀려 있을 때」
 * (오래 멈춰 있었거나 첫 실행) 한 번에 다 삼키지 않기 위한 안전판이다. 넘치는 분량은 다음 실행이
 * 이어받고, 하루 1회 전량 훑기가 최종 안전망이다.
 */
const RECENT_LIMIT = 50;

/**
 * 이 창 안의 재호출은 Firestore 를 읽지 않는다.
 *
 * 5분 주기 크론(300초)보다 짧아야 크론이 헛돌지 않고, 콘솔을 여러 명이 동시에 열어도 읽기가
 * 폭주하지 않을 만큼은 길어야 한다.
 */
const THROTTLE_SECONDS = 60;

/**
 * 조건 조회의 기준 시각을 이만큼 앞으로 당긴다.
 *
 * 기준은 우리 서버의 마지막 성공 시각이고 `createdAt` 은 Firestore 서버가 찍는다 — 시계가 정확히
 * 같지 않고, 동기화가 도는 중에 저장된 문서도 있다. 딱 잘라 보면 그런 문서를 영원히 놓친다.
 * 겹침이 있으면 같은 문서를 한두 번 더 읽을 뿐이고(수신은 재전송에 안전하다), 지원이 하루 한두
 * 건이라 그 비용은 사실상 0이다.
 */
const SINCE_OVERLAP_MINUTES = 10;

type SyncSummary = {
  mode: "recent" | "full";
  created: number;
  updated: number;
  read: number;
  /** 지워진 지원서라 다시 넣지 않은 건수. */
  skippedDeleted: number;
  /**
   * Firestore 를 어떤 자격으로 읽었는가.
   *
   * 규칙을 잠그는 전환에서 이 값이 유일한 확인 수단이다 — 키를 넣기 전에는 `anonymous`,
   * 넣은 뒤에는 `service_account` 여야 한다. 이걸 보지 않으면 「잠갔는데 왜 되지?」(아직 공개)나
   * 「키를 넣었는데 왜 안 되지?」(형식 오류)를 구분할 수 없다.
   */
  auth: "service_account" | "anonymous";
  /** 인증이 안 걸렸을 때 왜인지 — 미설정인지, 값이 깨졌는지. 값 자체는 노출하지 않는다. */
  authState: FirestoreAuthState;
  /** 조건 조회의 기준 시각. 없으면 조건 없이 읽었다는 뜻이다(첫 실행 또는 전량 훑기). */
  since?: string;
  failed: { source: string; docId: string; error: string }[];
};

/** 구 폼 컬렉션. 새로 들어오지 않으므로 전량 훑기에서만 본다. */
const LEGACY_SOURCE: RecruitSource = "applicants";

async function readState() {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("recruit_sync_state")
    .select("last_run_at, last_success_at")
    .eq("id", true)
    .maybeSingle();
  // 읽기 실패는 「스로틀 없음」으로 흘러가므로 조용하면 안 된다. 처음 배포에서 grant 누락으로
  // 이 자리가 계속 실패했고, 오류를 삼키고 있어 스로틀이 안 걸리는 것을 늦게 알아챘다.
  if (error) console.warn("[recruit/sync] state read failed:", error.message);
  return { lastRunAt: data?.last_run_at ?? null, lastSuccessAt: data?.last_success_at ?? null };
}

async function writeState(args: { ok: boolean; result: Json }) {
  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();
  // 기록 실패가 동기화 자체를 실패로 만들지 않는다. 본래 일은 이미 끝났다.
  const { error } = await supabase.from("recruit_sync_state").upsert({
    id: true,
    last_run_at: now,
    ...(args.ok ? { last_success_at: now } : {}),
    last_result: args.result,
    updated_at: now,
  });
  if (error) console.warn("[recruit/sync] state write failed:", error.message);
}

async function ingestAll(records: FirestoreRecord[], source: RecruitSource, summary: SyncSummary) {
  for (const record of records) {
    const result = await ingestJobApplication({
      source,
      externalId: record.docId,
      document: record.document,
    });
    if (result.ok) {
      // 지운 지원서는 다시 넣지 않는다. 조용히 넘기지 말고 세어 둔다 — 「왜 안 들어오지」를
      // 나중에 되짚을 수 있어야 한다.
      if ("skipped" in result) summary.skippedDeleted += 1;
      else if (result.created) summary.created += 1;
      else summary.updated += 1;
    } else {
      summary.failed.push({ source, docId: record.docId, error: result.error });
    }
  }
}

/**
 * 전량 훑기(`?mode=full`)만 시크릿을 받는다 (2026-10-19).
 *
 * 최신분 호출은 콘솔을 열 때도 부르고 60초 창이 남용을 막지만, 전량 훑기는 창이 없어 반복 호출로 Firestore 무료
 * 읽기를 소진시킬 수 있었다. 다른 크론과 같은 비밀값(`CRON_SECRET` 또는 `BEDS24_WEBHOOK_SECRET`)을
 * `Authorization: Bearer` 나 `x-recruit-sync-secret` 헤더로 받는다. 서버에 둘 다 없으면 닫는다.
 */
function authorizeFullSync(request: NextRequest): boolean {
  const allowed = [process.env.CRON_SECRET?.trim(), process.env.BEDS24_WEBHOOK_SECRET?.trim()].filter(
    (value): value is string => Boolean(value),
  );
  if (allowed.length === 0) return false;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-recruit-sync-secret");
  return Boolean(provided) && allowed.includes(provided as string);
}

export async function POST(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "full" ? "full" : "recent";
  if (mode === "full" && !authorizeFullSync(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const apiKey = process.env.RECRUIT_FIRESTORE_API_KEY?.trim() || null;

  const { lastRunAt, lastSuccessAt } = await readState();
  if (lastRunAt) {
    const elapsed = (Date.now() - new Date(lastRunAt).getTime()) / 1000;
    // 전량 훑기는 하루 1회라 창을 적용하지 않는다 — 최신분 호출에 밀려 영원히 건너뛰면 안 된다.
    if (mode === "recent" && elapsed < THROTTLE_SECONDS) {
      return NextResponse.json({ ok: true, skipped: "throttled", elapsedSeconds: Math.round(elapsed) });
    }
  }

  const summary: SyncSummary = {
    mode,
    created: 0,
    updated: 0,
    read: 0,
    skippedDeleted: 0,
    auth: hasFirestoreServiceAccount() ? "service_account" : "anonymous",
    authState: firestoreAuthState(),
    failed: [],
  };

  try {
    if (mode === "full") {
      // 정렬 없이 전량. `createdAt` 이 없는 구 문서까지 잡으려면 정렬을 걸면 안 된다.
      const current = await fetchFirestoreCollection({ collection: "applications", apiKey });
      summary.read += current.length;
      await ingestAll(current, "applications", summary);

      try {
        const legacy = await fetchFirestoreCollection({ collection: LEGACY_SOURCE, apiKey });
        summary.read += legacy.length;
        await ingestAll(legacy, LEGACY_SOURCE, summary);
      } catch (error) {
        // 구 컬렉션이 사라졌을 수 있다. 한쪽이 없다고 전체를 실패로 만들지 않는다.
        console.warn("[recruit/sync] legacy collection skipped:", error);
      }
    } else if (lastSuccessAt) {
      // 평소 경로. 마지막 성공 이후에 생긴 것만 읽으므로, 새 지원서가 없으면 0건이 온다.
      const since = new Date(
        new Date(lastSuccessAt).getTime() - SINCE_OVERLAP_MINUTES * 60_000,
      ).toISOString();
      const fresh = await fetchFirestoreCollectionSince({
        collection: "applications",
        since,
        apiKey,
        limit: RECENT_LIMIT,
      });
      summary.since = since;
      summary.read += fresh.length;
      await ingestAll(fresh, "applications", summary);
    } else {
      // 성공 이력이 없다(첫 실행, 또는 상태 기록이 계속 실패 중). 기준 시각이 없으므로 최신
      // N건을 통째로 본다 — 조건 없이 읽는 유일한 경우다.
      const recent = await fetchFirestoreCollection({
        collection: "applications",
        apiKey,
        orderBy: "createdAt desc",
        limit: RECENT_LIMIT,
      });
      summary.read += recent.length;
      await ingestAll(recent, "applications", summary);
    }
  } catch (error) {
    // Firestore 를 못 읽었다. 규칙이 잠겼거나 프로젝트가 바뀐 경우다. **조용히 넘기지 않는다** —
    // 502 를 돌려줘야 크론이 빨간불이 되고, 「어제부터 지원서가 안 들어온다」를 사람이 알게 된다.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[recruit/sync] firestore read failed:", message);
    await writeState({ ok: false, result: { mode, error: message } });
    return NextResponse.json({ ok: false, error: "firestore_read_failed", detail: message }, { status: 502 });
  }

  await writeState({ ok: summary.failed.length === 0, result: summary as unknown as Json });

  return NextResponse.json({ ok: summary.failed.length === 0, ...summary });
}
