// 직원 통화 공용 규칙(DB 없음) — 서버 · 클라이언트 모두 import 할 수 있다. docs/product/46 §3 · §4 · §5.

export const STAFF_CALL_MAX_MS = 30 * 60_000;
export const STAFF_CALL_TOKEN_SECONDS = 30 * 60;
export const STAFF_CALL_NOTIFICATION_HREF = "/admin/checkin";

export const STAFF_CALL_STEPS = ["welcome", "find", "passport", "face", "address", "done", "other"] as const;
export type StaffCallStep = (typeof STAFF_CALL_STEPS)[number];

export const STAFF_CALL_LANGUAGES = ["ja", "en", "zh-Hans", "ko"] as const;
export type StaffCallLanguage = (typeof STAFF_CALL_LANGUAGES)[number];

export type StaffCallStatus = "ringing" | "accepted" | "ended" | "no_answer" | "canceled" | "failed";

export type RingingStaffCall = {
  id: string;
  propertyKey: string;
  deviceName: string;
  step: string;
  language: string;
  ringDeadlineAt: string;
};

/** 「예약 보기」 요약 — 체크인 코드 · 여권 · 서류 없음. */
export type StaffCallStay = {
  stayId: string;
  leadName: string | null;
  reservationNumber: string;
  propertyKey: string;
  roomLabels: string[];
  checkInDate: string;
  checkOutDate: string;
  partySize: number;
};

export type AcceptStaffCallErrorKey = "already_taken" | "expired" | "unconfigured" | "forbidden" | "failed" | "not_ready";

export type StaffCallRowFacts = {
  status: string;
  ring_deadline_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
};

/** 45초가 지난 `ringing` — 읽거나 쓸 때 `no_answer` 로 닫는다(스케줄러 없음). */
export function isRingOverdue(row: Pick<StaffCallRowFacts, "status" | "ring_deadline_at">, nowMs: number): boolean {
  return row.status === "ringing" && Date.parse(row.ring_deadline_at) <= nowMs;
}

/** 30분이 지난 `accepted` — 읽거나 쓸 때 `ended` 로 닫는다. */
export function isCallOverdue(row: Pick<StaffCallRowFacts, "status" | "accepted_at">, nowMs: number): boolean {
  return row.status === "accepted" && !!row.accepted_at && Date.parse(row.accepted_at) + STAFF_CALL_MAX_MS <= nowMs;
}

/** 조건부 update 가 0행일 때 왜 못 받았는지. 누가 받은 적 있으면 `already_taken`, 아니면 이미 끝난 호출. */
export function acceptMissReason(row: Pick<StaffCallRowFacts, "accepted_at">): "already_taken" | "expired" {
  return row.accepted_at ? "already_taken" : "expired";
}

/** 받은 본인이거나 `checkin.manage` — 끊기 · 상태 읽기의 문. 받기 전에는 manage 만 통과한다. */
export function canControlCall(row: Pick<StaffCallRowFacts, "accepted_by">, userId: string, canManage: boolean): boolean {
  return canManage || row.accepted_by === userId;
}

const ROOM_NAME_PATTERN = /^call-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStaffCallRoomName(name: unknown): name is string {
  return typeof name === "string" && ROOM_NAME_PATTERN.test(name);
}

export type CheckinNotificationAccess = { surface: "admin" | "mobile"; canViewCheckin: boolean };

/**
 * 알림 줄을 눌렀을 때 — 저장된 href 는 셋 다 `/admin/checkin` 이지만, 모바일엔 체크인 화면이 없고 `checkin.call` 만 가진 직원은
 * 그 화면에 못 들어간다. 그래서 관리자 콘솔 + `checkin.view` 일 때만 이동하고, 그 밖에는 빈 주소(이동 없음)다.
 * `staffCallId` 는 닫아 둔 호출이 아직 울리는 중이면 받기 화면을 다시 띄우는 데 쓴다.
 */
export function resolveCheckinNotificationLink(input: {
  type: string;
  callId: unknown;
  access: CheckinNotificationAccess | undefined;
}): { href: string; staffCallId: string | null } {
  const canGo = input.access?.surface === "admin" && input.access.canViewCheckin;
  return {
    href: canGo ? STAFF_CALL_NOTIFICATION_HREF : "",
    staffCallId: input.type === "checkin_staff_call" && typeof input.callId === "string" ? input.callId : null,
  };
}
