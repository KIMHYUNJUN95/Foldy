/**
 * 교통비 영수증 화면(모바일 · 관리자)의 순수 판정 모음(2026-11-25).
 * 화면 파일에서 빼 두어 단위 테스트로 잠근다 — 컴포넌트 테스트 환경이 없다.
 */

/** 항목마다 영수증 사진 상한(서버 `addTransportItemImageAction` 도 같은 수). */
export const TRANSPORT_MAX_RECEIPTS = 5;

/** 이미 붙은 사진 + 고른 사진을 합쳐 더 받을 수 있는 자리 수. */
export function receiptSlotsLeft(existing: number, chosen: number, max = TRANSPORT_MAX_RECEIPTS): number {
  return Math.max(0, max - Math.max(0, existing) - Math.max(0, chosen));
}

/**
 * 새로 고른 파일을 이미 고른 파일 뒤에 붙인다. 자리를 넘는 것은 버리고 `truncated` 로 알린다.
 * 같은 파일(이름 · 크기 · 수정 시각이 같은 것)을 두 번 고르면 한 번만 둔다.
 */
export function mergeChosenFiles<T extends { name: string; size: number; lastModified?: number }>(
  existing: number,
  current: T[],
  picked: T[],
  max = TRANSPORT_MAX_RECEIPTS,
): { files: T[]; truncated: boolean } {
  const room = Math.max(0, max - Math.max(0, existing));
  const next = [...current];
  for (const file of picked) {
    const dup = next.some(
      (f) => f.name === file.name && f.size === file.size && (f.lastModified ?? 0) === (file.lastModified ?? 0),
    );
    if (!dup) next.push(file);
  }
  return { files: next.slice(0, room), truncated: next.length > room };
}

export type ReceiptEvidenceState = "missing" | "failed" | "ok";

/**
 * 증빙 상태. 「누락」은 **붙은 사진이 0장일 때만**이다. 사진은 있는데 주소를 못 받았거나 못 불러온 것은 「불러오지 못함」 —
 * 둘을 섞으면 사진이 있는데 「증빙 누락」이라고 뜬다.
 */
export function receiptEvidenceState(input: {
  imageCount: number;
  imageUrlsFailed?: boolean;
  /** 화면이 쓸 수 있는 주소 수(null 이 아닌 것). */
  usableUrlCount: number;
}): ReceiptEvidenceState {
  if (input.imageCount <= 0) return "missing";
  if (input.imageUrlsFailed || input.usableUrlCount < input.imageCount) return "failed";
  return "ok";
}

/**
 * 입력 방식을 바꿀 수 있나. **자동 연결 → 직접 입력만** 된다(서버 `invalid_entry_mode`).
 * 직접 입력 → 자동 연결은 출처를 서버가 다시 확인해야 해서 항목을 지우고 후보에서 다시 만든다.
 */
export function canChangeEntryMode(from: "linked" | "manual", to: "linked" | "manual"): boolean {
  return from === to || (from === "linked" && to === "manual");
}

/** 영어 단수 · 복수 구분용 — 1장이면 `one`. */
export function receiptCountForm(n: number): "one" | "other" {
  return n === 1 ? "one" : "other";
}

export type TransportErrorKind =
  | "locked"
  | "forbidden"
  | "amount"
  | "memo"
  | "date"
  | "entryMode"
  | "auth"
  | "limit"
  | "generic";

/** 서버 오류 코드 → 화면 문구 종류. 모르는 코드는 `generic`. */
export function transportErrorKind(code: string | undefined): TransportErrorKind {
  switch (code) {
    case "report_not_editable":
      return "locked";
    case "forbidden":
      return "forbidden";
    case "invalid_amount":
      return "amount";
    case "memo_required":
      return "memo";
    case "invalid_date":
    case "date_outside_month":
    case "invalid_month":
      return "date";
    case "invalid_entry_mode":
      return "entryMode";
    case "auth":
      return "auth";
    case "too_many_images":
    case "image_limit":
      return "limit";
    default:
      return "generic";
  }
}

/** 서명 주소가 묵었나(`urlsAt` 이후 `staleMs` 가 지났으면 참). 만료(10분)보다 짧게 잡는다. */
export function isReceiptUrlStale(urlsAt: number, now: number, staleMs: number): boolean {
  return now - urlsAt > staleMs;
}

/** 사진 목록에서 하나를 뺀다 — 항상 **현재 목록**을 받아 빼야 연달아 지워도 되살아나지 않는다. */
export function removeReceiptImage<T extends { id: string }>(images: T[], imageId: string): T[] {
  return images.filter((img) => img.id !== imageId);
}
