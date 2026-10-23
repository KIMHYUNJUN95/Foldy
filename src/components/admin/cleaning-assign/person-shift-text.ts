import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { PersonShiftDay, PersonShiftDetail, PersonShiftRoom } from "@/lib/cleaning-assign/person-shift";
import { timeLabel, tokyoTime } from "./format";

/**
 * 사람별 시프트 달력 — PC 패널과 모바일 화면이 같이 쓰는 칸 모양 · 그날 글자(시안 72AoNd…). 순수 함수.
 * 칸 모양은 알바 「내 시프트」와 같고(채운 원 = 배정 · 빈 원 = 신청 · 「없음」), 관리자만 보는 것: 회색 원 = 일한 날,
 * 주황 = 확인할 날(기록 없음 · 취소 요청). docs/product/37-cleaning-shift-assignment.md 「4-6」
 */

export type PsKind = "worked" | "noRecord" | "assigned" | "request" | "waiting" | "none" | "free" | "past";

export function psKind(day: Pick<PersonShiftDay, "state" | "noRecord" | "cancelRequested">): PsKind {
  if (day.state === "worked") return day.noRecord ? "noRecord" : "worked";
  if (day.state === "assigned") return day.cancelRequested ? "request" : "assigned";
  return day.state;
}

/** 칸 아래 작은 글자. */
export function psMark(kind: PsKind, rooms: number, copy: CleaningAssignCopy): string {
  if (kind === "worked" || kind === "assigned") return fill(copy.markRooms, { n: rooms });
  if (kind === "noRecord") return copy.psStNoRecord;
  if (kind === "request") return copy.psStReq;
  if (kind === "none") return copy.markNoneShort;
  return "";
}

export type PsTone = "gray" | "purple" | "orange";

export function psStatus(kind: PsKind, copy: CleaningAssignCopy): { label: string; tone: PsTone } {
  switch (kind) {
    case "worked":
      return { label: copy.psStWorked, tone: "gray" };
    case "noRecord":
      return { label: copy.psStNoRecord, tone: "orange" };
    case "assigned":
      return { label: copy.psStAssigned, tone: "purple" };
    case "request":
      return { label: copy.psStReq, tone: "orange" };
    case "waiting":
      return { label: copy.psStWaiting, tone: "purple" };
    case "none":
      return { label: copy.psStNone, tone: "gray" };
    default:
      return { label: copy.psStFree, tone: "gray" };
  }
}

/** 그날 큰 글자 한 줄 + 작은 글자 한 줄. */
export function psHeadline(kind: PsKind, date: string, detail: PersonShiftDetail | undefined, copy: CleaningAssignCopy, today: string): { head: string; sub: string } {
  const n = detail?.rooms.length ?? 0;
  const time = detail ? timeLabel(detail.startMinutes) : "";
  const by = detail?.assignedBy && detail.assignedAt ? fill(copy.psAssignedBy, { at: tokyoTime(detail.assignedAt, true), name: detail.assignedBy }) : "";
  switch (kind) {
    case "worked":
    case "assigned":
      return { head: fill(copy.psHeadRooms, { n, time }), sub: by };
    case "request":
      return { head: fill(copy.psHeadRooms, { n, time }), sub: detail?.cancelRequestedAt ? fill(copy.psReqAt, { at: tokyoTime(detail.cancelRequestedAt, true) }) : "" };
    case "noRecord":
      return { head: fill(copy.psHeadNoRecord, { n }), sub: copy.psSubNoRecord };
    case "waiting":
      return { head: copy.psHeadWaiting, sub: [fill(copy.psSubWaiting, { n: detail?.openRooms ?? 0 }), detail?.byAdmin ? copy.psByAdmin : ""].filter(Boolean).join(" · ") };
    case "none":
      return { head: date < today ? copy.psHeadNonePast : copy.psHeadNone, sub: detail?.byAdmin ? copy.psByAdmin : "" };
    case "past":
      return { head: copy.psHeadPast, sub: "" };
    default:
      return { head: copy.psHeadFree, sub: copy.psSubFree };
  }
}

/** 방 한 줄 — 같이 들어간 사람 또는 그 사람 청소 기록, 오른쪽 작은 글자. */
export function psRoomLine(room: PersonShiftRoom, kind: PsKind, copy: CleaningAssignCopy): { sub: string; right: string; tone: PsTone } {
  const mates = room.mates.length > 0 ? fill(copy.withMate, { names: room.mates.join(" · ") }) : copy.alone;
  if (kind === "worked" || kind === "noRecord") {
    const s = room.session;
    if (s?.completedAt) {
      return { right: s.minutes ? fill(copy.psRoomMinutes, { n: s.minutes }) : "", sub: fill(copy.psRoomTime, { end: tokyoTime(s.completedAt), start: tokyoTime(s.startedAt) }), tone: "gray" };
    }
    if (s) return { right: "", sub: fill(copy.psRoomStarted, { start: tokyoTime(s.startedAt) }), tone: "gray" };
    return { right: copy.psNotStartedTag, sub: mates, tone: "orange" };
  }
  return { right: "", sub: mates, tone: "gray" };
}

export type PsAction = "fixDay" | "openDay" | "addDay" | "accept" | "reject" | "applyFor" | "removeApply";

/** 그날 할 수 있는 일. 하루 보기 바로 가기는 PC 에만. 신청 넣기 · 빼기는 오늘부터(서버도 다시 막는다). */
export function psActions(kind: PsKind, date: string, today: string, pc: boolean): PsAction[] {
  const future = date >= today;
  const out: PsAction[] = [];
  if (kind === "request" && future) out.push("accept", "reject");
  if (kind === "waiting" && future) out.push(...(pc ? (["addDay"] as const) : []), "removeApply");
  if (kind === "free" && future) out.push("applyFor");
  if (pc && kind === "assigned") out.push("fixDay");
  if (pc && kind === "noRecord") out.push("openDay");
  return out;
}

export function psActionLabel(action: PsAction, copy: CleaningAssignCopy): string {
  return {
    accept: copy.psAccept,
    addDay: copy.psAddDay,
    applyFor: copy.psApplyFor,
    fixDay: copy.psFixDay,
    openDay: copy.psOpenDay,
    reject: copy.psReject,
    removeApply: copy.psRemoveApply,
  }[action];
}
