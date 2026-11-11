/**
 * 개수 문구 — 영어 단수 · 복수(2026-11-11). 사전 값에 `"{n} day|{n} days"` 처럼 `|` 로 두 꼴을 적으면 1 일 때 앞쪽을 쓴다.
 * `|` 가 없는 값(ko · ja)은 그대로 `{n}` 만 바꾼다.
 */
export function countText(template: string, n: number | string): string {
  const value = Number(n);
  const [one, other] = template.split("|");
  const picked = other !== undefined && value === 1 ? one : (other ?? one);
  return picked.replaceAll("{n}", String(n));
}
