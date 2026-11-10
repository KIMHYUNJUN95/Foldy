import { describe, expect, it } from "vitest";
import { canDeleteRequestRecord } from "@/lib/request-delete-rule";

describe("canDeleteRequestRecord", () => {
  it("관리 권한(request.delete_any)은 어떤 상태든 지울 수 있다", () => {
    for (const status of ["requested", "approved", "ordered", "received", "closed"]) {
      expect(canDeleteRequestRecord({ canDeleteAny: true, isOwner: false, orderStatus: status })).toBe(true);
    }
  });
  it("작성자 본인은 requested · approved · closed 만", () => {
    for (const status of ["requested", "approved", "closed"]) {
      expect(canDeleteRequestRecord({ canDeleteAny: false, isOwner: true, orderStatus: status })).toBe(true);
    }
    for (const status of ["ordered", "received"]) {
      expect(canDeleteRequestRecord({ canDeleteAny: false, isOwner: true, orderStatus: status })).toBe(false);
    }
  });
  it("작성자도 관리자도 아니면 못 지운다", () => {
    expect(canDeleteRequestRecord({ canDeleteAny: false, isOwner: false, orderStatus: "requested" })).toBe(false);
  });
  it("상태 제약이 없는 분실물 · 수리는 작성자면 된다", () => {
    expect(canDeleteRequestRecord({ canDeleteAny: false, isOwner: true })).toBe(true);
    expect(canDeleteRequestRecord({ canDeleteAny: false, isOwner: false })).toBe(false);
  });
});
