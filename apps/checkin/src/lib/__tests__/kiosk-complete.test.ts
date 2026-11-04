import { describe, expect, it } from "vitest";

import { canonicalNameOf } from "../building-key";
import {
  addressOf,
  completionBlock,
  currentRoomLabels,
  finishedWithinWindow,
  matchRoomCodes,
  identityProven,
  freshProof,
  proveOutcome,
  holdDecision,
  GUEST_KEYBOX_BUILDINGS,
  needsStaffCheck,
  raceOutcome,
  sharedCodesOf,
  staffCheckCount,
} from "../kiosk/complete";
import { nameMatchesProve } from "../kiosk/find";
import { parseMrzStrip } from "../kiosk/mrz";
import { roomForm } from "../kiosk/rooms";

const ok = { hasFaceVideo: true, noPassportReason: null, mrzValid: true, missing: [] as string[] };

describe("체크인 완료 — 막는 조건", () => {
  const g = (name: string | null, missing: string[] = []) => ({ name, missing });
  it("동의가 없으면 consent, 먼저 본다", () => {
    expect(completionBlock({ consented: false, partySize: 2, guests: [] })).toBe("consent");
  });
  it("명부가 인원보다 적으면 roster", () => {
    expect(completionBlock({ consented: true, partySize: 3, guests: [g("A"), g("B")] })).toBe("roster");
    expect(completionBlock({ consented: true, partySize: 0, guests: [] })).toBe("roster");
  });
  it("이름 없는 줄은 roster", () => {
    expect(completionBlock({ consented: true, partySize: 1, guests: [g(null)] })).toBe("roster");
    expect(completionBlock({ consented: true, partySize: 2, guests: [g("A"), g("  ")] })).toBe("roster");
  });
  it("예약 이름만 채워진 대표자(필수 칸 빔)는 roster", () => {
    expect(completionBlock({ consented: true, partySize: 1, guests: [g("A", ["address", "contact", "gender", "age"])] })).toBe("roster");
    expect(completionBlock({ consented: true, partySize: 1, guests: [g("A", ["nationality"])] })).toBe("roster");
  });
  it("여권 사진만 빠진 사람은 막지 않는다", () => {
    expect(completionBlock({ consented: true, partySize: 1, guests: [g("A", ["passport_photo"])] })).toBeNull();
  });
  it("동의하고 다 채워지면 통과", () => {
    expect(completionBlock({ consented: true, partySize: 2, guests: [g("A"), g("B")] })).toBeNull();
  });
});

describe("직원 확인 필요 판정", () => {
  it("다 갖춘 분은 아니다", () => expect(needsStaffCheck(ok)).toBe(false));
  it("얼굴 영상 없음", () => expect(needsStaffCheck({ ...ok, hasFaceVideo: false })).toBe(true));
  it("여권 없음 사유", () => expect(needsStaffCheck({ ...ok, noPassportReason: "not_shown" })).toBe(true));
  it("MRZ 검사 숫자가 틀림, 모름(null)은 아님", () => {
    expect(needsStaffCheck({ ...ok, mrzValid: false })).toBe(true);
    expect(needsStaffCheck({ ...ok, mrzValid: null })).toBe(false);
  });
  it("빠진 칸", () => expect(needsStaffCheck({ ...ok, missing: ["age"] })).toBe(true));
  it("인원 수를 센다", () => {
    expect(staffCheckCount([ok, { ...ok, hasFaceVideo: false }, { ...ok, mrzValid: false }])).toBe(2);
  });
});

describe("방 이름 접기 — 실제 표기", () => {
  const f = (key: string, raw: string) => {
    const form = roomForm(key, raw);
    return [form.display, form.matchKey, form.unitName];
  };
  it("가부키초 K202 · 202# → 202", () => {
    expect(f("kabukicho", "K202")).toEqual(["202", "202", false]);
    expect(f("kabukicho", "202#")).toEqual(["202", "202", false]);
  });
  it("아라키초B Ab101 → 101, 아라키초A 201_2 · 401_2_2 → 201 · 401", () => {
    expect(f("arakicho_b", "Ab101")[0]).toBe("101");
    expect(f("arakicho_a", "201_2")[0]).toBe("201");
    expect(f("arakicho_a", "401_2_2")[0]).toBe("401");
  });
  it("다카다노바바 2 ↔ 2f 는 같은 키", () => {
    expect(roomForm("takadanobaba", "2").matchKey).toBe(roomForm("takadanobaba", "2f").matchKey);
    expect(roomForm("takadanobaba", "401_2").display).toBe("4");
  });
  it("STAY ARI O101 → 101", () => {
    expect(f("stay_ari", "O101")[0]).toBe("101");
  });
  it("독채는 건물 이름 · unitName", () => {
    expect(f("okubo_a", "ファミリー")).toEqual(["오쿠보A", "오쿠보A", true]);
    expect(roomForm("okubo_c", "OkuboCC").display).toBe("오쿠보C");
    expect(roomForm("okubo_b", "오쿠보 2-1").unitName).toBe(true);
  });
});

describe("방 번호 찾기", () => {
  it("예약 이름과 번호표 이름이 달라도 건물 규칙으로 맞춘다", () => {
    expect(matchRoomCodes("kabukicho", ["K202", "202#"], [{ roomLabel: "202", code: "AAA" }])).toEqual([{ label: "202", code: "AAA", unit_name: false }]);
    expect(matchRoomCodes("arakicho_a", ["201_2", "401_2_2"], [{ roomLabel: "201", code: "A" }, { roomLabel: "401", code: "B" }])).toEqual([
      { label: "201", code: "A", unit_name: false },
      { label: "401", code: "B", unit_name: false },
    ]);
    expect(matchRoomCodes("takadanobaba", ["2"], [{ roomLabel: "2f", code: "C" }])).toEqual([{ label: "2", code: "C", unit_name: false }]);
    expect(matchRoomCodes("arakicho_b", ["Ab101"], [{ roomLabel: "101", code: "D" }])[0].code).toBe("D");
  });
  it("독채는 번호표의 어떤 줄이든 건물 하나로 맞는다", () => {
    expect(matchRoomCodes("okubo_a", ["ファミリー"], [{ roomLabel: "오쿠보A", code: "E" }])).toEqual([{ label: "오쿠보A", code: "E", unit_name: true }]);
  });
  it("못 찾거나 번호가 비면 null", () => {
    expect(matchRoomCodes("kabukicho", ["K999"], [{ roomLabel: "202", code: "" }, null, { roomLabel: 5, code: "X" }])).toEqual([
      { label: "999", code: null, unit_name: false },
    ]);
  });
  it("방 정보가 배열이 아니면 모두 null", () => {
    expect(matchRoomCodes("kabukicho", ["K201"], undefined)).toEqual([{ label: "201", code: null, unit_name: false }]);
    expect(matchRoomCodes("kabukicho", ["K201"], {})[0].code).toBeNull();
  });
});

describe("다시 보기 · 경쟁 · 이름으로 찾은 경우", () => {
  const now = new Date("2026-11-04T03:00:00Z");
  it("끝난 지 10분 안만 받는다", () => {
    expect(finishedWithinWindow("2026-11-04T02:55:00Z", now)).toBe(true);
    expect(finishedWithinWindow("2026-11-04T02:49:00Z", now)).toBe(false);
    expect(finishedWithinWindow("2026-11-04T03:05:00Z", now)).toBe(false);
    expect(finishedWithinWindow(null, now)).toBe(false);
  });
  it("경쟁에서 진 쪽: 정말 체크인된 경우만 already", () => {
    expect(raceOutcome("checked_in")).toEqual({ already: true });
    expect(raceOutcome("cancelled")).toEqual({ blocked: "cancelled" });
    expect(raceOutcome("expired")).toEqual({ blocked: "expired" });
    expect(raceOutcome(null)).toEqual({ blocked: "expired" });
  });
  it("지금 예약의 방을 쓰고, 전부 취소면 null", () => {
    const rooms = [{ reservation_id: "r1", room_label: "201" }, { reservation_id: "r2", room_label: "202" }];
    expect(currentRoomLabels(rooms, [{ id: "r1", status: "confirmed", room_label: "301" }, { id: "r2", status: "cancelled", room_label: "202" }])).toEqual(["301"]);
    expect(currentRoomLabels(rooms, [{ id: "r1", status: "cancelled", room_label: "201" }, { id: "r2", status: "no_show", room_label: "202" }])).toBeNull();
    expect(currentRoomLabels(rooms, [{ id: "r1", status: "confirmed", room_label: null }])).toEqual(["201"]);
  });
  it("본인 확인: 코드 · 여권으로 찾았으면 그 자체가 증명", () => {
    expect(identityProven(freshProof("code"))).toBe(true);
    expect(identityProven(freshProof("passport"))).toBe(true);
  });
  it("이름으로 찾았으면 여권 증명이 붙기 전에는 아니다 — 기록이 없거나 모르는 값도 아니다", () => {
    expect(identityProven(freshProof("name"))).toBe(false);
    expect(identityProven({ found_by: "name", passport_proof: true })).toBe(true);
    expect(identityProven({})).toBe(false);
    expect(identityProven(null)).toBe(false);
    expect(identityProven({ found_by: "other", passport_proof: true })).toBe(false);
  });
  it("새 찾기는 앞의 증명을 모두 지운다", () => {
    expect(freshProof("name")).toEqual({ found_by: "name" });
    expect(identityProven(freshProof("name"))).toBe(false); // 코드 → 이름 순서면 증명 없음
  });
  const L1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
  const L2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
  const good = `${L1}\n${L2}`;
  const names = ["Anna Eriksson"];
  it("서버가 띠를 읽는다 — 좋은 띠는 증명, 증명 판정은 이름으로 찾은 세션에서 나온다", () => {
    expect(parseMrzStrip(good)).toEqual({ surname: "ERIKSSON", givenNames: "ANNA MARIA" });
    expect(proveOutcome(freshProof("name"), good, names)).toBe("proven");
  });
  it("검사 숫자가 하나라도 틀리면 읽을 수 없는 띠", () => {
    const bad = `${L1}\n${L2.slice(0, 13)}740813${L2.slice(19)}`;
    expect(parseMrzStrip(bad)).toBeNull();
    expect(proveOutcome(freshProof("name"), bad, names)).toBe("unreadable");
    expect(parseMrzStrip(`${L1}\n${L2.slice(0, 43)}1`)).toBeNull();
  });
  it("다른 사람의 좋은 띠는 이름이 달라 name_mismatch", () => {
    const other = `${"P<UTOSMITH<<JOHN".padEnd(44, "<")}\n${L2}`;
    expect(parseMrzStrip(other)).toEqual({ surname: "SMITH", givenNames: "JOHN" });
    expect(proveOutcome(freshProof("name"), other, names)).toBe("name_mismatch");
  });
  it("띠가 없거나 깨졌으면 unreadable", () => {
    expect(proveOutcome(freshProof("name"), undefined, names)).toBe("unreadable");
    expect(proveOutcome(freshProof("name"), "garbage", names)).toBe("unreadable");
    expect(parseMrzStrip(L1)).toBeNull();
    expect(parseMrzStrip(`${L1}\n${L2.slice(0, 43)}`)).toBeNull();
    expect(parseMrzStrip(`${L1}\n${L2.replace("L8", "l8")}`)).toBeNull();
  });
  it("이미 증명된 세션(코드 · 여권 · 증명 끝)은 already", () => {
    expect(proveOutcome(freshProof("code"), undefined, names)).toBe("already");
    expect(proveOutcome({ found_by: "name", passport_proof: true }, "garbage", names)).toBe("already");
  });
  it("예약 이름과 다르면 name_mismatch", () => {
    expect(proveOutcome(freshProof("name"), good, ["Someone Else"])).toBe("name_mismatch");
  });
});

describe("본인 확인용 이름 맞추기(성 + 첫 이름)", () => {
  it("실제 여권 표기: 성이 둘 · 접두어 · 가운데 이름 · 순서 뒤집힘", () => {
    expect(nameMatchesProve("Ana Garcia", "GARCIA LOPEZ", "ANA")).toBe(true);
    expect(nameMatchesProve("Maria Cruz", "DE LA CRUZ", "MARIA")).toBe(true);
    expect(nameMatchesProve("Daniel James Hu", "HU", "DANIEL")).toBe(true);
    expect(nameMatchesProve("Kim Lee", "KIM", "LEE")).toBe(true);
  });
  it("성이 없거나 첫 이름이 다르면 안 맞는다", () => {
    expect(nameMatchesProve("Daniel James", "SMITH", "DANIEL JAMES")).toBe(false);
    expect(nameMatchesProve("De Silva", "SILVA", "JOHN")).toBe(false);
    expect(nameMatchesProve("Hu Mei", "HU", "DANIEL")).toBe(false);
    expect(nameMatchesProve("Ana Garcia", "GARCIA", "MARIA")).toBe(false);
  });
  it("알려진 한계: 가운데 이름만 같은 가족(Daniel James Hu ↔ HU/JAMES)은 통과한다", () => {
    expect(nameMatchesProve("Daniel James Hu", "HU", "JAMES")).toBe(true);
  });
  it("한 단어는 정확히 같아야 한다 · 이름 없는 여권은 성만 · 한자 예약은 못 맞춘다", () => {
    expect(nameMatchesProve("Madonna", "MADONNA", "")).toBe(true);
    expect(nameMatchesProve("Hu", "HU", "DANIEL")).toBe(false);
    expect(nameMatchesProve("Hu Mei", "HU", "")).toBe(false);
    expect(nameMatchesProve("胡 太郎", "HU", "TARO")).toBe(false);
  });
  it("prove 판정에서도 쓴다", () => {
    const strip = `${"P<UTOGARCIA<LOPEZ<<ANA".padEnd(44, "<")}\nL898902C36UTO7408122F1204159ZE184226B<<<<<10`;
    expect(proveOutcome(freshProof("name"), strip, ["Ana Garcia"])).toBe("proven");
  });
});

describe("찾을 때 잠금 결정", () => {
  const now = new Date("2026-11-04T03:00:00Z");
  const other = { device_id: "d2", locked_until: "2026-11-04T03:04:00Z", finished_at: null, abandoned_at: null };
  it("이름으로 찾으면 잠그지 않는다 · 코드 · 여권은 잠근다", () => {
    expect(holdDecision([], "d1", now, "name")).toEqual({ kind: "hold", lock: false });
    expect(holdDecision([], "d1", now, "code")).toEqual({ kind: "hold", lock: true });
    expect(holdDecision([], "d1", now, "passport")).toEqual({ kind: "hold", lock: true });
  });
  it("다른 기기가 진짜로 잡고 있으면 이름으로 찾아도 busy", () => {
    expect(holdDecision([other], "d1", now, "name")).toEqual({ kind: "busy" });
  });
  it("잠금 없는 다른 기기 세션(증명 안 된 이름 찾기)은 막지 않는다", () => {
    expect(holdDecision([{ ...other, locked_until: null }], "d1", now, "code")).toEqual({ kind: "hold", lock: true });
  });
});

describe("공용 번호 · 주소 · 건물 이름", () => {
  it("공용 번호 모양을 맞추고 빈 번호는 버린다", () => {
    expect(sharedCodesOf([{ labelKey: "keyBox", prefixKey: "floor1", code: "11" }, { labelKey: "doorPassword", code: " " }, { code: "1" }], "kabukicho")).toEqual([]);
    expect(sharedCodesOf(null, "kabukicho")).toEqual([]);
  });
  it("직원용 번호와 모르는 키는 손님에게 주지 않는다", () => {
    const entries = [
      { labelKey: "storage", code: "1" },
      { labelKey: "storagePassword", code: "2" },
      { labelKey: "linenStorageEntrancePassword", code: "3" },
      { labelKey: "somethingNew", code: "4" },
    ];
    expect(sharedCodesOf(entries, "kabukicho")).toEqual([]);
  });
  it("열쇠 보관함 번호는 정해진 건물에서만 나가고, 창고 · 린넨은 어디서도 안 나간다", () => {
    expect(GUEST_KEYBOX_BUILDINGS).toEqual(["stay_ari", "okubo_a", "okubo_b", "okubo_c", "takadanobaba"]);
    const entries = [
      { labelKey: "storage", code: "1" },
      { labelKey: "linenStorageEntrancePassword", code: "2" },
      { labelKey: "keyBoxPassword", code: "3" },
      { labelKey: "keyBox", code: "4", prefixKey: "floor1" },
    ];
    expect(sharedCodesOf(entries, "takadanobaba")).toEqual([
      { label_key: "keyBoxPassword", code: "3", prefix_key: null, note_key: null },
      { label_key: "keyBox", code: "4", prefix_key: "floor1", note_key: null },
    ]);
    for (const key of ["stay_ari", "okubo_a", "okubo_b", "okubo_c"]) expect(sharedCodesOf(entries, key)).toHaveLength(2);
    for (const key of ["kabukicho", "arakicho_a", "arakicho_b"]) expect(sharedCodesOf(entries, key)).toEqual([]);
  });
  it("출입문 · 방 번호는 모든 건물에서 앞말 · 안내 키와 함께 통과, 열쇠 보관함은 목록 밖 건물에서 막힌다", () => {
    const entries = [
      { labelKey: "doorPassword", code: "1" },
      { labelKey: "roomPassword", code: "2", noteKey: "allRoomsSame" },
      { labelKey: "keyBox", code: "3", prefixKey: "floor1" },
      { labelKey: "keyBoxPassword", code: "4" },
      { labelKey: "storage", code: "5" },
    ];
    expect(sharedCodesOf(entries, "kabukicho")).toEqual([
      { label_key: "doorPassword", code: "1", prefix_key: null, note_key: null },
      { label_key: "roomPassword", code: "2", prefix_key: null, note_key: "allRoomsSame" },
    ]);
  });
  it("주소는 없으면 null", () => {
    expect(addressOf(null)).toEqual({ ko: null, ja: null, en: null });
    expect(addressOf({ address_ko: " 서울 ", address_ja: "", address_en: null })).toEqual({ ko: "서울", ja: null, en: null });
  });
  it("건물 키로 정규 이름을 찾는다", () => {
    expect(canonicalNameOf("arakicho_a")).toBe("아라키초A");
    expect(canonicalNameOf("unknown")).toBeNull();
  });
});
