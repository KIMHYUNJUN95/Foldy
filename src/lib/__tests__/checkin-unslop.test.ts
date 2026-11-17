import { describe, expect, it } from "vitest";

import { genderLabel } from "@/components/admin/checkin/checkin-copy";
import { DEVICE_DISCONNECTED_AFTER_MS, deviceConnection, isDeviceDisconnected } from "@/lib/checkin/model";
import { firstGuestToShow, genderKey, stayNeedsStaffCheck } from "@/lib/checkin/staff-view";
import { getDictionary } from "@/lib/i18n";

describe("기기 연결 상태 — 연결됨 · 끊김 · 한 번도 안 됨", () => {
  const now = new Date("2026-11-17T03:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("15분 안에 핑이 왔으면 연결됨", () => {
    expect(deviceConnection(ago(60_000), now)).toBe("connected");
    expect(deviceConnection(ago(DEVICE_DISCONNECTED_AFTER_MS), now)).toBe("connected");
  });

  it("15분 넘게 핑이 없으면 끊김", () => {
    expect(deviceConnection(ago(DEVICE_DISCONNECTED_AFTER_MS + 1), now)).toBe("disconnected");
  });

  it("등록만 하고 핑이 한 번도 없으면 아직 연결 안 됨 — 끊김과 따로", () => {
    expect(deviceConnection(null, now)).toBe("never");
    // 서버 응답의 예전 칸은 그대로(연결되지 않은 기기 전부)
    expect(isDeviceDisconnected(null, now)).toBe(true);
  });

  it("세 언어 모두 「아직 연결 안 됨」 문구가 있다", () => {
    for (const locale of ["ko", "ja", "en"] as const) {
      expect(getDictionary(locale).checkinStaff.deviceNever.length).toBeGreaterThan(0);
    }
  });
});

describe("성별 원값을 화면 문구로", () => {
  it("male · female · 그 밖 · 빈 값", () => {
    expect(genderKey("male")).toBe("male");
    expect(genderKey(" Female ")).toBe("female");
    expect(genderKey("x")).toBe("other");
    expect(genderKey(null)).toBeNull();
    expect(genderKey("")).toBeNull();
  });

  it("ko 남 · 여, ja 男性 · 女性, en Male · Female", () => {
    expect([genderLabel("male", getDictionary("ko").checkinStaff), genderLabel("female", getDictionary("ko").checkinStaff)]).toEqual(["남", "여"]);
    expect([genderLabel("male", getDictionary("ja").checkinStaff), genderLabel("female", getDictionary("ja").checkinStaff)]).toEqual(["男性", "女性"]);
    expect([genderLabel("male", getDictionary("en").checkinStaff), genderLabel("female", getDictionary("en").checkinStaff)]).toEqual(["Male", "Female"]);
    expect(genderLabel("unknown", getDictionary("ko").checkinStaff)).toBe("기타");
    expect(genderLabel(null, getDictionary("ko").checkinStaff)).toBeNull();
  });
});

describe("확인이 필요한 손님부터 열기", () => {
  const guests = [{ needsStaffCheck: false }, { needsStaffCheck: true }, { needsStaffCheck: true }];

  it("직원 확인이 필요한 첫 사람(2번째)을 먼저 연다", () => {
    expect(firstGuestToShow({ group: "attention", staffCheckCount: 2 }, guests)).toBe(1);
  });

  it("확인할 사람이 없으면(체크인 전 포함) 1번째", () => {
    expect(firstGuestToShow({ group: "attention", staffCheckCount: 0 }, guests)).toBe(0);
    expect(firstGuestToShow({ group: "attention", staffCheckCount: 1 }, [{ needsStaffCheck: false }])).toBe(0);
    expect(firstGuestToShow({ group: "attention", staffCheckCount: 1 }, [])).toBe(0);
  });

  it("확인을 끝낸 예약은 점 · 먼저 열기 없이 1번째", () => {
    const done = { group: "done", staffCheckCount: 1 };
    expect(stayNeedsStaffCheck(done)).toBe(false);
    expect(firstGuestToShow(done, guests)).toBe(0);
    expect(stayNeedsStaffCheck({ group: "attention", staffCheckCount: 1 })).toBe(true);
  });
});
