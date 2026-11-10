// 분실물 현장 처리 규칙 — 클라이언트 · 서버 공용(client-safe, 2026-10-26).
// 서버 액션(`src/app/mobile/requests/lost-found/actions.ts`)과 모바일 처리 폼(`lost-found-handling-form.tsx`)이
// 같은 규칙을 쓰도록 한 곳에 둔다. "use server" 파일은 동기 함수를 내보낼 수 없어서 여기로 뺐다.
import {
  isLostItemTerminal,
  lostItemStatuses,
  type LostItemStatus,
} from "@/lib/lost-found-constants";

/**
 * 현장(모바일, 권한 키 `lost_found.handle`) 상태 넘기기 규칙 — 서버 액션과 모바일 상태 칩이 이 함수 하나를 쓴다.
 *
 * - 진행 중(접수 · 보관 중 · 폐기 예정)에서 상태를 그대로 두고 메모 · 사진만 저장하는 것은 허용한다.
 * - 종결(폐기 완료 / 반환 완료)에서는 아무것도 못 한다 — 같은 상태 저장도 막는다(2026-11-10, 처리자 · 처리 시각을 덮었다).
 *   되돌리기는 PC 관리자 복원 경로만.
 * - 손님 반환(returned)은 진행 중 어느 단계에서든 가능하다(보관 흐름 밖의 종결).
 * - 폐기 쪽은 「접수 → 보관 중」과 「폐기 예정 → 폐기 완료」만. **「보관 중 → 폐기 예정」은 현장이 못 한다** — 폐기 예정은 밤 자동
 *   처리(보관 기한 3일 전)와 PC 관리자만 정한다(사용자 결정 2026-11-10). 기한 전 「바로 폐기」 예외도 없다. 되돌리기 · 연장은
 *   PC `extendLostItemStorage` / `correctLostItemStatus` 담당.
 */
const FIELD_FORWARD: Partial<Record<LostItemStatus, LostItemStatus>> = {
  registered: "stored",
  disposal_scheduled: "disposed",
};

export function isValidLostItemTransition(from: LostItemStatus, to: LostItemStatus): boolean {
  if (isLostItemTerminal(from)) return false;
  if (from === to) return true;
  if (to === "returned") return true;
  return FIELD_FORWARD[from] === to;
}

/** 모바일 상태 칩에 보일 상태(지금 상태 포함, 표시 순서 그대로). 막힌 단계는 아예 안 보인다. */
export function lostItemFieldTargets(from: LostItemStatus): LostItemStatus[] {
  return lostItemStatuses.filter((to) => isValidLostItemTransition(from, to));
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
