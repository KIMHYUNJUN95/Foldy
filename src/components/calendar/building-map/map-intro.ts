// 건물 지도 「처음 그리는 장면」 여부 — 탭(세션)마다 한 번, 움직임 줄이기면 없음.
// 지도(building-map)와 목록 판(building-picker)이 같은 답을 쓰도록 모듈에 한 번만 정해 둔다
// (개발 모드에서 효과가 두 번 돌아도 같은 값).
const INTRO_KEY = "foldy.bmap.intro";
let decision: boolean | null = null;

export function decideMapIntro() {
  if (decision !== null) return decision;
  try {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    decision = !reduce && window.sessionStorage.getItem(INTRO_KEY) !== "1";
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    decision = false;
  }
  return decision;
}
