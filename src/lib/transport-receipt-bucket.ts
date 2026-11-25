// 교통비 영수증 버킷 이름 — 브라우저 업로드(transport-statement.tsx)와 서버가 같은 상수를 쓴다(2026-11-25).
// 비공개 버킷이라 화면은 서버가 만든 서명 주소로만 사진을 본다. 문서: docs/engineering/11 「교통비 영수증 저장소(2026-11-25)」
// 이 파일은 server-only 가 아니다 — 비밀 값 없이 이름만 둔다.

/** 새 업로드가 가는 비공개 버킷(202611250002). */
export const TRANSPORT_RECEIPT_BUCKET = "transport-receipts";

/** 2026-11-25 이전 영수증이 있는 공개 버킷. 옮기기 스크립트가 끝날 때까지 서명 · 지우기에서 함께 본다. */
export const LEGACY_TRANSPORT_RECEIPT_BUCKET = "request-images";

/**
 * 서명 주소 유효 시간(초). 10분 — 새어 나간 주소가 빨리 죽고, 화면을 오래 열어 두면 「다시 받기」 액션으로 새로 받는다.
 * 관리자가 한 사람의 한 달 영수증을 검토하는 데 10분이면 충분하고, 넘으면 사진을 누를 때 다시 받는다.
 */
export const TRANSPORT_RECEIPT_URL_TTL_SECONDS = 600;
