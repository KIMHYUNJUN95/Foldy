/** Beds24 `GET /bookings/messages` 응답 한 페이지 읽기 — **순수**(보정 조회 · 가져오기 · 이모지 되살리기가 같이 쓴다). */

/** 응답 한 페이지 → 메시지 원본 목록 + 다음 페이지 여부. 모양이 달라도 던지지 않는다. */
export function parseBeds24MessagesPage(json: unknown): { rows: unknown[]; nextPageExists: boolean } {
  if (Array.isArray(json)) return { rows: json, nextPageExists: false };
  if (!json || typeof json !== "object") return { rows: [], nextPageExists: false };
  const record = json as { data?: unknown; pages?: { nextPageExists?: unknown } };
  return {
    rows: Array.isArray(record.data) ? record.data : [],
    nextPageExists: record.pages?.nextPageExists === true,
  };
}
