const ADMIN_RESTORE_MARKER = "[stayops:admin_restore]";
const LEGACY_ADMIN_RESTORE_LABEL = "\uAD00\uB9AC\uC790 \uBCF5\uC6D0";
/**
 * 매일 도는 DB 함수 `lostfound_auto_dispose()`(202607180001) 가 메모가 비어 있을 때 넣는 한국어 한 줄
 * 「보관기간 만료 자동 폐기」. 저장값은 그대로 두고 그릴 때 보는 사람 언어로 바꾼다(2026-10-23).
 */
const AUTO_DISPOSE_MEMO = "\uBCF4\uAD00\uAE30\uAC04 \uB9CC\uB8CC \uC790\uB3D9 \uD3D0\uAE30";

export function appendAdminRestoreMemo(previousMemo: string, reason: string): string {
  const trimmedReason = reason.trim();
  const entry = trimmedReason ? `${ADMIN_RESTORE_MARKER} ${trimmedReason}` : ADMIN_RESTORE_MARKER;
  return previousMemo ? `${previousMemo}\n${entry}` : entry;
}

export function localizeLostFoundMemo(
  memo: string | null,
  adminRestoreLabel: string,
  autoDisposeLabel?: string,
): string | null {
  if (!memo) return null;

  return memo
    .split("\n")
    .map((line) => {
      if (autoDisposeLabel && line.trim() === AUTO_DISPOSE_MEMO) return autoDisposeLabel;
      if (line === ADMIN_RESTORE_MARKER) return adminRestoreLabel;
      if (line.startsWith(`${ADMIN_RESTORE_MARKER} `)) {
        return `${adminRestoreLabel}: ${line.slice(ADMIN_RESTORE_MARKER.length + 1)}`;
      }
      if (line === LEGACY_ADMIN_RESTORE_LABEL) return adminRestoreLabel;
      if (line.startsWith(`${LEGACY_ADMIN_RESTORE_LABEL}: `)) {
        return `${adminRestoreLabel}: ${line.slice(LEGACY_ADMIN_RESTORE_LABEL.length + 2)}`;
      }
      return line;
    })
    .join("\n");
}
