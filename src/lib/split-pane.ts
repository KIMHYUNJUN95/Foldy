/**
 * 목록 · 상세 2분할(태블릿 가로) — 공용 상수 · 판정. **순수하다.**
 *
 * 도메인 계약: docs/product/16-mobile-navigation.md 「목록 → 상세 2분할」
 *
 * 태블릿 가로(`tablet:` — ≥ 1000px · 높이 ≥ 600px)에서 목록을 누르면 오른쪽 칸에 **그 상세 화면을 그대로** 띄운다(같은
 * 출처 프레임 — `name="stayops-pane"`). 프레임 안의 화면은 「칸 모드」(`html[data-pane]`)로 메뉴 · 머리 없이 본문만 그린다.
 * 상세 화면 코드는 하나도 바꾸지 않는다 — 폰 · 폴드에서는 지금처럼 상세 화면으로 넘어간다.
 */

export const SPLIT_PANE_NAME = "stayops-pane";
export const SPLIT_PANE_MESSAGE = "stayops-pane";
export const TABLET_QUERY = "(min-width: 1000px) and (min-height: 600px)";

export type SplitPaneMessage =
  | { type: typeof SPLIT_PANE_MESSAGE; kind: "nav"; path: string }
  | { type: typeof SPLIT_PANE_MESSAGE; kind: "mutated" };

export function isSplitPaneMessage(data: unknown): data is SplitPaneMessage {
  return Boolean(data && typeof data === "object" && (data as { type?: unknown }).type === SPLIT_PANE_MESSAGE);
}

/** 상세 주소인가(`pathname` 만 본다). */
export function matchesDetail(pattern: RegExp, path: string): boolean {
  return pattern.test(path.split(/[?#]/)[0] ?? "");
}

/**
 * 칸 모드 판정 + 서버 액션 감지 — 루트 레이아웃 `<head>` 에 **그리기 전에** 도는 스크립트(깜빡임 없이 메뉴를 숨긴다).
 * 프레임 이름은 프레임 안에서 주소가 바뀌어도 남는다. 칸 안에서 서버 액션(POST + `next-action` 머리)이 끝나면 부모에
 * 「바뀜」을 알려 왼쪽 목록을 새로 읽게 한다.
 */
// 앞부분: 앱(Capacitor) 안이면 그리기 전에 `html[data-native-app]` 을 단다(2026-10-08, 네이티브 품질 N11). Capacitor 는 브리지를
// 문서 시작 시점에 주입하므로 여기서 이미 보인다. 앱은 OS 시작 화면이 있으니 웹 시작 화면(`[data-splash]`)을 겹쳐 띄우지 않는다
// (globals.css) — 겹치면 큰 원 아이콘 → 작은 네모 아이콘(튀어나오는 애니메이션)으로 로고가 순간 이동 · 흐려 보였다.
export const SPLIT_PANE_BOOT_SCRIPT = `(function(){try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform())document.documentElement.setAttribute("data-native-app","1")}catch(e){}})();(function(){try{if(window.top===window.self||window.name!=="${SPLIT_PANE_NAME}")return;document.documentElement.setAttribute("data-pane","1");var f=window.fetch;window.fetch=function(i,o){var p=f.apply(this,arguments);try{var h=o&&o.headers;var a=h&&(typeof h.get==="function"?(h.get("next-action")||h.get("Next-Action")):(h["next-action"]||h["Next-Action"]));if(a){p.then(function(){window.parent.postMessage({type:"${SPLIT_PANE_MESSAGE}",kind:"mutated"},window.location.origin)},function(){})}}catch(e){}return p}}catch(e){}})();`;

/**
 * 목록마다 오른쪽 칸에 열 상세 주소. 새로 만들기 · 하위 목록(처리 끝난 분실물 등)은 빼고, 상세의 수정 화면은 칸 안에 둔다.
 */
const FEATURE_DETAIL_PATTERNS = {
  announcements: /^\/mobile\/announcements\/[^/]+$/,
  board: /^\/mobile\/board\/(?!compose$)[^/]+(\/edit)?$/,
  bugs: /^\/mobile\/bugs\/(?!new$)[^/]+$/,
  complaints: /^\/mobile\/complaints\/(reviews\/)?(?!new$|reviews$)[^/]+$/,
  linen: /^\/mobile\/linen-return\/record\/[^/]+(\/edit)?$/,
  requests: /^\/mobile\/requests\/(maintenance|lost-found|orders)\/(?!new$|disposed$|returned$)[^/]+$/,
  suggestions: /^\/mobile\/suggestions\/(?!new$|referenced$)[^/]+(\/edit)?$/,
  tasks: /^\/mobile\/tasks\/(?!new$|projects$)[^/]+(\/edit)?$/,
  /** 사용자 관리(2026-10-20) — 멤버 상세. 초대코드 · 서류 탭은 상세가 아니다. */
  users: /^\/mobile\/users\/(?!invites$|documents$)[^/]+$/,
  /** 사용자 관리 › 서류(재류카드 R4, 2026-10-26) — 한 사람 서류 · 대신 올리기. */
  staffDocs: /^\/mobile\/users\/documents\/[^/]+$/,
} as const satisfies Record<string, RegExp>;

export const SPLIT_DETAIL_PATTERNS = {
  ...FEATURE_DETAIL_PATTERNS,
  /**
   * 알림 목록(2026-10-05) — 알림은 여러 기능의 상세로 간다. 위 상세 주소 **어느 것이든** 칸에 연다(메일 앱처럼). 그 밖의
   * 주소(근태 · 캘린더 등 상세가 아닌 화면)는 그대로 넘어간다.
   */
  notifications: new RegExp(
    Object.values(FEATURE_DETAIL_PATTERNS)
      .map((pattern) => `(?:${pattern.source})`)
      .join("|"),
  ),
} as const;

export type SplitDetailKey = keyof typeof SPLIT_DETAIL_PATTERNS;
