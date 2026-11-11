import { describe, expect, it } from "vitest";
import { settleAction } from "@/lib/settle-action";

// 화면에서 서버 액션을 부를 때(2026-11-11) — 네트워크가 끊기면 액션이 결과 대신 던진다. 던짐을 결과로 바꿔
// 「바쁨」이 안 풀리거나 아무 말 없이 멈추는 일이 없게 한다.
describe("settleAction", () => {
  it("돌려준 값은 그대로", async () => {
    await expect(settleAction(async () => ({ ok: true as const, id: "x" }))).resolves.toEqual({ thrown: false, value: { ok: true, id: "x" } });
  });

  it("던지면 thrown", async () => {
    await expect(
      settleAction(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).resolves.toEqual({ thrown: true });
  });
});
