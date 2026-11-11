import { describe, expect, it } from "vitest";
import { readSiteDraft, siteFormErrorHref } from "@/lib/attendance-site-form";

// 근무지 저장 실패(2026-11-11) — 새 근무지는 `?site=` 가 비어 「첫 근무지」 폼으로 넘어가며 입력이 사라졌다.
describe("siteFormErrorHref", () => {
  const draft = { name: "본사", printName: "본사 1층", latitude: "35.6", longitude: "139.7", radius: "80", propertyId: "" };

  it("새 근무지는 site=new 에 입력값을 실어 돌아온다", () => {
    const href = siteFormErrorHref("", "site_save_failed", draft);
    const u = new URL(href, "https://x");
    expect(u.pathname).toBe("/admin/settings/attendance");
    expect(u.searchParams.get("site")).toBe("new");
    expect(u.searchParams.get("error")).toBe("site_save_failed");
    expect(readSiteDraft(Object.fromEntries(u.searchParams))).toEqual(draft);
  });

  it("있는 근무지는 그 근무지로, 입력값은 싣지 않는다(저장된 값이 기준)", () => {
    const u = new URL(siteFormErrorHref("s-1", "invalid_radius", draft), "https://x");
    expect(u.searchParams.get("site")).toBe("s-1");
    expect(u.searchParams.has("d_name")).toBe(false);
  });

  it("입력값이 없으면 draft 없음", () => {
    expect(readSiteDraft({ site: "new" })).toBeNull();
  });
});
