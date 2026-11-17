import type { AutomationDestination } from "@/lib/automation/jobs";

/**
 * 켜기 판정 · 연결 안 된 채널 줄 — 화면(확인 창)과 서버 액션이 **같은 함수**를 쓴다(2026-11-17).
 * 화면에서만 막으면 막은 게 아니다(CLAUDE.md §6) — `setAutomationEnabled` 가 같은 판정으로 다시 막는다.
 */

/**
 * **실제로 나가는** 받는 곳 수 — 연결된 채널(`knownChannelKeys`)이고 체크한 언어가 하나 이상인 줄만 센다.
 * 연결 안 된 채널 줄은 센다고 해도 보낼 수 없어 「받는 곳 N곳」이 거짓말이 된다. 화면 · 서버 판정은 모두 이 함수 하나다.
 */
export function effectiveDestinations(destinations: readonly AutomationDestination[], knownChannelKeys: readonly string[]): AutomationDestination[] {
  const known = new Set(knownChannelKeys);
  return destinations.filter((item) => known.has(item.channelKey) && item.locales.length > 0);
}

export function effectiveRecipientCount(destinations: readonly AutomationDestination[], knownChannelKeys: readonly string[]): number {
  return effectiveDestinations(destinations, knownChannelKeys).length;
}

/** 실제로 나가는 메시지 통수 — 나가는 곳마다 체크한 언어 수의 합. 「받는 곳 N곳 · 메시지 N통」은 이 기준이다. */
export function effectiveMessageCount(destinations: readonly AutomationDestination[], knownChannelKeys: readonly string[]): number {
  return effectiveDestinations(destinations, knownChannelKeys).reduce((sum, item) => sum + item.locales.length, 0);
}

/** 실제로 나갈 곳이 하나도 없으면 켤 수 없다(저장도 켜진 채로는 못 한다). */
export function canEnableAutomation(
  destinations: readonly AutomationDestination[],
  knownChannelKeys: readonly string[],
): { ok: true; count: number } | { ok: false; error: "no_destination"; count: 0 } {
  const count = effectiveRecipientCount(destinations, knownChannelKeys);
  return count > 0 ? { count, ok: true } : { count: 0, error: "no_destination", ok: false };
}

/**
 * 저장돼 있지만 지금 연결된 채널(환경변수)에 없는 받는 곳 — 설정 화면이 「연결 안 된 채널」 줄로 보여 주고 지울 수 있게 한다.
 * 채널 줄만 도는 화면에서는 이런 받는 곳이 보이지도 지워지지도 않아 「받는 곳 N곳」이 영영 남았다.
 */
export function orphanDestinations(
  destinations: readonly AutomationDestination[],
  knownChannelKeys: readonly string[],
): AutomationDestination[] {
  const known = new Set(knownChannelKeys);
  return destinations.filter((item) => !known.has(item.channelKey));
}
