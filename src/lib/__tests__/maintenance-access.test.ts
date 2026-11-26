import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/capabilities-server", () => ({ memberCapabilities: async (_o: string, u: string) => (u === "yes" ? ["maintenance_status_change"] : []) }));

import { canHandleMaintenance } from "@/lib/maintenance-access";

describe("canHandleMaintenance", () => {
  it("권한 키가 있을 때만 통과", async () => {
    expect(await canHandleMaintenance("o", "yes")).toBe(true);
    expect(await canHandleMaintenance("o", "no")).toBe(false);
  });
  it("「use server」 파일은 이 판정을 내보내지 않는다(내보내면 누구나 부르는 액션)", () => {
    const src = readFileSync("src/app/mobile/requests/maintenance/actions.ts", "utf8");
    expect(src).not.toMatch(/export\s+async\s+function\s+canHandleMaintenance/);
  });
});
