// 근태 QR 의 인코딩 형식 — 관리자 QR 생성기와 앱 내 스캐너가 공유한다.
// (server-only 아님: 클라이언트 스캐너가 extractAttendanceToken 을 쓴다.)
//
// 배경 (2026-07-31): 예전에는 QR 에 토큰 문자열(`att_…`)만 담았다. 그래서 휴대폰 기본 카메라로
// 찍으면 "열 수 있는 것"이 없어 아무 반응이 없었다. 이제는 절대 URL 로 감싸서, 카메라가 링크를
// 띄우고 → 앱(설치돼 있으면 PWA 창)으로 바로 들어오게 한다.
//
//   https://<앱주소>/mobile/attendance/capture?token=att_…
//
// 하위호환은 필수다. 이미 현장에 붙어 있는 인쇄물은 토큰만 담고 있으므로, 스캐너는 두 형식을
// 모두 받아야 한다. 토큰 값 자체는 바꾸지 않았으니 기존 QR 은 그대로 계속 동작한다.
//
// 보안: 토큰이 URL 로 노출돼도 서버 검증(활성 토큰 + 활성 사이트 + 동일 조직 + GPS 필수 +
// 사이트 반경 이내)은 그대로다. 현장 밖에서 링크만 열어서는 인증되지 않는다.
// docs/product/24-attendance-workflow.md → "QR Deep Link" 참고.

export const ATTENDANCE_QR_PATH = "/mobile/attendance/capture";

/** `generateAttendanceQrToken()` 이 만드는 토큰의 고정 접두사. */
const TOKEN_PREFIX = "att_";

function looksLikeToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length;
}

/**
 * QR 에 인코딩할 문자열.
 *
 * 기준 주소는 **요청 호스트가 아니라 `NEXT_PUBLIC_APP_URL`** 이다. QR 은 인쇄물이라, 관리자가
 * 우연히 LAN IP 로 접속한 상태에서 뽑으면 현장에서 열리지 않는 QR 이 인쇄돼 버린다.
 * 주소가 비어 있으면 예전처럼 토큰만 담는다 — 깨진 링크를 인쇄하는 것보다 안전하다.
 */
export function buildAttendanceQrValue(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return token;
  return `${base}${ATTENDANCE_QR_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * 인쇄 전 안전장치 — 지금 그려질 QR 이 실제로 현장에서 열리는 물건인지 판정한다.
 *
 * QR 은 인쇄물이라 한 번 잘못 뽑으면 전 건물을 다시 붙여야 하는데, 화면상으로는 멀쩡해 보인다.
 * 실제로 2026-07-31 에 `NEXT_PUBLIC_APP_URL` 미설정 상태의 토큰-only QR 이 카메라에서 그냥
 * 검색어로 읽히는 일이 있었다. 관리자 화면이 출력 전에 이 상태를 명시적으로 경고한다.
 *
 *  · "missing" — URL 이 아니라 토큰만 담긴다(기준 주소 미설정). 카메라로 절대 안 열린다.
 *  · "local"   — localhost / 사설망 주소. 관리자 PC 에서는 열려도 현장 휴대폰에서는 안 열린다.
 *  · "ok"      — 공개 주소. 출력해도 된다.
 */
export type AttendanceQrLinkState = "ok" | "local" | "missing";

export function attendanceQrLinkState(value: string): AttendanceQrLinkState {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "missing";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "missing";

  const host = url.hostname;
  const isLocal =
    host === "localhost" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return isLocal ? "local" : "ok";
}

/**
 * 스캔 결과에서 근태 토큰을 뽑는다. 신형(URL)과 구형(토큰만)을 모두 받는다.
 * 형식이 맞지 않으면 null — 서버가 다시 검증하지만, 엉뚱한 QR 을 굳이 전송하지는 않는다.
 */
export function extractAttendanceToken(scanned: string): string | null {
  const value = scanned.trim();
  if (!value) return null;
  if (looksLikeToken(value)) return value;

  // URL 형태면 token 쿼리에서 꺼낸다. 경로는 굳이 강제하지 않는다 —
  // 도메인이 바뀌었거나 리다이렉트를 거친 QR 도 살려야 한다.
  try {
    const token = new URL(value).searchParams.get("token")?.trim() ?? "";
    return looksLikeToken(token) ? token : null;
  } catch {
    return null;
  }
}
