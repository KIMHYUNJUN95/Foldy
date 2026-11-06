import type { AcceptStaffCallErrorKey, RingingStaffCall } from "./staff-call";

// 직원 앱 수신 흐름 — 울림 → 받기 → 통화 → 끝. 브라우저 · 서버와 무관한 순수 reducer. docs/product/46 §2 · §6.

// 서버 소식이 끊겨도 벨이 멈추게 하는 안전장치. 기기 시계가 틀릴 수 있어 마감 시각이 아니라 처음 본 때부터 잰다.
export const RING_LOCAL_LIMIT_MS = 50_000;
// 태블릿은 방 입장에 20초까지 기다린다 — 그보다 넉넉히.
export const GUEST_ABSENT_LIMIT_MS = 30_000;
// 응답이 안 오면 전체 화면에 갇힌다 — 전화기처럼 곧바로 포기하고 안내한다.
export const ACCEPT_TIMEOUT_MS = 10_000;
export const FORBIDDEN_LIMIT_MS = 30_000;

export type StaffCallNotice = "taken" | "expired" | "unavailable" | "failed" | "ended" | "lost";

export type StaffCallScreen =
  | { kind: "idle" }
  | { kind: "ringing"; call: RingingStaffCall; seenAtMs: number }
  | { kind: "connecting"; call: RingingStaffCall; stayId: string | null; canViewStay: boolean; accepted: boolean }
  | { kind: "active"; call: RingingStaffCall; stayId: string | null; canViewStay: boolean; startedAtMs: number }
  | { kind: "notice"; call: RingingStaffCall; notice: StaffCallNotice };

export type StaffCallFlow = {
  screen: StaffCallScreen;
  /** 다시 울리면 안 되는 호출 — 내가 닫았거나 받기를 시도한 호출. */
  handled: readonly string[];
};

export type StaffCallFlowEvent =
  | { type: "ring_list"; calls: readonly RingingStaffCall[]; nowMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "dismiss"; id: string }
  /** 알림 줄을 눌렀다 — 닫아 둔 호출을 다시 울릴 수 있게 한다. 끝난 호출이면 목록에 없어 아무 일도 없다. */
  | { type: "reopen"; id: string }
  | { type: "accept_start"; id: string }
  | { type: "accept_ok"; stayId: string | null; canViewStay: boolean }
  | { type: "accept_failed"; errorKey: AcceptStaffCallErrorKey }
  | { type: "room_connected"; nowMs: number }
  | { type: "remote_ended" }
  | { type: "connection_lost" }
  | { type: "local_end" }
  | { type: "notice_done" };

export const INITIAL_STAFF_CALL_FLOW: StaffCallFlow = { screen: { kind: "idle" }, handled: [] };

const IDLE: StaffCallScreen = { kind: "idle" };

function noticeOfAcceptError(errorKey: AcceptStaffCallErrorKey): StaffCallNotice {
  switch (errorKey) {
    case "already_taken":
      return "taken";
    case "expired":
      return "expired";
    case "unconfigured":
    case "not_ready":
      return "unavailable";
    default:
      return "failed";
  }
}

function withHandled(handled: readonly string[], id: string): readonly string[] {
  return handled.includes(id) ? handled : [...handled, id];
}

export function staffCallFlowReducer(flow: StaffCallFlow, event: StaffCallFlowEvent): StaffCallFlow {
  const { screen } = flow;
  switch (event.type) {
    case "ring_list": {
      if (screen.kind !== "idle" && screen.kind !== "ringing") return flow;
      // 끝난 호출의 기록은 버린다 — id 는 다시 오지 않으니 쌓아 둘 까닭이 없다.
      const handled = flow.handled.filter((id) => event.calls.some((call) => call.id === id));
      if (screen.kind === "ringing") {
        const same = event.calls.find((call) => call.id === screen.call.id);
        if (same) return { handled, screen: { ...screen, call: same } };
      }
      const next = event.calls.find((call) => !handled.includes(call.id));
      return { handled, screen: next ? { kind: "ringing", call: next, seenAtMs: event.nowMs } : IDLE };
    }
    case "tick":
      if (screen.kind === "ringing" && event.nowMs - screen.seenAtMs > RING_LOCAL_LIMIT_MS) {
        return { handled: withHandled(flow.handled, screen.call.id), screen: IDLE };
      }
      return flow;
    case "dismiss":
      if (screen.kind === "ringing" && screen.call.id === event.id) {
        return { handled: withHandled(flow.handled, event.id), screen: IDLE };
      }
      return flow;
    case "reopen":
      return { ...flow, handled: flow.handled.filter((id) => id !== event.id) };
    case "accept_start":
      if (screen.kind === "ringing" && screen.call.id === event.id) {
        return {
          handled: withHandled(flow.handled, event.id),
          screen: { kind: "connecting", call: screen.call, stayId: null, canViewStay: false, accepted: false },
        };
      }
      return flow;
    case "accept_ok":
      if (screen.kind !== "connecting") return flow;
      return { ...flow, screen: { ...screen, stayId: event.stayId, canViewStay: event.canViewStay, accepted: true } };
    case "accept_failed":
      if (screen.kind !== "connecting") return flow;
      return { ...flow, screen: { kind: "notice", call: screen.call, notice: noticeOfAcceptError(event.errorKey) } };
    case "room_connected":
      if (screen.kind !== "connecting") return flow;
      return {
        ...flow,
        screen: { kind: "active", call: screen.call, stayId: screen.stayId, canViewStay: screen.canViewStay, startedAtMs: event.nowMs },
      };
    case "remote_ended":
    case "connection_lost":
      if (screen.kind !== "connecting" && screen.kind !== "active") return flow;
      return { ...flow, screen: { kind: "notice", call: screen.call, notice: event.type === "remote_ended" ? "ended" : "lost" } };
    case "local_end":
      if (screen.kind !== "connecting" && screen.kind !== "active") return flow;
      return { handled: withHandled(flow.handled, screen.call.id), screen: IDLE };
    case "notice_done":
      return screen.kind === "notice" ? { ...flow, screen: IDLE } : flow;
  }
}

/** 호출을 하나 끝낸 뒤에는 그 사이 놓친 호출이 있을 수 있다 — 신호는 저장되지 않고 통화 중 목록은 버린다. */
export function needsRingReread(previous: StaffCallScreen["kind"], current: StaffCallScreen["kind"]): boolean {
  return previous !== "idle" && current === "idle";
}

/**
 * 통화 중 상태 읽기 결과 → 할 일. `forbidden` 은 인증 일시 오류에도 나오므로(문이 `getUser()` · 프로필 읽기 실패를 구분하지 않는다) 한 번으로 끊지 않는다.
 * 권한 회수는 태블릿의 30초 확인이 서버에서 끝내고, 이것은 그 판정도 닿지 않을 때의 안전장치다. 정상 응답이 한 번 오면 다시 센다.
 */
export function judgeCallStatus(
  result: { ok: true; status: string } | { ok: false; errorKey: string },
  forbiddenSinceMs: number | null,
  nowMs: number,
): { event: StaffCallFlowEvent | null; forbiddenSinceMs: number | null } {
  if (result.ok) return { event: result.status === "accepted" ? null : { type: "remote_ended" }, forbiddenSinceMs: null };
  if (result.errorKey !== "forbidden") return { event: null, forbiddenSinceMs };
  const since = forbiddenSinceMs ?? nowMs;
  return { event: nowMs - since >= FORBIDDEN_LIMIT_MS ? { type: "connection_lost" } : null, forbiddenSinceMs: since };
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function guestAbsentTooLong(lastSeenMs: number, nowMs: number): boolean {
  return nowMs - lastSeenMs > GUEST_ABSENT_LIMIT_MS;
}

/** 「01:12」. */
export function formatCallElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
