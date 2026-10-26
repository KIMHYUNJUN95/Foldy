import type { IdDocumentKind, IdDocumentStatus } from "@/lib/staff-documents/fields";
import { expiryTone } from "@/lib/staff-documents/fields";

/**
 * 「직원 서류」 목록(재류카드 R4, 2026-10-26) — 줄 모양 · 할 일 순서 · 거르기. **순수하다**(PC · 모바일 화면이 같이 쓴다).
 *
 * 할 일 순(사용자 결정): 확인 대기 → 만료 → 30일 안 → 90일 안 → 미등록(다시 요청 포함) → 확인함.
 * 위 거르기: 전체 · 확인 대기 · 만료 · 90일 안(30일 안 포함) · 미등록(다시 요청 포함).
 * docs/product/41-residence-card-workflow.md 「R4 구현」
 */

export type RosterBucket = "pending" | "expired" | "within30" | "within90" | "missing" | "returned" | "ok";
export type RosterFilter = "all" | "pending" | "expired" | "within90" | "missing";
export const ROSTER_FILTERS: readonly RosterFilter[] = ["all", "pending", "expired", "within90", "missing"];

export type StaffDocRosterRow = {
  userId: string;
  name: string;
  /** 국적 표시 이름(화면 언어). 국적을 아직 안 넣었으면 빈 값. */
  nationalityName: string;
  role: string;
  joinedAt: string | null;
  /** 국적으로 정한 서류 종류. 국적이 없으면 null(대신 올리기를 못 한다 — 카드 종류를 모른다). */
  kind: IdDocumentKind | null;
  doc: {
    kind: IdDocumentKind;
    status: IdDocumentStatus;
    residenceStatus: string;
    expiresOn: string;
    cardNumber: string;
    /** 만료까지 남은 날(도쿄). 만료일이 없으면 null. */
    days: number | null;
    uploadedByAdmin: boolean;
  } | null;
  bucket: RosterBucket;
  isSelf: boolean;
};

const RANK: Record<RosterBucket, number> = { pending: 0, expired: 1, within30: 2, within90: 3, missing: 4, returned: 5, ok: 6 };

export function rosterBucket(doc: { status: IdDocumentStatus; days: number | null } | null): RosterBucket {
  if (!doc) return "missing";
  if (doc.status === "pending") return "pending";
  if (doc.status === "returned") return "returned";
  const tone = expiryTone(doc.days);
  return tone === "expired" || tone === "within30" || tone === "within90" ? tone : "ok";
}

/** 할 일 순 — 같은 묶음 안에서 날짜가 있으면 급한 날짜 먼저, 그다음 이름. */
export function sortRoster<T extends Pick<StaffDocRosterRow, "bucket" | "name" | "doc">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const rank = RANK[a.bucket] - RANK[b.bucket];
    if (rank !== 0) return rank;
    const da = a.doc?.days ?? Number.POSITIVE_INFINITY;
    const db = b.doc?.days ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}

export function inRosterFilter(bucket: RosterBucket, filter: RosterFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return bucket === "pending";
    case "expired":
      return bucket === "expired";
    case "within90":
      return bucket === "within30" || bucket === "within90";
    case "missing":
      return bucket === "missing" || bucket === "returned";
  }
}

export function countRoster(rows: readonly Pick<StaffDocRosterRow, "bucket">[]): Record<RosterFilter, number> {
  const counts: Record<RosterFilter, number> = { all: 0, pending: 0, expired: 0, within90: 0, missing: 0 };
  for (const row of rows) for (const filter of ROSTER_FILTERS) if (inRosterFilter(row.bucket, filter)) counts[filter] += 1;
  return counts;
}

/** 이름 · 국적 · 카드 번호로 찾기(띄어쓰기 · 대소문자 무시). */
export function matchesRosterQuery(row: Pick<StaffDocRosterRow, "name" | "nationalityName" | "doc">, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  const hay = [row.name, row.nationalityName, row.doc?.cardNumber ?? ""].join("|").toLowerCase().replace(/\s+/g, "");
  return hay.includes(q);
}

/** 할 일 칸 글 — 화면 둘(PC · 모바일)이 같은 말을 쓴다. `tone` 은 글자 색(빨강은 만료만). */
export type RosterStatusCopy = {
  docsStPending: string;
  docsStOverdue: string;
  docsStLeft: string;
  docsStMissing: string;
  docsStReturned: string;
  docsStOk: string;
  docsStOkAdmin: string;
  docsNoNationality: string;
};

export function rosterStatus(
  row: Pick<StaffDocRosterRow, "bucket" | "doc" | "kind">,
  copy: RosterStatusCopy,
): { text: string; tone: "strong" | "red" | "mute" | "link" } {
  switch (row.bucket) {
    case "pending":
      return { text: copy.docsStPending, tone: "strong" };
    case "expired":
      return { text: copy.docsStOverdue.replace("{n}", String(Math.abs(row.doc?.days ?? 0))), tone: "red" };
    case "within30":
      return { text: copy.docsStLeft.replace("{n}", String(row.doc?.days ?? 0)), tone: "strong" };
    case "within90":
      return { text: copy.docsStLeft.replace("{n}", String(row.doc?.days ?? 0)), tone: "mute" };
    case "missing":
      // 국적이 없으면 카드 종류를 몰라 대신 올릴 수 없다 — 링크 대신 이유를 쓴다.
      return row.kind ? { text: copy.docsStMissing, tone: "link" } : { text: copy.docsNoNationality, tone: "mute" };
    case "returned":
      return { text: copy.docsStReturned, tone: "mute" };
    case "ok":
      return { text: row.doc?.uploadedByAdmin ? copy.docsStOkAdmin : copy.docsStOk, tone: "mute" };
  }
}
