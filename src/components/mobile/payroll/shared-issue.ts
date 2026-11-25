/** 목록의 모든 줄이 같은 첫 안내(빨간 점)를 가질 때만 그 키를 돌려준다 — 줄마다 반복하지 않고 한 줄로 모으기 위해. */
export function sharedFirstIssue<K extends string>(rows: ReadonlyArray<{ issues: readonly K[] }>): K | null {
  if (rows.length < 2) return null;
  const first = rows[0].issues[0];
  if (first === undefined) return null;
  return rows.every((r) => r.issues[0] === first) ? first : null;
}
