import { describe, expect, it } from "vitest";
import { EMPTY_ID_FIELDS, adminUploadFields, normalizeIdFields, validateAdminIdFields } from "@/lib/staff-documents/fields";
import {
  countRoster,
  inRosterFilter,
  matchesRosterQuery,
  rosterBucket,
  rosterStatus,
  sortRoster,
  type StaffDocRosterRow,
} from "@/lib/staff-documents/roster";

/** 재류카드 R4 「직원 서류」 목록 — 할 일 순 · 거르기 · 대신 올리기 칸 검사(docs/product/41 「R4 구현」). 이름은 가짜. */

function row(name: string, doc: { status: "pending" | "confirmed" | "returned"; days: number | null; admin?: boolean } | null): StaffDocRosterRow {
  const d = doc
    ? { kind: "residence_card" as const, status: doc.status, residenceStatus: "留学", expiresOn: "2027-03-31", cardNumber: "AB12345678CD", days: doc.days, uploadedByAdmin: Boolean(doc.admin) }
    : null;
  return { userId: name, name, nationalityName: "베트남", role: "part_time", joinedAt: null, kind: "residence_card", doc: d, bucket: rosterBucket(d), isSelf: false };
}

const COPY = {
  docsStPending: "확인 대기",
  docsStOverdue: "{n}일 지남",
  docsStLeft: "{n}일 남음",
  docsStMissing: "대신 올리기",
  docsStReturned: "다시 요청함",
  docsStOk: "확인함",
  docsStOkAdmin: "확인함 · 관리자가 올림",
  docsNoNationality: "국적 없음",
};

describe("staff document roster", () => {
  it("buckets by status first, then by days left", () => {
    expect(rosterBucket(null)).toBe("missing");
    expect(rosterBucket({ status: "pending", days: -3 })).toBe("pending");
    expect(rosterBucket({ status: "returned", days: 400 })).toBe("returned");
    expect(rosterBucket({ status: "confirmed", days: -1 })).toBe("expired");
    expect(rosterBucket({ status: "confirmed", days: 0 })).toBe("within30");
    expect(rosterBucket({ status: "confirmed", days: 30 })).toBe("within30");
    expect(rosterBucket({ status: "confirmed", days: 31 })).toBe("within90");
    expect(rosterBucket({ status: "confirmed", days: 91 })).toBe("ok");
    expect(rosterBucket({ status: "confirmed", days: null })).toBe("ok");
  });

  it("sorts by what needs doing: pending → expired → 30 → 90 → missing → returned → confirmed", () => {
    const rows = [
      row("확인함", { status: "confirmed", days: 900 }),
      row("미등록", null),
      row("90일", { status: "confirmed", days: 76 }),
      row("다시", { status: "returned", days: 100 }),
      row("만료", { status: "confirmed", days: -6 }),
      row("30일", { status: "confirmed", days: 19 }),
      row("대기", { status: "pending", days: 156 }),
    ];
    expect(sortRoster(rows).map((r) => r.name)).toEqual(["대기", "만료", "30일", "90일", "미등록", "다시", "확인함"]);
  });

  it("puts the most urgent date first inside a bucket", () => {
    const rows = [row("b", { status: "confirmed", days: -1 }), row("a", { status: "confirmed", days: -20 })];
    expect(sortRoster(rows).map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("filters: 90일 안 holds 30일 안 too, 미등록 holds 다시 요청", () => {
    expect(inRosterFilter("within30", "within90")).toBe(true);
    expect(inRosterFilter("within90", "within90")).toBe(true);
    expect(inRosterFilter("expired", "within90")).toBe(false);
    expect(inRosterFilter("returned", "missing")).toBe(true);
    expect(inRosterFilter("ok", "missing")).toBe(false);
    const counts = countRoster([
      row("a", { status: "pending", days: 5 }),
      row("b", { status: "confirmed", days: -2 }),
      row("c", { status: "confirmed", days: 10 }),
      row("d", null),
      row("e", { status: "returned", days: 300 }),
    ]);
    expect(counts).toEqual({ all: 5, pending: 1, expired: 1, within90: 1, missing: 2 });
  });

  it("finds by name, nationality or card number ignoring spaces and case", () => {
    const r = row("응우옌 반 안", { status: "pending", days: 5 });
    expect(matchesRosterQuery(r, "응우옌반")).toBe(true);
    expect(matchesRosterQuery(r, "베트")).toBe(true);
    expect(matchesRosterQuery(r, "ab 1234")).toBe(true);
    expect(matchesRosterQuery(r, "필리핀")).toBe(false);
  });

  it("status text: red only for expired, admin uploads say so", () => {
    expect(rosterStatus(row("a", { status: "confirmed", days: -6 }), COPY)).toEqual({ text: "6일 지남", tone: "red" });
    expect(rosterStatus(row("a", { status: "confirmed", days: 19 }), COPY)).toEqual({ text: "19일 남음", tone: "strong" });
    expect(rosterStatus(row("a", { status: "confirmed", days: 76 }), COPY)).toEqual({ text: "76일 남음", tone: "mute" });
    expect(rosterStatus(row("a", null), COPY)).toEqual({ text: "대신 올리기", tone: "link" });
    expect(rosterStatus({ ...row("a", null), kind: null }, COPY)).toEqual({ text: "국적 없음", tone: "mute" });
    expect(rosterStatus(row("a", { status: "confirmed", days: 900, admin: true }), COPY).text).toBe("확인함 · 관리자가 올림");
  });
});

describe("admin upload fields", () => {
  it("asks five card fields for a residence card and only the expiry for My Number", () => {
    expect(adminUploadFields("residence_card")).toEqual(["cardNumber", "residenceStatus", "expiresOn", "workRestriction", "extraActivity"]);
    expect(adminUploadFields("my_number_card")).toEqual(["expiresOn"]);
  });

  it("requires all five for a residence card, not name or birth date", () => {
    const errors = validateAdminIdFields("residence_card", EMPTY_ID_FIELDS);
    expect(Object.keys(errors).sort()).toEqual(["cardNumber", "expiresOn", "extraActivity", "residenceStatus", "workRestriction"]);
    const ok = normalizeIdFields({
      cardNumber: "ab 12345678 cd",
      residenceStatus: "留学",
      expiresOn: "2028-04-30",
      workRestriction: "not_allowed",
      extraActivity: "weekly_28h",
    });
    expect(validateAdminIdFields("residence_card", ok)).toEqual({});
    expect(validateAdminIdFields("residence_card", { ...ok, cardNumber: "A1234" })).toEqual({ cardNumber: "card_number_invalid" });
  });

  it("lets a My Number card through with no fields", () => {
    expect(validateAdminIdFields("my_number_card", EMPTY_ID_FIELDS)).toEqual({});
  });
});
