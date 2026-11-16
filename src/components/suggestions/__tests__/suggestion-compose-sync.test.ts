import { describe, expect, it } from "vitest";

import { nextServerErrorSync } from "../suggestion-compose-errors";
import { dropFromReferences, pickRecipient, pickReferences } from "../suggestion-compose-pick";

describe("nextServerErrorSync", () => {
  const start = { seen: "save_failed", appliedAttempt: 0 };

  it("처음 그린 뒤에는 다시 걸지 않는다", () => {
    expect(nextServerErrorSync(start, { serverError: "save_failed", pending: false, sentAttempt: 0 })).toBeNull();
  });

  it("같은 오류가 두 번 와도 서버에 보낸 시도가 끝나면 다시 건다", () => {
    expect(nextServerErrorSync(start, { serverError: "save_failed", pending: true, sentAttempt: 1 })).toBeNull();
    const next = nextServerErrorSync(start, { serverError: "save_failed", pending: false, sentAttempt: 1 });
    expect(next).toEqual({ seen: "save_failed", appliedAttempt: 1 });
    expect(nextServerErrorSync(next!, { serverError: "save_failed", pending: false, sentAttempt: 1 })).toBeNull();
  });

  it("서버까지 못 간 시도(업로드 실패)는 다시 걸지 않는다", () => {
    expect(nextServerErrorSync(start, { serverError: "save_failed", pending: false, sentAttempt: 0 })).toBeNull();
  });

  it("값이 바뀌면 바로 건다", () => {
    expect(nextServerErrorSync(start, { serverError: "missing_title", pending: false, sentAttempt: 0 })).toEqual({
      seen: "missing_title",
      appliedAttempt: 0,
    });
  });
});

describe("pick helpers", () => {
  const a = { id: "a", name: "A" };
  const b = { id: "b", name: "B" };
  const gone = { id: "gone", name: "퇴사자" };

  it("목록에 없는 지금 받는 사람은 그대로 확정해도 남는다", () => {
    expect(pickRecipient(gone, ["gone"], [a, b])).toBe(gone);
  });

  it("다른 사람을 고르면 바뀌고, 비우면 없어진다", () => {
    expect(pickRecipient(gone, ["a"], [a, b])).toBe(a);
    expect(pickRecipient(a, [], [a, b])).toBeNull();
  });

  it("참조는 목록에 없는 기존 사람을 지키고 받는 사람을 뺀다", () => {
    expect(pickReferences([gone], ["gone", "a", "b"], [a, b], "b")).toEqual([gone, a]);
  });

  it("받는 사람으로 바뀐 사람은 참조에서 빠진다", () => {
    expect(dropFromReferences([a, b], "a")).toEqual([b]);
    expect(dropFromReferences([a, b], null)).toEqual([a, b]);
  });
});
