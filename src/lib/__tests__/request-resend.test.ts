import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fake-supabase";
import { isOwnResentRequest } from "@/lib/request-resend";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dup = { code: "23505" };

describe("요청 등록 다시 보내기(같은 id)", () => {
  const fake = createFakeSupabase({
    maintenance_reports: [{ id: ID, organization_id: "org", reported_by_user_id: "me" }],
  });
  const client = fake.client;

  it("내가 이미 저장한 같은 id 면 성공으로 본다", async () => {
    expect(await isOwnResentRequest(client, "maintenance_reports", { error: dup, id: ID, organizationId: "org", userId: "me" })).toBe(true);
  });
  it("남의 행이면 성공이 아니다", async () => {
    expect(await isOwnResentRequest(client, "maintenance_reports", { error: dup, id: ID, organizationId: "org", userId: "other" })).toBe(false);
  });
  it("PK 중복이 아닌 오류는 그대로 실패", async () => {
    expect(await isOwnResentRequest(client, "maintenance_reports", { error: { code: "42501" }, id: ID, organizationId: "org", userId: "me" })).toBe(false);
  });
});
