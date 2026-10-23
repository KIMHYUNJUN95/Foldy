/**
 * 재류카드 만료 — 운영 화면 경고 · 만료 알림 단계(docs/product/41 §3-5 「만료 표시 · 만료 알림」, 2026-10-23). 순수 모듈.
 *
 * - 「만료」 = 만료일(`expires_on`, 카드에 적힌 마지막 유효일)이 **오늘(도쿄)보다 앞** — 남은 날 < 0. `ExpiryTone` 의 `expired` 와 같은 기준.
 * - 대상은 **재류카드만**. 마이넘버 카드의 유효기간은 취로 자격이 아니라서 경고 · 알림 대상이 아니다.
 * - 만료일이 지나도 갱신 신청 중이면(特例期間 — 만료 전에 신청했으면 처분까지, 최대 만료 뒤 2개월) 계속 일할 수 있다. Foldy 는 그걸 모르므로
 *   경고는 「확인해 주세요」로만 하고 배정 · 출근을 막지 않는다.
 */

/** 알림 단계 — 90일 전 · 30일 전 · 만료(만료일 다음 날부터). */
export type IdDocExpiryStage = "d90" | "d30" | "expired";

export const ID_DOC_EXPIRY_THRESHOLDS: Readonly<Record<Exclude<IdDocExpiryStage, "expired">, number>> = { d90: 90, d30: 30 };

/**
 * 오늘 보낼 단계(남은 날 기준). 「건너간 뒤에도」 보낸다 — 크론이 하루 빠져도 다음 날 보낸다(중복은 알림 dedupe 키가 막는다).
 * 가장 급한 단계 **하나만** 돌려준다: 처음 등록할 때 이미 20일 남았으면 30일 알림만, 이미 지났으면 만료 알림만(90일 알림을 뒤늦게 보내지 않는다).
 * 만료일이 없으면 null.
 */
export function dueIdDocExpiryStage(daysLeft: number | null): IdDocExpiryStage | null {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return null;
  if (daysLeft < 0) return "expired";
  if (daysLeft <= ID_DOC_EXPIRY_THRESHOLDS.d30) return "d30";
  if (daysLeft <= ID_DOC_EXPIRY_THRESHOLDS.d90) return "d90";
  return null;
}

/** 알림 dedupe 키 — 서류 · 단계마다 한 번(받는 사람마다 따로, unique (recipient_user_id, dedupe_key)). 새 카드로 갱신하면 서류 id 가 바뀌어 다시 센다. */
export function idDocExpiryDedupeKey(documentId: string, stage: IdDocExpiryStage): string {
  return `id_doc_expiring:${documentId}:${stage}`;
}

export type ResidenceCardNotice = { kind: "expired" } | { kind: "expiring"; days: number };

/** 본인 근태 화면 안내 — 만료면 「지났어요」, 30일 안이면 「N일 남았어요」(0 = 오늘까지). 그 밖은 없음. */
export function residenceCardNotice(daysLeft: number | null): ResidenceCardNotice | null {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return null;
  if (daysLeft < 0) return { kind: "expired" };
  if (daysLeft <= ID_DOC_EXPIRY_THRESHOLDS.d30) return { kind: "expiring", days: daysLeft };
  return null;
}
