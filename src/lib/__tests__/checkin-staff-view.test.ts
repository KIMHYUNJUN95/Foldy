import { describe, expect, it } from "vitest";

import type { CheckinArrivalRow } from "@/lib/checkin/model";
import {
  CODE_AUTO_HIDE_MS,
  CODE_INITIAL_STATE,
  codeAvailability,
  codeReducer,
  countSettingsChanges,
  formatCheckinCode,
  formatRemaining,
  formatTokyoStamp,
  formatTokyoTime,
  groupArrivalRows,
  groupEnrollmentCode,
  isValidPinInput,
  nightsBetween,
  panelAccess,
  roomsText,
  rosterDots,
  rowStatus,
  sectionOfInvalidField,
  summarizeDevices,
  toCodeErrorKey,
  toSaveInput,
  toSettingsForm,
  type CodeState,
} from "@/lib/checkin/staff-view";
import type { CheckinPropertySettings } from "@/lib/checkin/settings-model";

/** 셀프 체크인 직원 PC 화면 로직 — 코드 칸 상태 · 권한별 단추 · 목록 판정 · 설정 폼. docs/product/44 §4-4. */

describe("체크인 코드 칸 상태", () => {
  it("평소엔 가려져 있고 누르면 확인 중 → 받으면 보인다", () => {
    let state: CodeState = CODE_INITIAL_STATE;
    expect(state.kind).toBe("hidden");
    state = codeReducer(state, { type: "request" });
    expect(state.kind).toBe("loading");
    state = codeReducer(state, { type: "success", code: "482917", now: 1000 });
    expect(state).toEqual({ kind: "shown", code: "482917", shownAt: 1000 });
  });

  it("「가리기」를 누르면 코드가 상태에서 사라진다", () => {
    const shown: CodeState = { kind: "shown", code: "482917", shownAt: 0 };
    const hidden = codeReducer(shown, { type: "hide" });
    expect(hidden).toEqual({ kind: "hidden" });
    expect(JSON.stringify(hidden)).not.toContain("482917");
  });

  it("5분이 되기 전엔 그대로, 5분이 되면 스스로 가린다", () => {
    const shown: CodeState = { kind: "shown", code: "482917", shownAt: 10_000 };
    expect(codeReducer(shown, { type: "tick", now: 10_000 + CODE_AUTO_HIDE_MS - 1 })).toBe(shown);
    expect(codeReducer(shown, { type: "tick", now: 10_000 + CODE_AUTO_HIDE_MS })).toEqual({ kind: "hidden" });
  });

  it("오류는 사유와 함께 남고 다시 누르면 다시 시도한다", () => {
    let state: CodeState = codeReducer(CODE_INITIAL_STATE, { type: "request" });
    state = codeReducer(state, { type: "failure", errorKey: "no_code" });
    expect(state).toEqual({ kind: "error", errorKey: "no_code" });
    expect(codeReducer(state, { type: "request" }).kind).toBe("loading");
  });

  it("가린 뒤 늦게 도착한 응답은 코드를 되살리지 못한다", () => {
    const loading = codeReducer(CODE_INITIAL_STATE, { type: "request" });
    const hidden = codeReducer(loading, { type: "hide" });
    expect(codeReducer(hidden, { type: "success", code: "111222", now: 5 })).toEqual({ kind: "hidden" });
    expect(codeReducer(hidden, { type: "failure", errorKey: "failed" })).toEqual({ kind: "hidden" });
  });

  it("보이는 동안 다시 눌러도 두 번 부르지 않는다", () => {
    const shown: CodeState = { kind: "shown", code: "482917", shownAt: 0 };
    expect(codeReducer(shown, { type: "request" })).toBe(shown);
    const loading: CodeState = { kind: "loading" };
    expect(codeReducer(loading, { type: "request" })).toBe(loading);
  });

  it("6자리는 가운데를 띄우고 다른 모양은 그대로", () => {
    expect(formatCheckinCode("482917")).toBe("482 917");
    expect(formatCheckinCode("4829")).toBe("4829");
  });

  it("끝남 · 기간 지남 · 취소는 서버를 부르기 전에 사유만, 나머지는 보기 가능", () => {
    expect(codeAvailability("checked_in")).toBe("checked_in");
    expect(codeAvailability("expired")).toBe("expired");
    expect(codeAvailability("cancelled")).toBe("cancelled");
    for (const status of ["pending", "pre_registered", "in_progress"] as const) expect(codeAvailability(status)).toBe("available");
  });

  it("모르는 errorKey 는 failed 로", () => {
    expect(toCodeErrorKey("no_code")).toBe("no_code");
    expect(toCodeErrorKey("checked_in")).toBe("checked_in");
    expect(toCodeErrorKey("something_else")).toBe("failed");
  });
});

describe("패널 권한별 단추", () => {
  const base = { status: "checked_in" as const, verifiedAt: null, canViewDocuments: true, canVerify: true };

  it("documents 권한이 있으면 파일 줄과 「확인함」이 둘 다", () => {
    expect(panelAccess(base)).toEqual({ showDocuments: true, verify: "ready" });
  });

  it("documents 권한이 없으면 파일 줄도 「확인함」도 없다", () => {
    expect(panelAccess({ ...base, canViewDocuments: false, canVerify: false })).toEqual({ showDocuments: false, verify: "hidden" });
  });

  it("체크인이 끝나기 전엔 「확인함」을 그리지 않는다", () => {
    for (const status of ["pending", "pre_registered", "in_progress", "expired"] as const) {
      expect(panelAccess({ ...base, status }).verify).toBe("hidden");
    }
  });

  it("이미 확인된 건은 권한과 상관없이 확인됨 표시", () => {
    expect(panelAccess({ ...base, verifiedAt: "2026-11-01T07:00:00Z" }).verify).toBe("done");
    expect(panelAccess({ ...base, canVerify: false, verifiedAt: "2026-11-01T07:00:00Z" }).verify).toBe("done");
  });
});

function row(patch: Partial<CheckinArrivalRow>): CheckinArrivalRow {
  return {
    stayId: "s",
    status: "pending",
    group: "not_yet",
    leadName: "A",
    channel: "manual",
    reservationNumber: "R1",
    propertyKey: "arakicho_a",
    propertyName: "아라키초A",
    roomLabels: ["201"],
    checkInDate: "2026-11-01",
    checkOutDate: "2026-11-04",
    guestCountExpected: 2,
    partySize: 2,
    rosterCount: 0,
    rosterFilled: 0,
    partyMismatch: false,
    staffCheckCount: 0,
    checkedInAt: null,
    startedAt: null,
    route: null,
    verifiedAt: null,
    verifiedByName: null,
    ...patch,
  };
}

describe("목록 판정", () => {
  it("상태 글자 — 확인 필요는 붉게, 끝남은 진하게, 나머지는 옅게", () => {
    expect(rowStatus(row({ status: "checked_in", group: "attention", partyMismatch: true }))).toEqual({ key: "partyMismatch", tone: "red" });
    expect(rowStatus(row({ status: "checked_in", group: "attention", staffCheckCount: 1 }))).toEqual({ key: "staffCheck", tone: "red" });
    expect(rowStatus(row({ status: "checked_in", group: "done" }))).toEqual({ key: "checkedIn", tone: "ok" });
    expect(rowStatus(row({ status: "checked_in", group: "done", verifiedAt: "x" }))).toEqual({ key: "verified", tone: "ok" });
    expect(rowStatus(row({ status: "in_progress", group: "in_progress" })).key).toBe("inProgress");
    expect(rowStatus(row({ status: "pre_registered" })).key).toBe("preRegistered");
    expect(rowStatus(row({ status: "pending" })).key).toBe("notArrived");
    expect(rowStatus(row({ status: "expired" })).key).toBe("expired");
  });

  it("묶음은 할 일 순서이고 빈 묶음은 건너뛴다", () => {
    const groups = groupArrivalRows([row({ stayId: "1", group: "done" }), row({ stayId: "2", group: "attention" }), row({ stayId: "3", group: "done" })]);
    expect(groups.map((g) => [g.group, g.rows.map((r) => r.stayId)])).toEqual([
      ["attention", ["2"]],
      ["done", ["1", "3"]],
    ]);
  });

  it("방 줄 — 방 이름에 건물 이름이 붙어 있으면 한 번만", () => {
    expect(roomsText({ propertyName: "아라키초A", roomLabels: ["201", "202"], localizedProperty: "Arakicho A", unknownRoomLabel: "?" })).toBe("Arakicho A · 201, 202");
    expect(roomsText({ propertyName: "아라키초A", roomLabels: ["아라키초A 201"], localizedProperty: "Arakicho A", unknownRoomLabel: "?" })).toBe("Arakicho A · 201");
    expect(roomsText({ propertyName: "오쿠보A", roomLabels: ["오쿠보A"], localizedProperty: "Okubo A", unknownRoomLabel: "?" })).toBe("Okubo A");
    expect(roomsText({ propertyName: "오쿠보A", roomLabels: [], localizedProperty: "Okubo A", unknownRoomLabel: "?" })).toBe("Okubo A");
  });

  it("명부 점과 밤 수", () => {
    expect(rosterDots(1, 3)).toEqual([true, false, false]);
    expect(rosterDots(5, 2)).toEqual([true, true]);
    expect(nightsBetween("2026-11-01", "2026-11-04")).toBe(3);
    expect(nightsBetween("2026-11-04", "2026-11-01")).toBe(0);
  });
});

describe("시각 · 기기", () => {
  it("도쿄 기준으로 적는다", () => {
    expect(formatTokyoTime("2026-11-01T07:05:00Z")).toBe("16:05");
    expect(formatTokyoStamp("2026-10-31T15:30:00Z")).toBe("11/1 00:30");
    expect(formatTokyoTime(null)).toBe("");
    expect(formatTokyoTime("not a date")).toBe("");
  });

  it("등록 코드 8자리와 남은 시간", () => {
    expect(groupEnrollmentCode("48271593")).toBe("4827 1593");
    expect(formatRemaining(9 * 60_000 + 42_000)).toBe("9:42");
    expect(formatRemaining(-5)).toBe("0:00");
    expect(formatRemaining(1)).toBe("0:01");
  });

  it("기기 요약", () => {
    expect(summarizeDevices([{ disconnected: false }, { disconnected: true }, { disconnected: false }])).toEqual({ total: 3, connected: 2, disconnected: 1 });
  });
});

const settings: CheckinPropertySettings = {
  propertyKey: "arakicho_a",
  propertyName: "아라키초A",
  saved: true,
  languages: ["ja", "en"],
  welcomeText: { ja: "ようこそ" },
  termsText: { ja: "約款" },
  termsVersion: 3,
  requiredFields: [{ key: "next_dest", required: true, foreignOnly: true }],
  videoSecondsPerGuest: 5,
  supportContacts: { phone: "+81-3-0000-0000" },
  idleSecondsInput: 240,
  idleSecondsDone: 30,
  verificationMethod: "video",
  hasStaffPin: true,
  mrzAutofill: true,
  updatedAt: null,
  updatedByName: null,
};

describe("건물 설정 폼", () => {
  it("처음엔 바뀐 곳이 없고 PIN 은 건드리지 않음", () => {
    const form = toSettingsForm(settings);
    expect(countSettingsChanges(form, form)).toBe(0);
    const input = toSaveInput(settings, form);
    expect("staffPin" in input).toBe(false);
    expect(input.requiredFields).toBe(settings.requiredFields);
    expect(input.idleSecondsInput).toBe(240);
    expect(input.verificationMethod).toBe("video");
    expect(input.expectedUpdatedAt).toBe(settings.updatedAt);
  });

  it("빈 칸은 보내지 않고, 언어는 정해진 순서로", () => {
    const form = toSettingsForm(settings);
    form.languages = ["en", "ja"];
    form.welcomeText.ko = "  ";
    form.supportContacts.line = " @stay ";
    const input = toSaveInput(settings, form);
    expect(input.languages).toEqual(["ja", "en"]);
    expect(input.welcomeText).toEqual({ ja: "ようこそ" });
    expect(input.supportContacts).toEqual({ phone: "+81-3-0000-0000", line: "@stay" });
  });

  it("PIN — 새 값은 문자열, 지움은 null, 그대로는 칼럼 자체가 없다", () => {
    const form = toSettingsForm(settings);
    expect(toSaveInput(settings, { ...form, pin: { mode: "set", value: "1234" } }).staffPin).toBe("1234");
    const cleared = toSaveInput(settings, { ...form, pin: { mode: "clear" } });
    expect("staffPin" in cleared && cleared.staffPin).toBeNull();
    expect(countSettingsChanges(form, { ...form, pin: { mode: "clear" } })).toBe(1);
  });

  it("바뀐 곳을 센다", () => {
    const initial = toSettingsForm(settings);
    const next = toSettingsForm(settings);
    next.welcomeText.en = "Welcome";
    next.videoSecondsPerGuest = "8";
    next.languages = ["ja"];
    expect(countSettingsChanges(initial, next)).toBe(3);
  });

  it("PIN 입력은 숫자 4~8자리", () => {
    expect(isValidPinInput("1234")).toBe(true);
    expect(isValidPinInput("12345678")).toBe(true);
    expect(isValidPinInput("123")).toBe(false);
    expect(isValidPinInput("123456789")).toBe(false);
    expect(isValidPinInput("12a4")).toBe(false);
  });

  it("서버가 돌려준 잘못된 칸은 해당 구역으로", () => {
    expect(sectionOfInvalidField("staffPin")).toBe("pin");
    expect(sectionOfInvalidField("videoSecondsPerGuest")).toBe("verify");
    expect(sectionOfInvalidField("welcomeText")).toBe("welcome");
    expect(sectionOfInvalidField("idleSecondsDone")).toBe("other");
  });
});
