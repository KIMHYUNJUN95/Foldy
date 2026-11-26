/**
 * 받은 Beds24 **가격** 배달을 **다른 수신처로 그대로 넘긴다** (선택 기능, 기본 꺼짐).
 * 예약 배달(손님 정보)은 넘기지 않는다 — 라우트가 가격 신호가 있을 때만 부른다(2026-11-26).
 *
 * ## 왜 필요한가
 *
 * Beds24 의 **재고(가격) 웹훅** URL 칸은 프로퍼티당 **한 줄만** 받는다 — 예약 웹훅 칸이
 * `\r\n` 으로 3개를 받는 것과 다르다(2026-09-25 실측). 그래서 가격 알림은 **주인이 하나**다.
 *
 * 지금 그 자리는 저쪽 프로젝트(STAY ARI Manager 의 Firebase `priceWebhook`)가 갖고 있다.
 * 전환일에 우리가 그 자리를 받되, 저쪽은 정리가 끝날 때까지 계속 살아 있어야 한다.
 * 없어질 쪽이 주인을 쥐고 있으면 **저쪽을 내리는 날 가격 웹훅이 같이 죽고**, 그 시점에
 * Beds24 설정을 9개 건물 다시 만져야 한다. 우리가 주인이고 저쪽으로 넘겨주면 그럴 일이 없다.
 *
 * ```
 * 지금 (변수 없음)     Beds24 ──▶ 저쪽              우리는 관여하지 않는다
 * 전환일 (변수 설정)   Beds24 ──▶ 우리 ──▶ 저쪽      저쪽은 지금과 동일하게 동작한다
 * 정리 후 (변수 삭제)  Beds24 ──▶ 우리
 * ```
 *
 * **정리는 환경변수를 지우는 것으로 끝난다** — 코드 수정도, Beds24 설정 변경도 없다.
 *
 * ## 규칙 둘
 *
 * 1. **기다리지 않는다.** 저쪽이 느리거나 죽어도 우리 응답이 늦어지면 안 된다. Beds24 는
 *    응답이 늦으면 재배달하고, 재배달은 다시 저쪽으로 넘어가 눈덩이가 된다.
 * 2. **우리 시크릿을 넘기지 않는다.** 전달 URL 에서 `secret` 질의 파라미터를 뺀다 —
 *    저쪽은 시크릿을 요구하지 않고, 남의 주소로 우리 시크릿이 나갈 이유도 없다.
 */

/** 전달 대상. 줄바꿈 또는 쉼표로 여러 개 — Beds24 의 예약 웹훅 칸과 같은 관례를 따른다. */
export function parseForwardTargets(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && /^https?:\/\//i.test(value));
}

/**
 * 전달 URL 을 만든다 — 들어온 질의 파라미터를 그대로 옮기되 `secret` 만 뺀다.
 *
 * 재고 웹훅은 `GET ?roomId=…&action=…&propId=…` 로 오므로 **파라미터가 곧 페이로드**다.
 * 여기서 빠뜨리면 저쪽은 어느 방이 바뀌었는지 모른다.
 */
export function buildForwardUrl(target: string, incoming: URLSearchParams): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return target;
  }
  for (const [key, value] of incoming) {
    if (key.toLowerCase() === "secret") continue;
    url.searchParams.append(key, value);
  }
  return url.toString();
}

export type ForwardOutcome = { target: string; ok: boolean; status: number | null; error?: string };

/** 저쪽이 느려도 우리가 붙잡히지 않도록. 넘기는 건 부수 작업이다. */
export const WEBHOOK_FORWARD_TIMEOUT_MS = 10_000;

/**
 * 배달을 전달한다. **절대 던지지 않는다** — 전달 실패는 우리 처리의 실패가 아니다.
 *
 * 전달이 빠져도 양쪽 모두 주기 동기화가 따로 돈다(저쪽 `scheduledBeds24PriceSync` 15분,
 * 우리 `rates-sync` 15분). 웹훅은 「즉시」를 위한 것이지 유일한 경로가 아니다.
 */
export async function forwardBeds24Delivery(args: {
  targets: string[];
  method: "GET" | "POST";
  search: URLSearchParams;
  rawBody?: string;
  contentType?: string | null;
}): Promise<ForwardOutcome[]> {
  if (args.targets.length === 0) return [];

  return Promise.all(
    args.targets.map(async (target): Promise<ForwardOutcome> => {
      const url = buildForwardUrl(target, args.search);
      try {
        const response = await fetch(url, {
          method: args.method,
          headers:
            args.method === "POST"
              ? { "content-type": args.contentType ?? "application/json" }
              : undefined,
          body: args.method === "POST" ? (args.rawBody ?? "") : undefined,
          signal: AbortSignal.timeout(WEBHOOK_FORWARD_TIMEOUT_MS),
          cache: "no-store",
        });
        return { target, ok: response.ok, status: response.status };
      } catch (error) {
        // 주소 전체는 남기지 않는다 — 경로에 토큰이 들어 있을 수 있다.
        return {
          target,
          ok: false,
          status: null,
          error: error instanceof Error ? error.name : "unknown",
        };
      }
    }),
  );
}
