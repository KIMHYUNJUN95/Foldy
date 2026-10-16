// 건물 지도 「처음 그리는 장면」 — 탭(세션)의 첫 번째는 긴 장면(full), 그 뒤엔 짧게 펼치기(short),
// 움직임 줄이기면 없음(none). 지도(building-map)와 목록 판(building-picker)이 같은 답을 쓰도록
// 모듈에 한 번만 정해 둔다(개발 모드에서 효과가 두 번 돌아도 같은 값). 화면을 다시 열면(마운트마다) 짧은 장면.
const INTRO_KEY = "foldy.bmap.intro";
export type MapIntro = "full" | "short" | "none";
let decision: MapIntro | null = null;

export function decideMapIntro(): MapIntro {
  if (decision !== null) return decision;
  try {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    decision = reduce ? "none" : window.sessionStorage.getItem(INTRO_KEY) === "1" ? "short" : "full";
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    decision = "short";
  }
  return decision;
}

/** 화면을 떠날 때 — 다음에 열면 다시 정한다(첫 장면을 본 탭이면 짧은 장면). */
export function resetMapIntro() {
  decision = null;
}
