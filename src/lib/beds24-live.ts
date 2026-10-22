/**
 * Beds24 실시간 신호 — 서버와 브라우저가 같이 쓰는 이름. **순수하다.**
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「화면도 웹훅 기준으로」
 *
 * Beds24 데이터(예약·요금·차단)가 우리 표에 들어오면 서버가 조직 채널로 **신호 하나**를 보낸다
 * (Supabase Realtime broadcast). 신호에는 데이터가 없다 — 「바뀌었다」뿐이다. 받은 화면은 서버
 * 컴포넌트를 다시 불러(`router.refresh()`) 평소와 같은 권한·조직 검사로 새 값을 읽는다.
 *
 * 표마다 postgres 변경 알림을 켜지 않는 이유: 재고 웹훅 한 번에 요금 12개월(건물당 ~9,500행)을
 * 다시 쓰므로 알림이 행 수만큼 쏟아진다.
 */

import { getCanonicalPropertyName } from "@/lib/room-label-normalization";

export const BEDS24_LIVE_EVENT = "changed";

/** `cleaning_assign` — Beds24 가 아니라 청소 배정 · 시프트 신청(같은 조직 채널을 같이 쓴다, `src/lib/cleaning-assign/live.ts`). */
export type Beds24LiveKind = "reservations" | "rates" | "blocks" | "cleaning_assign";

/** `kinds` 를 안 준 화면이 받는 종류 — Beds24 데이터만(배정 신호로 다시 읽지 않게). */
export const BEDS24_DATA_KINDS: readonly Beds24LiveKind[] = ["reservations", "rates", "blocks"];

/**
 * 신호가 **어디를** 바꿨는지 / 화면이 **어디를** 보여주는지. 둘 다 선택이다 — 없는 쪽은 「전부」다.
 *
 * - `propertyNames`: 우리 건물 이름(표시 이름이든 DB 이름이든 — 비교 전에 정규화한다). 빈 배열도 「전부」.
 * - `from` · `to`: `YYYY-MM-DD`, **양끝 포함**. 한쪽만 있으면 그쪽만 막힌 구간이다.
 *
 * 걸러내기일 뿐 속도 제한이 아니다 — 겹치는 신호는 전부 그대로 새로고침으로 간다.
 */
export type Beds24LiveScope = {
  propertyNames?: string[] | null;
  from?: string | null;
  to?: string | null;
};

export type Beds24LivePayload = {
  at: number;
  kind: Beds24LiveKind;
  scope?: Beds24LiveScope | null;
};

/** 신호 범위와 화면 범위가 겹치는가. 어느 쪽이든 모르면 겹친다고 본다(놓치는 것보다 한 번 더 읽는 게 낫다). */
export function beds24LiveScopesOverlap(
  signal: Beds24LiveScope | null | undefined,
  view: Beds24LiveScope | null | undefined,
): boolean {
  if (!signal || !view) return true;

  const signalProperties = signal.propertyNames?.filter(Boolean) ?? [];
  const viewProperties = view.propertyNames?.filter(Boolean) ?? [];
  if (signalProperties.length > 0 && viewProperties.length > 0) {
    const wanted = new Set(viewProperties.map(getCanonicalPropertyName));
    if (!signalProperties.some((name) => wanted.has(getCanonicalPropertyName(name)))) return false;
  }

  if (signal.from && view.to && signal.from > view.to) return false;
  if (signal.to && view.from && signal.to < view.from) return false;
  return true;
}

/**
 * 채널은 **private** 다(2026-09-30). 구독은 `realtime.messages` RLS 가 그 조직의 active 멤버만 허용하고
 * (`supabase/migrations/202609300006_beds24_live_private_channel.sql`), 송신은 서버 service role 만 한다.
 * 브라우저는 구독 **전에** `supabase.realtime.setAuth()` 를 기다려야 첫 join 에 사용자 JWT 가 실린다.
 */
export const BEDS24_LIVE_CHANNEL_OPTIONS = { config: { private: true } } as const;

export function beds24LiveTopic(organizationId: string): string {
  return `beds24-live:${organizationId}`;
}
