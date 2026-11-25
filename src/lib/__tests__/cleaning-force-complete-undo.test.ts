import { describe, expect, it } from "vitest";
import {
  buildForceCompleteSnapshot,
  cleaningPanelFoot,
  createWriteGate,
  decideForceCompleteUndo,
  forceCompleteExpectedStale,
  forceCompleteRedoInput,
  forceCompleteUndoBlock,
  forceCompleteUndoActorsOk,
  forceCompleteUndoPlan,
  offerForceCompleteUndo,
  parseForceCompleteSnapshot,
  undoRestoreFailure,
} from "@/lib/cleaning-force-complete-undo";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { sessionReopenFields } from "@/lib/cleaning-assign/room-rules";
import { getDictionary } from "@/lib/i18n";

// 관리자 대리 완료 취소(2026-11-25 사용자 결정) — 오늘 · 관리자가 완료 처리한 기록만, 완료 처리 전 상태로 되돌린다.
// 진행 중이던 기록은 진행 중으로(시작 시각 · 담당 · 메모 복원), 관리자가 새로 만든 완료 기록은 지운다.

const TODAY = "2026-11-25";
const ADMIN = "admin-1";

const inProgressBefore = {
  status: "in_progress" as const,
  staff_user_id: "staff-a",
  started_at: "2026-11-25T01:00:00+00:00", // 10:00 도쿄
  completed_at: null,
  duration_seconds: null,
  notes: "욕실 먼저",
  completed_by_admin: null,
};

const applied = {
  staff_user_id: "staff-b",
  started_at: "2026-11-25T10:30:00+09:00",
  completed_at: "2026-11-25T11:15:00+09:00",
  notes: "관리자 메모",
};

function completedRow(snapshot: unknown, over: Record<string, unknown> = {}) {
  return {
    status: "completed" as const,
    completed_by_admin: ADMIN,
    closed_without_cleaning: false,
    cleaning_date: TODAY,
    staff_user_id: "staff-b",
    // DB 는 UTC 로 돌려준다 — 같은 순간이면 같은 값으로 본다.
    started_at: "2026-11-25T01:30:00+00:00",
    completed_at: "2026-11-25T02:15:00+00:00",
    notes: "관리자 메모",
    admin_complete_snapshot: snapshot,
    ...over,
  };
}

describe("buildForceCompleteSnapshot / parseForceCompleteSnapshot", () => {
  it("keeps every field the force-complete overwrites", () => {
    const snap = buildForceCompleteSnapshot(inProgressBefore, applied);
    expect(snap).toMatchObject({ v: 1, created: false, ...inProgressBefore, applied });
    expect(parseForceCompleteSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("marks a record the admin created", () => {
    expect(buildForceCompleteSnapshot(null, applied)).toEqual({ v: 1, created: true, applied });
  });

  it("rejects missing or malformed snapshots", () => {
    expect(parseForceCompleteSnapshot(null)).toBeNull();
    expect(parseForceCompleteSnapshot({})).toBeNull();
    expect(parseForceCompleteSnapshot({ v: 1, created: false, applied })).toBeNull(); // 복원할 값이 없음
    expect(parseForceCompleteSnapshot({ v: 2, created: true, applied })).toBeNull();
    expect(parseForceCompleteSnapshot({ v: 1, created: true })).toBeNull();
  });

  // 점검 A1(b) — 스냅샷은 강제 완료가 덮어쓸 수 있던 두 모양뿐이다: 진행 중 · 끝난 시각 모름 완료. 그 밖은 위조로 보고 거절한다.
  it("accepts only the two states force-complete can overwrite", () => {
    const unmeasured = {
      ...inProgressBefore,
      status: "completed" as const,
      completed_at: inProgressBefore.started_at,
      duration_seconds: 0,
    };
    expect(parseForceCompleteSnapshot(buildForceCompleteSnapshot(unmeasured, applied))).not.toBeNull();
    const forged = (over: Record<string, unknown>) => ({ ...buildForceCompleteSnapshot(inProgressBefore, applied), ...over });
    expect(parseForceCompleteSnapshot(forged({ status: "cancelled" }))).toBeNull();
    expect(parseForceCompleteSnapshot(forged({ completed_at: "2026-11-25T02:00:00+00:00" }))).toBeNull(); // 진행 중인데 끝난 시각
    expect(parseForceCompleteSnapshot(forged({ duration_seconds: 120 }))).toBeNull();
    // 완료인데 정상 측정 기록(끝 시각 ≠ 시작 · 소요 > 0) — 강제 완료가 덮어쓰지 않는 기록이다.
    expect(
      parseForceCompleteSnapshot(forged({ status: "completed", completed_at: "2026-11-25T02:00:00+00:00", duration_seconds: 3600 })),
    ).toBeNull();
    expect(parseForceCompleteSnapshot(forged({ status: "completed", completed_at: inProgressBefore.started_at, duration_seconds: 5 }))).toBeNull();
  });
});

describe("forceCompleteUndoActorsOk — 스냅샷 속 사람이 이 조직 사람인지(점검 A1(b))", () => {
  const members = new Set(["staff-a", "staff-b", ADMIN]);
  const completers = new Set([ADMIN]);
  const snap = buildForceCompleteSnapshot(inProgressBefore, applied);

  it("allows a snapshot whose people all belong to the org", () => {
    expect(forceCompleteUndoActorsOk(ADMIN, snap, members, completers)).toBe(true);
    expect(forceCompleteUndoActorsOk(ADMIN, buildForceCompleteSnapshot(null, applied), members, completers)).toBe(true);
  });
  it("rejects a completion not marked by a force-complete admin of this org", () => {
    expect(forceCompleteUndoActorsOk("staff-a", snap, members, completers)).toBe(false);
  });
  it("rejects restoring the record to someone outside the org", () => {
    expect(forceCompleteUndoActorsOk(ADMIN, { ...snap, staff_user_id: "outsider" } as typeof snap, members, completers)).toBe(false);
  });
  it("rejects restoring a previous admin mark that is not a force-complete admin", () => {
    expect(forceCompleteUndoActorsOk(ADMIN, { ...snap, completed_by_admin: "staff-a" } as typeof snap, members, completers)).toBe(false);
  });
});

describe("도쿄 날짜 경계(점검 C4)", () => {
  it("rolls the operating day at UTC 15:00", () => {
    expect(getCleaningOperatingDateKey(new Date("2026-11-25T14:59:59Z"))).toBe("2026-11-25");
    expect(getCleaningOperatingDateKey(new Date("2026-11-25T15:00:00Z"))).toBe("2026-11-26");
  });
  it("an undo just after Tokyo midnight is blocked as not today", () => {
    const snap = buildForceCompleteSnapshot(inProgressBefore, applied);
    const afterMidnight = getCleaningOperatingDateKey(new Date("2026-11-25T15:00:30Z"));
    expect(forceCompleteUndoBlock(completedRow(snap), afterMidnight)).toBe("not_today");
  });
  it("offers 「실행 취소」 on the force-complete toast only for today's record", () => {
    const now = Date.parse("2026-11-25T14:59:00Z"); // 23:59 도쿄
    expect(offerForceCompleteUndo(TODAY, now)).toBe(true);
    expect(offerForceCompleteUndo("2026-11-24", now)).toBe(false); // 지난 날짜 화면
    expect(offerForceCompleteUndo(TODAY, Date.parse("2026-11-25T15:00:00Z"))).toBe(false); // 자정이 지남
  });
});

describe("forceCompleteUndoBlock — 취소 가능 판정 한 곳", () => {
  const snap = buildForceCompleteSnapshot(inProgressBefore, applied);

  it("allows today's admin completion that still has its snapshot", () => {
    expect(forceCompleteUndoBlock(completedRow(snap), TODAY)).toBeNull();
  });

  it("blocks a past day", () => {
    expect(forceCompleteUndoBlock(completedRow(snap, { cleaning_date: "2026-11-24" }), TODAY)).toBe("not_today");
  });

  it("blocks a completion the cleaner made", () => {
    expect(forceCompleteUndoBlock(completedRow(null, { completed_by_admin: null }), TODAY)).toBe("not_proxy");
  });

  it("blocks a closed-without-cleaning record", () => {
    expect(forceCompleteUndoBlock(completedRow(snap, { closed_without_cleaning: true }), TODAY)).toBe("closed");
  });

  it("blocks an older admin completion without a snapshot", () => {
    expect(forceCompleteUndoBlock(completedRow(null), TODAY)).toBe("no_snapshot");
  });

  it("blocks a record that is no longer completed", () => {
    expect(forceCompleteUndoBlock(completedRow(snap, { status: "in_progress" }), TODAY)).toBe("not_completed");
  });

  it("blocks a record changed after the admin completion (times or staff differ)", () => {
    expect(forceCompleteUndoBlock(completedRow(snap, { completed_at: "2026-11-25T03:00:00+00:00" }), TODAY)).toBe("changed");
    expect(forceCompleteUndoBlock(completedRow(snap, { staff_user_id: "staff-c" }), TODAY)).toBe("changed");
  });

  // 2차 점검 1 — 완료 뒤 메모만 바뀌어도 취소하면 그 메모가 스냅샷 값으로 덮인다. 「그 뒤 안 바뀜」에 메모를 넣는다.
  it("blocks a record whose note changed after the admin completion", () => {
    expect(forceCompleteUndoBlock(completedRow(snap, { notes: "직원이 고친 메모" }), TODAY)).toBe("changed");
    expect(forceCompleteUndoBlock(completedRow(snap, { notes: null }), TODAY)).toBe("changed");
  });

  it("treats an empty note and null as the same note", () => {
    const blank = buildForceCompleteSnapshot(inProgressBefore, { ...applied, notes: null });
    expect(forceCompleteUndoBlock(completedRow(blank, { notes: null }), TODAY)).toBeNull();
  });

  it("rejects a snapshot written without the applied note (older shape)", () => {
    const { notes: _omit, ...old } = applied;
    void _omit;
    expect(parseForceCompleteSnapshot({ v: 1, created: true, applied: old })).toBeNull();
  });
});

describe("forceCompleteUndoPlan — 되돌릴 값", () => {
  it("restores the in-progress state exactly", () => {
    const plan = forceCompleteUndoPlan(buildForceCompleteSnapshot(inProgressBefore, applied));
    expect(plan).toEqual({ kind: "restore", fields: { ...inProgressBefore, admin_complete_snapshot: null } });
  });

  it("deletes a record the admin created", () => {
    expect(forceCompleteUndoPlan(buildForceCompleteSnapshot(null, applied))).toEqual({ kind: "delete" });
  });
});

describe("forceCompleteRedoInput — 취소의 실행 취소", () => {
  const row = {
    id: "s1",
    room_label: "아라키초A 203",
    task_label: "long_stay",
    staff_user_id: "staff-b",
    started_at: "2026-11-25T01:30:00+00:00",
    completed_at: "2026-11-25T02:15:00+00:00",
    notes: null,
    cleaning_date: TODAY,
  };

  it("re-completes the same session with the same Tokyo times and staff", () => {
    expect(forceCompleteRedoInput(row, false, "2026-11-25T03:00:00.123456+00:00")).toEqual({
      sessionId: "s1",
      sessionRoomLabel: "아라키초A 203",
      taskType: "longstay",
      staffId: "staff-b",
      start: "10:30",
      end: "11:15",
      note: "",
      cleaningDate: TODAY,
      // 2차 점검 1 — 다시 완료도 취소 직후 그대로일 때만(되살린 줄의 updated_at).
      expectedUpdatedAt: "2026-11-25T03:00:00.123456+00:00",
    });
  });

  it("keeps midnight as 00, not 24 (hourCycle h23, 점검 C3)", () => {
    expect(forceCompleteRedoInput({ ...row, started_at: "2026-11-24T15:00:00Z", completed_at: "2026-11-24T15:20:00Z" }, false, "x")).toMatchObject({
      start: "00:00",
      end: "00:20",
    });
  });

  it("creates a new record again when the undone one was deleted", () => {
    expect(forceCompleteRedoInput({ ...row, task_label: "checkout" }, true, null)).toMatchObject({
      sessionId: null,
      taskType: "checkout",
      expectedUpdatedAt: null,
    });
  });
});

describe("undoRestoreFailure — 되돌리기가 DB 에 막힘", () => {
  it("reports busy when the cleaner already has another active room", () => {
    expect(undoRestoreFailure({ code: "23505", message: "duplicate key value violates unique constraint \"cleaning_sessions_one_active_per_org_user_idx\"" })).toBe("busy");
  });
  it("reports changed when the room is taken or closed", () => {
    expect(undoRestoreFailure({ code: "P0001", message: "cleaning_room_full", details: "resolved" })).toBe("changed");
  });
  it("reports error otherwise", () => {
    expect(undoRestoreFailure({ code: "XX000", message: "boom" })).toBe("error");
  });
});

describe("copy — 세 언어", () => {
  const keys = ["undoDone", "undoHint", "tUndoDone", "tUndoFailed", "tUndoChanged", "tUndoExpired", "tUndoBusy", "tUndoForbidden"] as const;
  const en = getDictionary("en").cleaning.console as Record<string, unknown>;
  it("en has every undo string", () => {
    for (const key of keys) expect(typeof en[key], key).toBe("string");
  });
  // 2차 점검 5 — 빠진 ko/ja 키는 영어 기본값으로 채워져 「있음」으로 보인다. 번역됐는지(영어와 다른지)로 본다.
  it.each(["ko", "ja"] as const)("%s translates every undo string (not the English fallback)", (locale) => {
    const t = getDictionary(locale).cleaning.console as Record<string, unknown>;
    for (const key of keys) {
      expect(typeof t[key], key).toBe("string");
      expect(t[key], `${locale}.${key}`).not.toBe(en[key]);
    }
    expect(getDictionary(locale).admin.shared.undo).not.toBe(getDictionary("en").admin.shared.undo);
  });
});

describe("sessionReopenFields — 직원 2분 되돌리기(점검 B3)", () => {
  it("clears the admin completion mark and snapshot so a reopened proxy completion is no longer 「관리자 대리」", () => {
    expect(sessionReopenFields()).toEqual({
      status: "in_progress",
      completed_at: null,
      duration_seconds: null,
      notes: null,
      completed_by_admin: null,
      admin_complete_snapshot: null,
    });
  });
});

// 2차 점검 1 · 6 — 서버 취소 액션의 판정(읽은 줄 → 거절 까닭 또는 쓸 값)을 순수 함수 하나로 뽑아 시험한다.
describe("decideForceCompleteUndo — 서버 취소 판정", () => {
  const snap = buildForceCompleteSnapshot(inProgressBefore, applied);
  const SEEN = "2026-11-25T02:15:00.654321+00:00";
  const row = (over: Record<string, unknown> = {}) => ({ ...completedRow(snap), updated_at: SEEN, ...over });

  it("restores when the row is exactly what the screen saw", () => {
    const d = decideForceCompleteUndo(row(), { today: TODAY, expectedUpdatedAt: SEEN });
    expect(d).toMatchObject({ ok: true, plan: { kind: "restore" } });
  });

  it("rejects as changed when the row changed after the screen read it (updated_at moved)", () => {
    const d = decideForceCompleteUndo(row({ updated_at: "2026-11-25T02:20:00.000001+00:00" }), { today: TODAY, expectedUpdatedAt: SEEN });
    expect(d).toEqual({ ok: false, reason: "changed" });
  });

  it("compares updated_at to the microsecond", () => {
    const d = decideForceCompleteUndo(row({ updated_at: "2026-11-25T02:15:00.654322+00:00" }), { today: TODAY, expectedUpdatedAt: SEEN });
    expect(d).toEqual({ ok: false, reason: "changed" });
    expect(decideForceCompleteUndo(row({ updated_at: "2026-11-25T11:15:00.654321+09:00" }), { today: TODAY, expectedUpdatedAt: SEEN }).ok).toBe(true);
  });

  it("rejects a call without the screen's updated_at", () => {
    expect(decideForceCompleteUndo(row(), { today: TODAY, expectedUpdatedAt: null })).toEqual({ ok: false, reason: "invalid" });
    expect(decideForceCompleteUndo(row(), { today: TODAY, expectedUpdatedAt: "" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a past day as expired", () => {
    expect(decideForceCompleteUndo(row({ cleaning_date: "2026-11-24" }), { today: TODAY, expectedUpdatedAt: SEEN })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a reopened or edited record as changed", () => {
    expect(decideForceCompleteUndo(row({ status: "in_progress" }), { today: TODAY, expectedUpdatedAt: SEEN })).toEqual({ ok: false, reason: "changed" });
    expect(decideForceCompleteUndo(row({ notes: "바뀜" }), { today: TODAY, expectedUpdatedAt: SEEN })).toEqual({ ok: false, reason: "changed" });
  });

  it("rejects an unreadable snapshot as invalid", () => {
    expect(decideForceCompleteUndo(row({ admin_complete_snapshot: { v: 9 } }), { today: TODAY, expectedUpdatedAt: SEEN })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("plans a delete for a record the admin created", () => {
    const d = decideForceCompleteUndo(row({ admin_complete_snapshot: buildForceCompleteSnapshot(null, applied) }), { today: TODAY, expectedUpdatedAt: SEEN });
    expect(d).toMatchObject({ ok: true, plan: { kind: "delete" } });
  });
});

// 2차 점검 1 — 취소 토스트의 「실행 취소」(다시 완료)도 취소 직후 그대로일 때만.
describe("forceCompleteExpectedStale — 다시 완료 보호", () => {
  it("is not stale when no expectation is given (ordinary force-complete)", () => {
    expect(forceCompleteExpectedStale("2026-11-25T02:15:00.1+00:00", undefined)).toBe(false);
    expect(forceCompleteExpectedStale("2026-11-25T02:15:00.1+00:00", null)).toBe(false);
  });
  it("is stale when the row moved since the undo", () => {
    expect(forceCompleteExpectedStale("2026-11-25T02:16:00+00:00", "2026-11-25T02:15:00+00:00")).toBe(true);
  });
  it("is fresh when it is the same instant", () => {
    expect(forceCompleteExpectedStale("2026-11-25T02:15:00.5+00:00", "2026-11-25T11:15:00.500000+09:00")).toBe(false);
  });
});

// 2차 점검 3 — 패널 「완료 취소」 · 토스트 「실행 취소」 · 강제 완료가 한 번에 하나만 돈다.
describe("createWriteGate — 쓰기 한 번에 하나", () => {
  it("refuses a second write while one is running and opens again after it ends", () => {
    const gate = createWriteGate();
    expect(gate.tryBegin()).toBe(true);
    expect(gate.tryBegin()).toBe(false);
    gate.end();
    expect(gate.tryBegin()).toBe(true);
  });
});

// 2차 점검 4 — 패널 아래 단추와 「완료 취소」 안내가 같은 판정 하나를 쓴다.
describe("cleaningPanelFoot — 패널 아래 단추 하나 판정", () => {
  const base = {
    canForceComplete: true,
    isHistory: false,
    status: "done" as const,
    sessionId: "s1",
    unmeasured: false,
    missingAssignees: [] as string[],
    undoable: true,
    hasUndoHandler: true,
  };
  it("shows undo for today's undoable admin completion", () => {
    expect(cleaningPanelFoot(base)).toBe("undo");
  });
  it("prefers completing the missing cleaner in a two-person room — then no undo (and no undo hint)", () => {
    expect(cleaningPanelFoot({ ...base, missingAssignees: ["staff-c"] })).toBe("forceMissing");
  });
  it("shows force-complete for an open room", () => {
    expect(cleaningPanelFoot({ ...base, status: "progress", undoable: false })).toBe("force");
  });
  it("closes only when the card is not undoable", () => {
    expect(cleaningPanelFoot({ ...base, undoable: false })).toBe("close");
    expect(cleaningPanelFoot({ ...base, isHistory: true })).toBe("close");
    expect(cleaningPanelFoot({ ...base, canForceComplete: false })).toBe("close");
    expect(cleaningPanelFoot({ ...base, hasUndoHandler: false })).toBe("close");
  });
});
