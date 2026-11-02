// 전 숙박지(前泊地) · 다음 행선지(行先地) — 신주쿠구 규칙 10 ⑦ · ⑧(43 §2). 시안 T3s(태블릿) · W3s(웹), 2026-11-02.
// 손님은 「어젯밤은 어디서?」 「나간 뒤엔 어디로?」에 두 갈래 + 도시로 답하고, 명부(guests.prev_stay · next_dest)에는
// 직원이 읽기 쉬운 짧은 일본어로 저장한다. 태블릿(Kotlin `RouteValue`)도 같은 값을 쓴다 — 바꾸면 둘 다 바꾼다.

export const ARRIVED_TODAY = "当日入国";
export const LEAVING_JAPAN = "出国";

/** 고르는 도시 — 키는 화면 문구 키(i18n `route.city.<key>`), 값은 명부에 적는 말. */
export const ROUTE_CITIES = { tokyo: "東京", osaka: "大阪", kyoto: "京都", fukuoka: "福岡" } as const;
export type RouteCity = keyof typeof ROUTE_CITIES;

export const ROUTE_TEXT_MAX = 60;

export type RouteChoice =
  | { kind: "border" } // 전: 오늘 일본 도착 / 다음: 일본을 떠남
  | { kind: "city"; city: RouteCity }
  | { kind: "other"; text: string };

export type RouteDirection = "prev" | "next";

/** 고른 것 → 명부 값. 직접 쓴 글은 앞뒤 공백을 지우고 60자로 자른다. 빈 글이면 null(아직 안 고름). */
export function routeValueOf(direction: RouteDirection, choice: RouteChoice): string | null {
  if (choice.kind === "border") return direction === "prev" ? ARRIVED_TODAY : LEAVING_JAPAN;
  if (choice.kind === "city") return ROUTE_CITIES[choice.city];
  const text = choice.text.replace(/\s+/g, " ").trim().slice(0, ROUTE_TEXT_MAX);
  return text ? text : null;
}

/** 명부 값 → 화면에서 고른 것(다시 열 때 · 동행자에게 대표자 값을 보여 줄 때). 모르는 값은 「직접 쓰기」로. */
export function routeChoiceOf(direction: RouteDirection, value: string | null | undefined): RouteChoice | null {
  const text = value?.trim();
  if (!text) return null;
  if (text === (direction === "prev" ? ARRIVED_TODAY : LEAVING_JAPAN)) return { kind: "border" };
  const city = (Object.keys(ROUTE_CITIES) as RouteCity[]).find((key) => ROUTE_CITIES[key] === text);
  return city ? { kind: "city", city } : { kind: "other", text };
}
