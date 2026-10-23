import { tokyoDayStart } from "@/lib/tokyo-date";

/**
 * 신분 서류 — 동의 문구 판 · 읽기 횟수 제한 · 보관 기한 (docs/product/41 §6 · §10). 순수 모듈.
 */

/**
 * 해외 이전 동의 문구의 판. `staff_id_ocr_reads.consent_version` 에 남는다.
 * `src/lib/i18n.ts` 의 `idCard.consent` · `idCard.consentDetail`(ko · ja · en 어느 하나라도)을 고치면 **반드시 오늘 날짜로 바꾼다** —
 * 그래야 누가 어느 문구에 동의했는지 나중에 가릴 수 있다.
 */
export const ID_CARD_CONSENT_VERSION = "2026-10-23";

/** 자동 읽기 하루 상한(도쿄 날짜). 다시 찍기까지 넉넉히 — 넘으면 직접 입력으로. */
export const OCR_DAILY_LIMIT_PER_USER = 10;
export const OCR_DAILY_LIMIT_PER_ORG = 200;

export function ocrLimitReached(counts: { user: number; organization: number }): boolean {
  return counts.user >= OCR_DAILY_LIMIT_PER_USER || counts.organization >= OCR_DAILY_LIMIT_PER_ORG;
}

/** 퇴사 뒤 보관 햇수(41 §6). */
export const ID_DOCUMENT_RETENTION_YEARS = 3;

/** YYYY-MM-DD 에서 `years` 년 앞으로. 2/29 → 평년이면 2/28. */
export function ymdMinusYears(ymd: string, years: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const target = year - years;
  const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${String(target).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 이 시각보다 **먼저** 떠난 사람의 서류를 지운다. 오늘(도쿄)에서 3년 전 날의 도쿄 0시 —
 * 2026-10-22 에 떠났으면 2029-10-23 에, 10-23 에 떠났으면 10-24 에 지워진다(만 3년이 지난 다음 날).
 */
export function retentionCutoff(tokyoToday: string): string {
  return tokyoDayStart(ymdMinusYears(tokyoToday, ID_DOCUMENT_RETENTION_YEARS));
}

export type RetentionDocument = { organizationId: string; userId: string; updatedAt: string };
export type RetentionMembership = { organizationId: string; userId: string; status: string; leftAt: string | null };

/**
 * 지울 사람(조직 · 사람 짝)을 고른다.
 * - 멤버십이 active 면 둔다(재직 중엔 이전 카드까지 보관).
 * - 비활성이고 `left_at` 이 기준보다 앞이면 지운다. `left_at` 이 비어 있으면 둔다(기준을 모르면 지우지 않는다).
 * - 멤버십 행이 아예 없으면(관리자가 멤버십을 지움) 그 사람 서류 중 가장 늦은 `updated_at` 을 떠난 시각으로 본다 —
 *   실제 떠난 시각보다 늦거나 같아서 일찍 지우는 일은 없다. 목록이 잘렸으면(`includeOrphans: false`) 가장 늦은 값을 모르므로 건너뛴다.
 */
export function pickExpiredOwners(
  documents: RetentionDocument[],
  memberships: RetentionMembership[],
  cutoffIso: string,
  { includeOrphans = true }: { includeOrphans?: boolean } = {},
): { organizationId: string; userId: string }[] {
  const cutoff = Date.parse(cutoffIso);
  const key = (o: string, u: string) => `${o}:${u}`;
  const membershipByKey = new Map(memberships.map((m) => [key(m.organizationId, m.userId), m]));
  const latestDoc = new Map<string, number>();
  for (const doc of documents) {
    const k = key(doc.organizationId, doc.userId);
    const at = Date.parse(doc.updatedAt);
    latestDoc.set(k, Math.max(latestDoc.get(k) ?? -Infinity, at));
  }
  const expired: { organizationId: string; userId: string }[] = [];
  for (const [k, latest] of latestDoc) {
    const [organizationId, userId] = k.split(":");
    const membership = membershipByKey.get(k);
    const leftAt = membership
      ? membership.status === "active" || !membership.leftAt
        ? null
        : Date.parse(membership.leftAt)
      : includeOrphans
        ? latest
        : null;
    if (leftAt !== null && Number.isFinite(leftAt) && leftAt < cutoff) expired.push({ organizationId, userId });
  }
  return expired;
}
