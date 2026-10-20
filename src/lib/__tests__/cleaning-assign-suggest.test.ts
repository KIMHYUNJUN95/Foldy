import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGN_RULES, normalizeAssignRules } from "@/lib/cleaning-assign/rules";
import { suggestAssignments, type SuggestPerson, type SuggestRoom } from "@/lib/cleaning-assign/suggest";

const person = (userId: string, extra: Partial<SuggestPerson> = {}): SuggestPerson => ({
  userId,
  roomsToday: 0,
  propertiesToday: [],
  priority: false,
  trainee: false,
  trainer: false,
  monthDays: 0,
  startMinutes: null,
  ...extra,
});
const room = (roomKey: string, propertyName = "A", need = 1, assigned: string[] = []): SuggestRoom => ({ roomKey, propertyName, need, assigned });

describe("청소 배정 — 제안 규칙 정리", () => {
  it("모르는 키 · 중복은 버리고 빠진 키는 처음 값으로 맨 뒤에", () => {
    const rules = normalizeAssignRules([{ key: "priority", enabled: false }, { key: "nope", enabled: true }, { key: "priority", enabled: true }]);
    expect(rules[0]).toEqual({ key: "priority", enabled: false });
    expect(rules.map((r) => r.key)).toHaveLength(DEFAULT_ASSIGN_RULES.length);
    expect(rules.slice(1).map((r) => r.key)).toEqual(DEFAULT_ASSIGN_RULES.filter((r) => r.key !== "priority").map((r) => r.key));
  });
  it("저장값이 없으면 처음 값", () => {
    expect(normalizeAssignRules(null)).toEqual(DEFAULT_ASSIGN_RULES);
  });
});

describe("청소 배정 — 자동 제안", () => {
  const rules = [...DEFAULT_ASSIGN_RULES];

  it("배정 전인 사람부터 고르게 나눈다", () => {
    const out = suggestAssignments({
      rooms: [room("r1"), room("r2")],
      people: [person("a", { roomsToday: 1 }), person("b"), person("c")],
      rules,
      fixedTiers: {},
    });
    expect(out.map((s) => s.userId).sort()).toEqual(["b", "c"]);
  });

  it("고정 인력이 먼저지만 그날 몫을 넘겨 혼자 다 가져가지 않는다", () => {
    const out = suggestAssignments({
      rooms: [room("r1"), room("r2"), room("r3"), room("r4")],
      people: [person("fix"), person("x")],
      rules,
      fixedTiers: { A: { fix: 1 } },
    });
    const byUser = (id: string) => out.filter((s) => s.userId === id).length;
    expect(out[0]).toEqual({ roomKey: "r1", userId: "fix" });
    expect(byUser("fix")).toBe(2);
    expect(byUser("x")).toBe(2);
  });

  it("고정 순위 1 이 2 보다 먼저", () => {
    const out = suggestAssignments({ rooms: [room("r1")], people: [person("two"), person("one")], rules, fixedTiers: { A: { one: 1, two: 2 } } });
    expect(out).toEqual([{ roomKey: "r1", userId: "one" }]);
  });

  it("견습은 견습 담당이 있는 방에만 — 혼자 두지 않는다", () => {
    const out = suggestAssignments({
      rooms: [room("solo"), room("big", "A", 2)],
      people: [person("t", { trainee: true }), person("lead", { trainer: true })],
      rules,
      fixedTiers: {},
    });
    expect(out.filter((s) => s.userId === "t").map((s) => s.roomKey)).toEqual(["big"]);
    expect(out.some((s) => s.roomKey === "solo" && s.userId === "t")).toBe(false);
  });

  it("같은 사람을 같은 방에 두 번 넣지 않는다 · 이미 들어간 사람은 건너뛴다", () => {
    const out = suggestAssignments({ rooms: [room("big", "A", 2, ["a"])], people: [person("a"), person("b")], rules, fixedTiers: {} });
    expect(out).toEqual([{ roomKey: "big", userId: "b" }]);
  });

  it("사람이 모자라면 남는 자리는 비운다", () => {
    const out = suggestAssignments({ rooms: [room("big", "A", 3)], people: [person("a")], rules, fixedTiers: {} });
    expect(out).toEqual([{ roomKey: "big", userId: "a" }]);
  });

  it("우선 배정 표시가 방 수가 같을 때 먼저", () => {
    const out = suggestAssignments({ rooms: [room("r1")], people: [person("a"), person("p", { priority: true })], rules, fixedTiers: {} });
    expect(out[0].userId).toBe("p");
  });

  it("「고정 인력 먼저 넣기」는 그 건물 고정 인력만", () => {
    const out = suggestAssignments({
      rooms: [room("a1", "A"), room("b1", "B")],
      people: [person("fa"), person("other")],
      rules,
      fixedTiers: { A: { fa: 1 } },
      onlyFixed: true,
    });
    expect(out).toEqual([{ roomKey: "a1", userId: "fa" }]);
  });

  it("규칙을 끄면 그 기준을 보지 않는다", () => {
    const off = rules.map((r) => ({ ...r, enabled: r.key === "fewest_rooms" ? true : false }));
    const out = suggestAssignments({ rooms: [room("r1")], people: [person("a"), person("p", { priority: true })], rules: off, fixedTiers: {} });
    expect(out[0].userId).toBe("a");
  });
});
