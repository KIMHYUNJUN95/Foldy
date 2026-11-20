import { describe, expect, it } from "vitest";
import {
  annDate,
  annDateTime,
  annDayKey,
  annDayLabel,
  announcementRecipientCount,
  tokyoDateKey,
  tokyoTimeHm,
  countsTowardRead,
  announcementPanelHref,
  pickInitialAnnouncementOrg,
  readAnnouncementPanelId,
} from "@/lib/announcement-display";

// 공지 날짜 표기 하나로(2026-11-20, 공지 unslop A2) — PC · 모바일 · 팝업이 모두 이 함수를 쓴다.
describe("annDate — 도쿄 날짜 「2026.11.18」", () => {
  it("UTC 오후는 도쿄 다음 날로 넘어간다", () => {
    // 2026-11-17 15:30 UTC = 2026-11-18 00:30 JST
    expect(annDate("2026-11-17T15:30:00Z")).toBe("2026.11.18");
  });
  it("UTC 자정 전 도쿄 아침", () => {
    expect(annDate("2026-11-18T08:59:00Z")).toBe("2026.11.18");
  });
  it("비었거나 잘못된 값은 빈 문자열", () => {
    expect(annDate(null)).toBe("");
    expect(annDate("not-a-date")).toBe("");
  });
});

describe("annDateTime — 「2026.11.18 09:05」", () => {
  it("도쿄 시각 24시간", () => {
    expect(annDateTime("2026-11-18T00:05:00Z")).toBe("2026.11.18 09:05");
  });
  it("도쿄 자정은 00 시", () => {
    expect(annDateTime("2026-11-17T15:00:00Z")).toBe("2026.11.18 00:00");
  });
  it("빈 값은 빈 문자열", () => {
    expect(annDateTime(null)).toBe("");
  });
});

describe("annDayLabel — 묶음 머리 「2026.11.14 (토)」", () => {
  it("요일은 언어별", () => {
    // 2026-11-14 은 토요일
    expect(annDayLabel("2026-11-14T03:00:00Z", "ko")).toBe("2026.11.14 (토)");
    expect(annDayLabel("2026-11-14T03:00:00Z", "ja")).toBe("2026.11.14 (土)");
    expect(annDayLabel("2026-11-14T03:00:00Z", "en")).toBe("2026.11.14 (Sat)");
  });
  it("요일도 도쿄 기준 — UTC 금요일 밤은 도쿄 토요일", () => {
    expect(annDayLabel("2026-11-13T16:00:00Z", "ko")).toBe("2026.11.14 (토)");
  });
});

// 쓴 사람은 「안 읽음」 목록과 읽음 분모에서 빠진다(공지 unslop B3).
describe("countsTowardRead — 읽음 판정 대상", () => {
  it("쓴 사람은 대상이 아니다", () => {
    expect(countsTowardRead("u-author", "u-author")).toBe(false);
  });
  it("다른 사람은 대상", () => {
    expect(countsTowardRead("u-staff", "u-author")).toBe(true);
  });
  it("쓴 사람을 모르면(삭제된 계정) 모두 대상", () => {
    expect(countsTowardRead("u-staff", null)).toBe(true);
  });
});

// 새 공지의 처음 조직 = 지금 보고 있는 조직(공지 unslop B1).
describe("pickInitialAnnouncementOrg", () => {
  const orgs = [{ id: "o-1" }, { id: "o-2" }];
  it("지금 보고 있는 조직", () => {
    expect(pickInitialAnnouncementOrg(orgs, "o-2")).toBe("o-2");
  });
  it("지금 조직이 없으면(플랫폼 관리자) 비워 두고 고르게 한다", () => {
    expect(pickInitialAnnouncementOrg(orgs, null)).toBe("");
  });
  it("지금 조직을 관리할 수 없으면 비워 둔다", () => {
    expect(pickInitialAnnouncementOrg(orgs, "o-9")).toBe("");
  });
  it("조직이 하나뿐이면 그 조직(고르는 칸이 안 보인다)", () => {
    expect(pickInitialAnnouncementOrg([{ id: "o-1" }], null)).toBe("o-1");
  });
});

// 예전 상세 주소 → 콘솔 패널(공지 unslop B2).
describe("announcementPanelHref · readAnnouncementPanelId", () => {
  const id = "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f";
  it("예전 상세 주소는 콘솔 ?id= 로 넘긴다", () => {
    expect(announcementPanelHref(id)).toBe(`/admin/announcements?id=${id}`);
  });
  it("공지 번호 꼴이 아니면 목록으로만", () => {
    expect(announcementPanelHref("../../etc")).toBe("/admin/announcements");
  });
  it("?id= 는 공지 번호 꼴일 때만 연다", () => {
    expect(readAnnouncementPanelId(id)).toBe(id);
    expect(readAnnouncementPanelId([id, "x"])).toBe(id);
    expect(readAnnouncementPanelId("abc")).toBeNull();
    expect(readAnnouncementPanelId(undefined)).toBeNull();
  });
});

// 2차(2026-11-20) — 도쿄 날짜 함수 한 곳으로(A4) · 받는 사람 수 = 패널 분모(A1).
describe("annDayKey — 목록 날짜 묶음 열쇠(도쿄 YYYY-MM-DD)", () => {
  it("도쿄 00:30 은 새 날짜 묶음", () => {
    // 2026-11-17 15:30 UTC = 2026-11-18 00:30 JST
    expect(annDayKey("2026-11-17T15:30:00Z")).toBe("2026-11-18");
  });
  it("UTC 14:59 는 도쿄 그날 23:59 — 아직 앞 날짜", () => {
    expect(annDayKey("2026-11-17T14:59:00Z")).toBe("2026-11-17");
  });
  it("값이 없거나 깨지면 빈 문자열", () => {
    expect(annDayKey(null)).toBe("");
    expect(annDayKey("not-a-date")).toBe("");
  });
});

describe("tokyoDateKey · tokyoTimeHm — 입력 칸 값", () => {
  it("UTC 14:59 → 도쿄 23:59 같은 날", () => {
    expect(tokyoDateKey("2026-11-17T14:59:00Z")).toBe("2026-11-17");
    expect(tokyoTimeHm("2026-11-17T14:59:00Z")).toBe("23:59");
  });
  it("UTC 15:00 → 도쿄 다음 날 00:00(24 로 나오지 않는다)", () => {
    expect(tokyoDateKey("2026-11-17T15:00:00Z")).toBe("2026-11-18");
    expect(tokyoTimeHm("2026-11-17T15:00:00Z")).toBe("00:00");
  });
  it("값이 없으면 빈 문자열", () => {
    expect(tokyoDateKey(null)).toBe("");
    expect(tokyoTimeHm(null)).toBe("");
  });
});

describe("announcementRecipientCount — 받는 사람 수(쓴 사람 뺌, 패널 분모와 같다)", () => {
  const roleCounts = { office_admin: 1, field_manager: 2, part_time_staff: 5 } as const;
  it("전체 공지 — 쓴 사람이 이 조직 활성 구성원이면 1 뺀다", () => {
    expect(
      announcementRecipientCount({ scope: "everyone", roles: [], roleCounts, orgTotal: 8, authorRole: "field_manager" }),
    ).toBe(7);
  });
  it("전체 공지 — 쓴 사람이 구성원이 아니면(플랫폼 관리자) 그대로", () => {
    expect(
      announcementRecipientCount({ scope: "everyone", roles: [], roleCounts, orgTotal: 8, authorRole: null }),
    ).toBe(8);
  });
  it("역할 공지 — 쓴 사람 역할이 대상에 있으면 1 뺀다", () => {
    expect(
      announcementRecipientCount({
        scope: "roles",
        roles: ["field_manager", "part_time_staff"],
        roleCounts,
        orgTotal: 8,
        authorRole: "field_manager",
      }),
    ).toBe(6);
  });
  it("역할 공지 — 쓴 사람 역할이 대상 밖이면 그대로", () => {
    expect(
      announcementRecipientCount({ scope: "roles", roles: ["part_time_staff"], roleCounts, orgTotal: 8, authorRole: "field_manager" }),
    ).toBe(5);
  });
  it("0 밑으로 내려가지 않는다", () => {
    expect(
      announcementRecipientCount({ scope: "roles", roles: ["staff"], roleCounts: {}, orgTotal: 0, authorRole: "staff" }),
    ).toBe(0);
  });
});
