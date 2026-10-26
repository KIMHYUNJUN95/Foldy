import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 배열을 고정 크기 조각으로 나눈다. PostgREST `.in(...)` 필터가 요청 URL 길이 제한
 * 아래에 머물도록 쓴다 — UUID 수백 개를 담은 `.in()` 하나는 수 KB 짜리 쿼리
 * 문자열이 되어 Supabase 게이트웨이가 거부한다 (낮은 수준의 `fetch failed` 로 드러남). 호출자는
 * 조각마다 쿼리를 한 번씩 돌리고 결과를 합친다.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
