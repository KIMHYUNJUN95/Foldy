// 분실물 현장 처리 규칙 — 클라이언트 · 서버 공용(client-safe, 2026-10-26).
// 서버 액션(`src/app/mobile/requests/lost-found/actions.ts`)과 모바일 처리 폼(`lost-found-handling-form.tsx`)이
// 같은 규칙을 쓰도록 한 곳에 둔다. "use server" 파일은 동기 함수를 내보낼 수 없어서 여기로 뺐다.
import {
  isLostItemTerminal,
  lostItemLinearStatuses,
  type LostItemStatus,
} from "@/lib/lost-found-constants";

/**
 * 상태 전이 검증 — 어드민 콘솔이 지키는 규칙과 같은 기준을 현장에도 적용한다:
 *
 * - 상태 변경 없이 메모·사진만 저장하는 것은 허용한다.
 * - 종결(폐기완료 / 반환완료)에서 다른 상태로 나가는 것은 금지 — 관리자 복원 경로만 되돌릴 수 있다.
 * - 손님 반환(returned)은 진행 중 어느 단계에서든 가능하다(보관 흐름 밖의 종결).
 * - 폐기 경로는 접수 → 보관 → 폐기예정 → 폐기완료를 한 단계씩만 전진한다. 되돌리기(보관 연장 등)는
 *   어드민 `extendLostItemStorage` / `correctLostItemStatus` 담당.
 */
export function isValidLostItemTransition(from: LostItemStatus, to: LostItemStatus): boolean {
  if (from === to) return true;
  if (isLostItemTerminal(from)) return false;
  if (to === "returned") return true;
  const fromIdx = lostItemLinearStatuses.indexOf(from);
  const toIdx = lostItemLinearStatuses.indexOf(to);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}

// 시스템이 처리 메모에 넣는 줄 — `src/lib/lost-found-memo.ts` 의 표시와 같은 값이어야 한다.
const ADMIN_RESTORE_MARKER = "[stayops:admin_restore]";
const LEGACY_ADMIN_RESTORE_LABEL = "관리자 복원";

/** DB 자동 폐기(`lostfound_auto_dispose`)가 빈 메모에 넣는 한국어 한 줄 — `lost-found-memo.ts` 와 같은 값. */
const AUTO_DISPOSE_MEMO = "\uBCF4\uAD00\uAE30\uAC04 \uB9CC\uB8CC \uC790\uB3D9 \uD3D0\uAE30";

function isSystemMemoLine(line: string): boolean {
  return (
    line.trim() === AUTO_DISPOSE_MEMO ||
    line === ADMIN_RESTORE_MARKER ||
    line.startsWith(`${ADMIN_RESTORE_MARKER} `) ||
    line === LEGACY_ADMIN_RESTORE_LABEL ||
    line.startsWith(`${LEGACY_ADMIN_RESTORE_LABEL}: `)
  );
}

/**
 * 처리 메모를 사람이 쓴 줄과 시스템 줄(관리자 복원 표시)로 나눈다. 모바일 처리 폼은 사람이 쓴 줄만 고치게 하고,
 * 저장할 때 서버가 시스템 줄을 원래대로 뒤에 다시 붙인다 — 보는 사람 언어로 바꾼 표시가 메모에 굳어 저장되지 않게(2026-10-26).
 */
export function splitLostFoundHandlingMemo(memo: string | null): { editable: string; systemLines: string[] } {
  if (!memo) return { editable: "", systemLines: [] };
  const editable: string[] = [];
  const systemLines: string[] = [];
  for (const line of memo.split("\n")) {
    if (isSystemMemoLine(line)) systemLines.push(line);
    else editable.push(line);
  }
  return { editable: editable.join("\n").trim(), systemLines };
}
