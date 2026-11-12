/** 설정 › 출퇴근 현장 — 목록 · 패널 표시 규칙(2026-11-12 설정 화면 다듬기). DB 없음. */

export const RADIUS_PRESETS = [50, 100, 150, 200] as const;

/** 인쇄 이름이 비었거나 현장 이름과 같으면 null — 목록에 같은 이름을 두 줄로 찍지 않는다. */
export function distinctPrintName(name: string, printName: string | null | undefined): string | null {
  const p = (printName ?? "").trim();
  if (!p || p === name.trim()) return null;
  return p;
}

/** 좌표 한 줄 「35.6938, 139.7034」. 둘 중 하나라도 비었거나 범위를 벗어나면 null(칸을 바로 펼친다). */
export function coordsLine(lat: string, lng: string): string | null {
  const a = lat.trim();
  const b = lng.trim();
  if (!a || !b) return null;
  const la = Number(a);
  const lo = Number(b);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return `${a}, ${b}`;
}

/** 반경 값이 바로 고르기 칸 중 하나면 그 값, 아니면 null(「직접」). */
export function radiusPreset(radius: string): number | null {
  return RADIUS_PRESETS.find((value) => String(value) === radius.trim()) ?? null;
}
