/**
 * 받는 사람 · 참조 시트 확정값 → 쓰기 화면 상태. 수정 화면에서는 지금 받는 사람 · 참조가 고를 수 있는 목록(users)에
 * 없을 수 있다(퇴사 · 권한 변경) — 그대로 두고 확정해도 사라지지 않게, 새로 고른 사람만 users 에서 찾는다.
 */
type Person = { id: string };

export function pickRecipient<T extends Person>(
  current: T | null,
  ids: string[],
  users: T[],
): T | null {
  const id = ids[0];
  if (!id) return null;
  if (id === current?.id) return current;
  return users.find((u) => u.id === id) ?? current;
}

export function pickReferences<T extends Person>(
  current: T[],
  ids: string[],
  users: T[],
  recipientId: string | null | undefined,
): T[] {
  const pool = new Map<string, T>();
  for (const u of current) pool.set(u.id, u);
  for (const u of users) if (!pool.has(u.id)) pool.set(u.id, u);
  return ids
    .filter((id) => id !== recipientId)
    .map((id) => pool.get(id))
    .filter((u): u is T => Boolean(u));
}

/** 받는 사람이 바뀌면 그 사람은 참조에서 뺀다 — 같은 사람이 두 자리에 있지 않게. */
export function dropFromReferences<T extends Person>(references: T[], recipientId: string | null | undefined): T[] {
  return recipientId ? references.filter((r) => r.id !== recipientId) : references;
}
