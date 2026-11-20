import { describe, expect, it } from "vitest";
import {
  beginSave,
  confirmOkLabel,
  dismissError,
  expireSaved,
  initSave,
  isValidPayDay,
  needsResave,
  pickSettingsOrganization,
  pickedValueAfter,
  settleSaveResponse,
  shouldResavePayDay,
  touchSave,
  type SaveState,
} from "@/lib/settings-display";
import { dotDateKey, dotDateOfIso } from "@/lib/users-display";

const orgs = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("pickSettingsOrganization — 조직 설정 처음 선택", () => {
  it("?org 가 없으면 지금 보고 있는 조직", () => {
    expect(pickSettingsOrganization(orgs, "", "b")?.id).toBe("b");
  });
  it("지금 조직이 목록에 없거나 없으면 첫 조직", () => {
    expect(pickSettingsOrganization(orgs, "", "zz")?.id).toBe("a");
    expect(pickSettingsOrganization(orgs, null, null)?.id).toBe("a");
  });
  it("?org 가 있으면 그 조직, 목록에 없으면 null(찾을 수 없음)", () => {
    expect(pickSettingsOrganization(orgs, "c", "b")?.id).toBe("c");
    expect(pickSettingsOrganization(orgs, "missing", "b")).toBeNull();
  });
  it("빈 목록이면 null", () => {
    expect(pickSettingsOrganization([], "", "b")).toBeNull();
  });
});

describe("날짜 점 표기 — 설정 · 내 계정", () => {
  it("도쿄 기준 — UTC 15시 이후는 다음 날", () => {
    expect(dotDateOfIso("2026-11-19T15:30:00Z")).toBe("2026.11.20");
    expect(dotDateOfIso("2026-11-19T14:59:00Z")).toBe("2026.11.19");
  });
  it("빈 값은 빈 문자열", () => {
    expect(dotDateOfIso(null)).toBe("");
  });
  it("생년월일 키", () => {
    expect(dotDateKey("1995-03-07")).toBe("1995.03.07");
  });
});

describe("confirmOkLabel — 확인 창 실행 단추", () => {
  it("기다리는 동안만 「…하는 중」", () => {
    expect(confirmOkLabel("삭제", "지우는 중", true)).toBe("지우는 중");
    expect(confirmOkLabel("삭제", "지우는 중", false)).toBe("삭제");
    expect(confirmOkLabel("삭제", undefined, true)).toBe("삭제");
  });
});

// 설정 › 급여 자동 저장 — 재검사 상황표(2026-11-20)를 사건 순서 그대로 돌린다.
const ok = <V,>(value: V) => ({ ok: true as const, value });
const fail = { ok: false as const, message: "저장 실패" };
function begin<V>(s: SaveState<V>) {
  return beginSave(s);
}

describe("자동 저장 칸 상태 — 서버 확인 값은 ok 면 늘 갱신, 표시는 마지막 요청만", () => {
  it("1a. O→X 저장 중(A) 다시 O 로 되돌리고 벗어남(건너뜀) → A 성공: 서버 값 X, 화면 O 다시 저장", () => {
    let s = initSave("O");
    const a = begin(s); s = a.state; // X 보냄
    s = touchSave(s); // 다시 O 로 고침
    // 벗어남: 화면 O === 서버 확인 값 O → 건너뜀(아직 A 응답 전)
    expect("O" === s.confirmed).toBe(true);
    const r = settleSaveResponse(s, a.ticket, ok("X"));
    s = r.state;
    expect(r.latest).toBe(false);
    expect(s.confirmed).toBe("X"); // 낡은 성공도 서버 확인 값은 갱신
    expect(s.savedSeq).toBeNull(); // 표시는 안 바꿈
    expect(needsResave(s, "O", false)).toBe(true); // 편집 중 아님 → 화면 값 O 다시 저장
    expect(needsResave(s, "O", true)).toBe(false); // 편집 중이면 벗어날 때 저장
  });

  it("1b. 되돌린 뒤 A 성공이 먼저 오고 벗어남 → 벗어날 때 O ≠ X 라 다시 저장된다", () => {
    let s = initSave(10);
    const a = begin(s); s = a.state; // 15
    s = touchSave(s); // 10 으로 되돌리는 중
    s = settleSaveResponse(s, a.ticket, ok(15)).state;
    expect(s.confirmed).toBe(15);
    expect(10 === s.confirmed).toBe(false); // commit 이 건너뛰지 않음
  });

  it("1c. A 성공(낡음) 뒤 B 실패 → 서버 확인 값은 A, 오류는 B 칸에 남고 다시 저장하지 않음", () => {
    let s = initSave("O");
    const a = begin(s); s = a.state; // X
    const b = begin(s); s = b.state; // Y
    s = settleSaveResponse(s, a.ticket, ok("X")).state;
    s = settleSaveResponse(s, b.ticket, fail).state;
    expect(s.confirmed).toBe("X");
    expect(s.error).toBe("저장 실패");
    expect(s.savedSeq).toBeNull();
    expect(needsResave(s, "Y", false)).toBe(false);
  });

  it("마지막 요청이 실패하면 「저장됨」 없음 · 먼저 보낸 성공이 늦게 와도 표시는 안 바뀜", () => {
    let s = initSave("O");
    const a = begin(s); s = a.state;
    const b = begin(s); s = b.state;
    s = settleSaveResponse(s, b.ticket, fail).state;
    s = settleSaveResponse(s, a.ticket, ok("A")).state;
    expect(s.savedSeq).toBeNull();
    expect(s.error).toBe("저장 실패");
    expect(s.confirmed).toBe("A");
  });

  it("2a. 결재 1 · 2 는 번호가 따로 — 1번 X(A) → 2번 Y(B) → A 실패: 1번 화면은 서버 확인 값으로", () => {
    let senmu = initSave("s0");
    let president = initSave("p0");
    const a = begin(senmu); senmu = a.state;
    const b = begin(president); president = b.state;
    const r = settleSaveResponse(senmu, a.ticket, fail);
    senmu = r.state;
    expect(r.latest).toBe(true); // 2번 요청이 1번 번호를 올리지 않는다
    expect(pickedValueAfter(senmu, "X", r.newerPending)).toBe("s0");
    expect(senmu.error).toBe("저장 실패");
    expect(president.inflight).toEqual([b.ticket]);
  });

  it("2b. 같은 칸 X(A) → Y(B) 둘 다 실패 → 화면은 prev(X)가 아니라 서버 확인 값(원래 값)", () => {
    let s = initSave("orig");
    const a = begin(s); s = a.state;
    const b = begin(s); s = b.state;
    const ra = settleSaveResponse(s, a.ticket, fail); s = ra.state;
    expect(ra.newerPending).toBe(true);
    expect(pickedValueAfter(s, "Y", ra.newerPending)).toBe("Y"); // B 기다리는 중 — 그대로
    const rb = settleSaveResponse(s, b.ticket, fail); s = rb.state;
    expect(pickedValueAfter(s, "Y", rb.newerPending)).toBe("orig");
  });

  it("2c. B 실패가 먼저, A 성공이 늦게 → 화면은 서버에 들어간 X", () => {
    let s = initSave("orig");
    const a = begin(s); s = a.state;
    const b = begin(s); s = b.state;
    const rb = settleSaveResponse(s, b.ticket, fail); s = rb.state;
    expect(pickedValueAfter(s, "Y", rb.newerPending)).toBe("orig");
    const ra = settleSaveResponse(s, a.ticket, ok("X")); s = ra.state;
    expect(pickedValueAfter(s, "orig", ra.newerPending)).toBe("X");
  });

  it("3. 요율은 해마다 따로 — 2025 저장 중 2026 을 열어도 2025 응답은 2026 상태를 건드리지 않음", () => {
    let y2025 = initSave<number | null>(1.5);
    const y2026 = initSave<number | null>(null);
    const a = begin(y2025); y2025 = a.state;
    const r = settleSaveResponse(y2025, a.ticket, ok(2));
    expect(r.latest).toBe(true);
    expect(r.state.confirmed).toBe(2);
    expect(y2026).toEqual(initSave(null));
  });

  it("3b. 요율 저장 중 다시 고친 뒤 취소 → 낡은 성공도 표의 값(서버 확인 값)은 갱신", () => {
    let s = initSave<number | null>(1.5);
    const a = begin(s); s = a.state;
    s = touchSave(s);
    s = settleSaveResponse(s, a.ticket, ok(2)).state;
    expect(s.confirmed).toBe(2);
    expect(s.savedSeq).toBeNull();
  });

  it("4. 칸별 오류 · 「저장됨」 — 다른 칸 성공 · 실패가 앞 칸 표시를 지우거나 덮지 않음", () => {
    let company = initSave("O");
    let payDay = initSave(10);
    const c = begin(company); company = c.state;
    company = settleSaveResponse(company, c.ticket, fail).state;
    const p = begin(payDay); payDay = p.state;
    payDay = settleSaveResponse(payDay, p.ticket, ok(15)).state;
    expect(company.error).toBe("저장 실패"); // 다른 칸 성공에도 유지
    expect(payDay.savedSeq).toBe(p.ticket);
    // 오류는 그 칸을 고칠 때 사라짐
    expect(touchSave(company).error).toBeNull();
    // 다시 저장 성공해도 사라짐
    const c2 = begin(company);
    expect(settleSaveResponse(c2.state, c2.ticket, ok("X")).state.error).toBeNull();
  });

  it("4b. 「저장됨」은 시간이 지나면 사라지되, 그사이 새 사건이 있었으면 새 표시를 지우지 않음", () => {
    let s = initSave("O");
    const a = begin(s); s = settleSaveResponse(a.state, a.ticket, ok("X")).state;
    const first = s.savedSeq!;
    expect(expireSaved(s, first).savedSeq).toBeNull();
    const b = begin(s); s = settleSaveResponse(b.state, b.ticket, ok("Y")).state;
    expect(expireSaved(s, first).savedSeq).toBe(b.ticket);
  });
});

describe("needsResave — 다시 저장하지 않는 경우", () => {
  // 서버 확인 값 X, 화면 값 O — 나머지 조건만 바꿔 본다.
  const base: SaveState<string> = { ...initSave("X"), seq: 1 };
  it("편집 중이 아니고 · 기다리는 요청 · 오류가 없고 · 값이 다르면 다시 저장", () => {
    expect(needsResave(base, "O", false)).toBe(true);
  });
  it("편집 중이면 안 함(벗어날 때 저장된다)", () => {
    expect(needsResave(base, "O", true)).toBe(false);
  });
  it("기다리는 요청이 있으면 안 함(그 응답을 먼저 받는다)", () => {
    expect(needsResave(beginSave(base).state, "O", false)).toBe(false);
  });
  it("오류가 있으면 안 함(실패를 보여 주고 사용자가 고친다)", () => {
    expect(needsResave({ ...base, error: "저장 실패" }, "O", false)).toBe(false);
  });
  it("값이 같으면 안 함", () => {
    expect(needsResave(base, "X", false)).toBe(false);
  });
});

describe("지급일 다시 저장 — 1~28 이 아닌 글자는 보내지 않음", () => {
  const s: SaveState<number> = initSave(10);
  it("isValidPayDay 는 서버와 같은 1~28 정수", () => {
    expect([1, 28].map(isValidPayDay)).toEqual([true, true]);
    expect([0, 29, 10.5, NaN].map(isValidPayDay)).toEqual([false, false, false, false]);
  });
  it("올바른 다른 값이면 다시 저장", () => {
    expect(shouldResavePayDay(s, "15", false)).toBe(true);
  });
  it("범위 밖 · 소수 · 빈 칸이면 다시 저장 안 함", () => {
    for (const text of ["0", "29", "10.5", "", "abc"]) expect(shouldResavePayDay(s, text, false)).toBe(false);
  });
  it("편집 중 · 같은 값이면 안 함", () => {
    expect(shouldResavePayDay(s, "15", true)).toBe(false);
    expect(shouldResavePayDay(s, "10", false)).toBe(false);
  });
});

describe("dismissError — 다시 열 때 오류만 지움", () => {
  it("오류만 지우고 번호 · 기다리는 요청은 그대로(늦은 응답 표시는 살아 있음)", () => {
    const b = beginSave(initSave<number | null>(1.5));
    const s = { ...b.state, error: "저장 실패" };
    const d = dismissError(s);
    expect(d.error).toBeNull();
    expect(d.seq).toBe(s.seq);
    expect(d.inflight).toEqual(s.inflight);
    expect(settleSaveResponse(d, b.ticket, fail).state.error).toBe("저장 실패");
  });
  it("오류가 없으면 같은 객체(다시 그리지 않음)", () => {
    const s = initSave(1);
    expect(dismissError(s)).toBe(s);
  });
});
