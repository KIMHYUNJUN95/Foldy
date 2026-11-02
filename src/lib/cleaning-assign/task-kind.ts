/** 「오늘 내 방」 청소 종류 · 시작 막기 규칙 — 화면과 서버가 같이 쓰는 순수 모듈. docs/product/37 「4-3」 */

/** 오늘 내 방 시작 종류 — `cleaning_sessions.task_label` 에 그대로 들어간다. */
export type TodayTaskKey = "checkout" | "simple" | "long_stay";

export type StayKeys = {
  /** 어제 이전 체크인 · 오늘 이후 체크아웃 — 오늘 밤도 묵는 방(물리 방 키). */
  staying: ReadonlySet<string>;
  /** 오늘 체크인하는 방(물리 방 키). */
  arriving: ReadonlySet<string>;
};

/**
 * 오늘 내 방에서 시작하는 청소 종류 — 예약을 보고 서버가 정한다(2026-11-02 점검 결정 ②).
 *
 * 예전엔 오늘 내 방의 시작이 늘 `checkout` 이라, 손님이 계속 묵는 방의 장기 투숙 청소나
 * 오늘 들어오는 방의 간단 청소도 기록 · 통계에 체크아웃 청소로 쌓였다.
 * - 체크아웃 방(`checkout`) → `checkout` — 그날 손님이 나간 방이다.
 * - 밀려 온 방(`carry`, 지난 날 못 한 방) → 그 사이 새 손님이 들어와 오늘 밤도 묵으면 `long_stay`, 아니면 `checkout`
 *   (2026-11-02 사용자 결정 — 오늘 체크인이면 손님이 오기 전 체크아웃 청소로 끝낸다).
 * - 수기 추가 방(`extra`) → 오늘 밤에도 손님이 있으면(묵는 중 · 오늘 체크인) 아래, 없으면 `checkout`.
 *   - 어제 이전에 들어와 오늘 밤도 묵는 손님 → `long_stay`(장기 투숙 청소)
 *   - 오늘 체크인(앞 손님 없음) → `simple`(간단 청소)
 * docs/product/07-cleaning-workflow.md 「오늘 내 방」 · 37 「4-3」
 */
export function todayTaskKey(room: { source: "checkout" | "extra" | "carry"; roomKey: string }, stay: StayKeys): TodayTaskKey {
  if (room.source === "checkout") return "checkout";
  if (room.source === "carry") return stay.staying.has(room.roomKey) ? "long_stay" : "checkout";
  if (stay.staying.has(room.roomKey)) return "long_stay";
  if (stay.arriving.has(room.roomKey)) return "simple";
  return "checkout";
}

/** 오늘 청소하지 않는 이유 — 예약이 바뀌어 목록에서 빠짐 · 관리자가 미룸 · 관리자가 처리 끝. */
export type TodaySkipReason = "booking" | "held" | "resolved";

/**
 * 「오늘 내 방」에서 시작을 막는 이유 — 화면(흐린 줄 · 문구)과 서버(`startMyRoom` 거절)가 이 함수 하나를 쓴다.
 * - 처리 끝(`resolvedHold`)인데 실제 청소 기록이 없으면 `resolved`(끝난 방으로 세지 않는다).
 * - 아직 시작 전(`pending`)일 때만: 목록에서 빠짐(`changed`) → `booking`, 미룸(`deferredUntil`) → `held`.
 * 이미 시작 · 끝낸 기록이 있으면 막지 않는다(끝내기 · 기록 보기는 된다).
 */
export function todaySkipReason(room: {
  changed: boolean;
  deferredUntil: string | null;
  resolvedHold: boolean;
  status: "pending" | "progress" | "done";
  hasSession: boolean;
}): TodaySkipReason | null {
  const hold = holdSkipReason(room);
  if (hold === "resolved" && !room.hasSession) return "resolved";
  if (room.status !== "pending") return null;
  if (room.changed) return "booking";
  return hold === "held" ? "held" : null;
}

/**
 * 관리자 표시(미룸 · 처리 끝)만 본 이유 — 서버 `startMyRoom` 이 시작 직전에 쓴다(시작하려는 순간이라 기록 · 상태는 볼 필요가 없다).
 * `todaySkipReason` 도 이 함수로 판단해 화면과 서버가 같은 규칙을 쓴다.
 */
export function holdSkipReason(room: { deferredUntil: string | null; resolvedHold: boolean }): "held" | "resolved" | null {
  if (room.resolvedHold) return "resolved";
  if (room.deferredUntil) return "held";
  return null;
}
