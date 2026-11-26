import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 「계좌 바뀜」 확인 단추는 서버가 canConfirmBank 로 계산한 값만 본다(판정을 클라이언트에서 다시 만들지 않는다). */
describe("급여 준비 계좌 확인 단추", () => {
  it("줄마다 bankConfirmable 을 보고, 서버가 canConfirmBank 로 채운다", () => {
    const client = readFileSync("src/components/admin/attendance/payroll-prep/payroll-prep-client.tsx", "utf8");
    expect(client).toContain("data.bankConfirmable[r.userId]");
    const server = readFileSync("src/lib/payroll-prep-server.ts", "utf8");
    expect(server).toMatch(/canConfirmBank\(\{ role: session\.user\.role, isSelf: r\.userId === session\.user\.id, canManage \}\)/);
  });
  it("재류카드 확인 update 에 조직 조건이 있다", () => {
    const src = readFileSync("src/app/account/id-card/actions.ts", "utf8");
    expect(src).toMatch(/\.eq\("id", input\.documentId\)\s*\.eq\("organization_id", session\.organization\.id\);/);
  });
});
