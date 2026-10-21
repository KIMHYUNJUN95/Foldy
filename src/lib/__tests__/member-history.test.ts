import { describe, expect, it } from "vitest";
import { formatMemberHistory } from "@/components/admin/users/member-history";
import { getDictionary } from "@/lib/i18n";
import type { MemberHistoryItem } from "@/lib/user-audit";

/** 멤버 「최근 변경」 글 만들기 — 2026-10-20 권한 정리 ④. 기록에는 코드값만 있고 글은 보는 사람 언어로 만든다. */
const at = "2026-10-20T03:15:00Z";
const item = (action: MemberHistoryItem["action"], meta: Record<string, unknown>): MemberHistoryItem => ({ id: action, at, actorName: "김현준", action, meta });
const teams = [{ id: "t1", name: "현장", kind: "field" }, { id: "t2", name: "사무실", kind: "office" }];

describe("formatMemberHistory", () => {
  const lines = formatMemberHistory(
    [
      item("member.role", { from: "staff", to: "cs_staff" }),
      item("member.status", { from: "active", to: "suspended" }),
      item("member.team", { from: "t1", to: "t2" }),
      item("member.payroll_admin", { to: true }),
      item("member.permission_grant", { key: "order_processor", effect: "grant", expires: null }),
      item("member.permission_grant", { key: "order_processor", effect: "deny", expires: "2026-11-19T14:59:59Z" }),
      item("member.permission_revoke", { key: "order_processor" }),
      item("member.permissions_auto_revoke", { keys: ["a", "b"] }),
      item("invite.create", {}),
    ],
    { dict: getDictionary("ko"), locale: "ko", teams },
  );

  it("코드값을 한국어 한 줄로", () => {
    expect(lines.map((line) => line.text)).toEqual([
      "역할 아르바이트 리더 → CS 관리자",
      "상태 활성 → 비활성",
      "소속 현장 → 사무실",
      "급여 담당 켬",
      "주문 처리 개인 부여 · 무기한",
      "주문 처리 개인 차단 · 11월 19일까지",
      "주문 처리 개인 지정 회수",
      "비활성 · 개인 지정 2개 회수",
    ]);
  });

  it("멤버 기록이 아닌 줄(초대코드)은 빼고, 누가 · 언제를 붙인다", () => {
    expect(lines).toHaveLength(8);
    expect(lines[0].meta).toContain("김현준");
  });
});
