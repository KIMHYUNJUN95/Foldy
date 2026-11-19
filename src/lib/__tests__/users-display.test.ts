import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { inviteFormDefaults } from "@/lib/invite-code-gen";
import { formatPhoneDisplay } from "@/lib/phone-format";
import { RESIDENCE_STATUSES } from "@/lib/staff-documents/fields";
import {
  dotDateKey,
  dotDateOfIso,
  nationalityTextDisplay,
  pickDefaultInviteOrganization,
  residenceStatusDisplay,
  residenceStatusText,
} from "@/lib/users-display";

// 직원 목록 unslop(2026-11-19) — 그릴 때만 바꾸는 표시 규칙.
describe("사용자 관리 전화번호 표시", () => {
  it("저장된 E.164 를 하이픈으로 끊는다", () => {
    expect(formatPhoneDisplay("+819041203381")).toBe("+81-90-4120-3381");
  });
  it("빈 값은 빈 문자열(화면은 「—」)", () => {
    expect(formatPhoneDisplay(null)).toBe("");
  });
});

describe("dotDateKey · dotDateOfIso — 날짜는 「2026.11.19」 하나", () => {
  it("날짜 키를 점으로 잇는다(앞 0 유지)", () => {
    expect(dotDateKey("2027-12-24")).toBe("2027.12.24");
    expect(dotDateKey("2026-01-05")).toBe("2026.01.05");
  });
  it("빈 값은 빈 문자열", () => {
    expect(dotDateKey("")).toBe("");
    expect(dotDateKey(null)).toBe("");
  });
  it("timestamptz 는 도쿄 날짜로 — UTC 전날 15시 이후는 다음 날", () => {
    expect(dotDateOfIso("2026-11-18T15:30:00Z")).toBe("2026.11.19");
    expect(dotDateOfIso("2026-11-18T14:59:00Z")).toBe("2026.11.18");
  });
});

describe("pickDefaultInviteOrganization — 초대 기본 조직은 지금 조직", () => {
  const orgs = [
    { id: "a", name: "perf-search" },
    { id: "b", name: "Stay" },
  ];
  it("지금 조직이 목록에 있으면 그 조직", () => {
    expect(pickDefaultInviteOrganization(orgs, "b")?.id).toBe("b");
  });
  it("목록에 없으면(플랫폼 등) 첫 조직", () => {
    expect(pickDefaultInviteOrganization(orgs, "platform")?.id).toBe("a");
    expect(pickDefaultInviteOrganization(orgs, null)?.id).toBe("a");
  });
  it("관리할 조직이 없으면 null", () => {
    expect(pickDefaultInviteOrganization([], "b")).toBeNull();
  });
  it("초대 폼 처음 값(PC · 모바일 같은 함수) — 지금 조직 · 그 조직 코드 앞자리 · 오늘+30일 · 10명", () => {
    const orgs = [
      { id: "org-a", slug: "alpha", name: "Alpha" },
      { id: "org-b", slug: "beta", name: "Beta" },
    ];
    const picked = inviteFormDefaults(orgs, "org-b", "2026-11-19");
    expect(picked.organizationId).toBe("org-b");
    expect(picked.code).toMatch(/^BETA-/);
    expect(picked.expiresAt).toBe("2026-12-19");
    expect(picked.maxUses).toBe(10);
    expect(inviteFormDefaults(orgs, "platform", "2026-11-19").organizationId).toBe("org-a");
    expect(inviteFormDefaults([], "org-a", "2026-11-19").organizationId).toBe("");
  });
  it("PC · 모바일 초대 화면이 같은 처음 값 함수를 쓴다(보조 확인)", () => {
    for (const file of ["src/app/admin/users/invites/page.tsx", "src/app/mobile/users/invites/page.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).toMatch(/inviteFormDefaults\(/);
    }
  });
  it("PC · 모바일 초대 화면이 목록 첫 조직을 기본값으로 쓰지 않는다", () => {
    for (const file of [
      "src/app/admin/users/invites/page.tsx",
      "src/app/mobile/users/invites/page.tsx",
      "src/components/admin/users/invite-create-form.tsx",
      "src/components/mobile/users/mobile-invites.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/organizations\[0\]/);
    }
  });
});

describe("residenceStatusDisplay — 재류자격은 화면 언어 + 원문", () => {
  const ko = getDictionary("ko").idCard.residenceStatusNames;
  const en = getDictionary("en").idCard.residenceStatusNames;
  const ja = getDictionary("ja").idCard.residenceStatusNames;
  it("한국어 화면: 번역 + 원문", () => {
    expect(residenceStatusDisplay("留学", ko)).toEqual({ label: "유학", original: "留学" });
    expect(residenceStatusDisplay("特定技能1号", ko)).toEqual({ label: "특정기능 1호", original: "特定技能1号" });
    expect(residenceStatusDisplay("技術・人文知識・国際業務", ko).label).toBe("기술 · 인문지식 · 국제업무");
  });
  it("전각 숫자도 같은 자격으로 본다", () => {
    expect(residenceStatusDisplay("特定技能１号", ko).label).toBe("특정기능 1호");
  });
  it("영어 화면도 번역", () => {
    expect(residenceStatusDisplay("永住者", en)).toEqual({ label: "Permanent Resident", original: "永住者" });
  });
  it("일본어 화면 · 모르는 자격은 원문만", () => {
    expect(residenceStatusDisplay("留学", ja)).toEqual({ label: "留学", original: null });
    expect(residenceStatusDisplay("興行", ko)).toEqual({ label: "興行", original: null });
    expect(residenceStatusDisplay("", ko)).toEqual({ label: "", original: null });
  });
  it("세 언어 사전의 키가 같고, 일본어는 원문 그대로", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    expect(Object.keys(ja).sort()).toEqual(Object.keys(ko).sort());
    for (const [key, value] of Object.entries(ja)) expect(value).toBe(key);
  });
  it("사전 키는 저장 규칙(NFKC)과 같은 모양", () => {
    for (const key of Object.keys(ko)) expect(key).toBe(key.normalize("NFKC"));
  });
  it("카드에 고를 수 있는 재류자격은 세 언어 사전에 모두 있다", () => {
    for (const status of RESIDENCE_STATUSES) {
      expect(ko[status], `ko ${status}`).toBeTruthy();
      expect(en[status], `en ${status}`).toBeTruthy();
      expect(ja[status], `ja ${status}`).toBe(status);
    }
  });
  it("글자로 이을 때(title · 목록) 번역과 원문 사이에 띄어쓰기", () => {
    expect(residenceStatusText("特定技能1号", ko)).toBe("특정기능 1호 特定技能1号");
    expect(residenceStatusText("留学", ja)).toBe("留学");
    expect(residenceStatusText("", ko)).toBe("");
  });
  it("한국어 번역에 한자가 없다", () => {
    for (const value of Object.values(ko)) expect(value).not.toMatch(/[一-鿿]/);
  });
});

describe("nationalityTextDisplay — 국적 코드는 나라 이름으로", () => {
  it("두 글자 코드 → 화면 언어 이름", () => {
    expect(nationalityTextDisplay("VN", "ko")).toBe("베트남");
    expect(nationalityTextDisplay("vn", "en")).toBe("Vietnam");
    expect(nationalityTextDisplay("VN", "ja")).toBe("ベトナム");
  });
  it("글자로 적힌 값 · 모르는 코드는 그대로", () => {
    expect(nationalityTextDisplay("ベトナム", "ko")).toBe("ベトナム");
    expect(nationalityTextDisplay("ZZ", "ko")).toBe("ZZ");
    expect(nationalityTextDisplay("", "ko")).toBe("");
  });
});

describe("제출 · 확인 시각(timestamptz)은 도쿄 날짜로", () => {
  it("도쿄 오전 0~9시 제출도 그날로 보인다", () => {
    // 도쿄 2026-11-19 08:30 = UTC 2026-11-18 23:30
    expect(dotDateOfIso("2026-11-18T23:30:00+00:00")).toBe("2026.11.19");
    expect(dotDateOfIso("2026-11-18T15:00:00.000Z")).toBe("2026.11.19");
  });
  it("재류카드 화면이 시각을 앞 10글자로 자르지 않는다", () => {
    for (const file of [
      "src/components/identity/id-card-flow.tsx",
      "src/components/identity/id-document-panel.tsx",
      "src/components/admin/users/staff-docs-console.tsx",
      "src/components/admin/users/users-console.tsx",
      "src/components/mobile/users/mobile-staff-docs.tsx",
      "src/components/mobile/users/mobile-member-detail.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/(submittedAt|confirmedAt|createdAt|updatedAt|_at)\??\.slice\(0, ?10\)/);
    }
  });
});
