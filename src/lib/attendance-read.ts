// 근태 읽기 실패 — 「0건」으로 보고 계산하지 않는다(2026-11-11).
//
// 급여 · 마감 · 결재 요청은 읽은 행으로 금액을 굳힌다. 휴게 읽기가 실패했는데 빈 목록으로 계산하면 휴게가 빠지지
// 않아 과지급이 마감 스냅샷에 남고, 정정 요청 읽기가 실패했는데 0건으로 보면 막혀야 할 마감이 통과한다.
// 그래서 이 경로들은 읽기 오류를 만나면 던지고, 부르는 쪽(마감 · 결재 요청)은 「오류」로 돌려준다.

export class AttendanceReadError extends Error {
  constructor(
    readonly table: string,
    detail: string,
  ) {
    super(`[attendance] ${table} read failed: ${detail}`);
    this.name = "AttendanceReadError";
  }
}

/** PostgREST 응답에 오류가 있으면 던지고, 없으면 `data`(없으면 빈 값)를 돌려준다. */
export function requireRead<T>(table: string, res: { data: T | null; error: { message: string } | null }, empty: T): T {
  if (res.error) throw new AttendanceReadError(table, res.error.message);
  return res.data ?? empty;
}
