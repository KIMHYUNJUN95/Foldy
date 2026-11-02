import { randomInt } from "node:crypto";

// 6자리 체크인 코드. 겹침은 DB 가 막는다(stays_active_code_idx — 진행 중인 stay 끼리만 unique) — 겹치면 새로 뽑는다.
export function newCheckinCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
