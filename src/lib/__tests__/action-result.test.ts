import { describe, expect, it } from "vitest";
import { actionResult } from "@/lib/action-result";

/**
 * 누르는 서버 액션의 예외(네트워크 끊김 · 서버 오류)를 결과 모양으로 바꾼다(2026-11-19 화면 확인) — 트랜지션 안에서 던지면
 * 오류 경계가 화면 전체를 「문제가 발생했어요」로 갈아치우고 초안이 사라진다. 결과가 실패일 때와 같은 길로 보내야 한다.
 */
describe("actionResult", () => {
  it("성공 결과는 그대로", async () => {
    await expect(actionResult(async () => ({ ok: true as const, version: "v" }), "save_failed")).resolves.toEqual({ ok: true, version: "v" });
  });

  it("실패 결과도 그대로(서버가 준 코드 유지)", async () => {
    await expect(actionResult(async () => ({ error: "no_destination" as const, ok: false as const }), "save_failed")).resolves.toEqual({
      error: "no_destination",
      ok: false,
    });
  });

  it("던지면(네트워크 끊김) 던지지 않고 실패 결과 — 주어진 코드", async () => {
    await expect(
      actionResult(async (): Promise<{ ok: true }> => {
        throw new TypeError("Failed to fetch");
      }, "save_failed"),
    ).resolves.toEqual({ error: "save_failed", ok: false });
  });

  it("부르는 순간 던져도 실패 결과", async () => {
    await expect(
      actionResult((): Promise<{ ok: true }> => {
        throw new Error("sync");
      }, "save_failed"),
    ).resolves.toEqual({ error: "save_failed", ok: false });
  });
});
