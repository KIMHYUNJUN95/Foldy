/** 한 채짜리 건물은 방 이름이 건물 이름과 같다 — 같으면 방을 빼서 「오쿠보A 오쿠보A」 중복을 막는다. */
export function distinctRoom(room: string | null | undefined, building: string | null | undefined): string | null {
  const r = room?.trim();
  if (!r || r === "-") return null;
  return r === building?.trim() ? null : r;
}

/** 「건물 · 방」 한 줄 — 방이 비었거나 「-」면 wholeLabel(건물 전체), 건물과 같으면 건물만. */
export function placeLine(building: string, room: string | null | undefined, wholeLabel: string): string {
  const r = room?.trim();
  if (!r || r === "-") return `${building} · ${wholeLabel}`;
  const distinct = distinctRoom(r, building);
  return distinct ? `${building} · ${distinct}` : building;
}
