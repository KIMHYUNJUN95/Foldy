// Capacitor 앱(iOS · Android) 관련 상수 · 판정 (2026-10-06, 앱 출시 준비 B2).
//
// 앱은 배포된 웹을 WebView 로 띄운다(capacitor.config.ts). 같은 웹이 브라우저 · PWA · 앱에서 모두 돌므로,
// 앱에서만 달라야 하는 동작(예: Google 로그인을 시스템 브라우저로)은 여기 판정으로 가른다.
// 문서: docs/engineering/03-deployment-strategy.md 「앱 빌드」 · docs/planning/17-app-release-plan.md B2

/**
 * 앱 전용 URL 스킴 — OAuth 가 끝나면 시스템 브라우저가 이 주소로 앱을 다시 연다.
 * Android `AndroidManifest.xml` intent-filter · iOS `Info.plist` CFBundleURLSchemes · Supabase Auth 「Redirect URLs」와
 * **반드시 같아야** 한다. 앱 ID(`capacitor.config.ts` appId)와 같은 역DNS 형식(Google 권장).
 */
export const NATIVE_APP_SCHEME = "com.harutokyo.foldy";

/** 앱 OAuth 복귀 주소. Supabase 가 여기에 `?code=` 를 붙여 돌려보낸다. */
export const NATIVE_AUTH_CALLBACK = `${NATIVE_APP_SCHEME}://auth/callback`;

/**
 * 지금 Capacitor 앱 안에서 돌고 있는가(클라이언트 전용). Capacitor 는 `server.url` 로 띄운 원격 페이지에도
 * `window.Capacitor` 브리지를 주입한다. 브라우저 · PWA 에서는 false.
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  getPlatform?: () => string;
};

function capacitorGlobal(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

/**
 * 이 앱 설치본에 해당 네이티브 플러그인이 들어 있는가(2026-10-09, 웹 · 앱 버전 어긋남 대비).
 *
 * 앱은 배포된 웹을 띄우므로 **웹 배포는 이미 깔린 모든 앱 버전에 즉시 들어간다.** 새 웹이 옛 설치본에 없는 플러그인을 부르면
 * 「not implemented」로 동작이 끊긴다. 네이티브 플러그인을 쓰는 곳은 **반드시 이 판정으로 거르고, 없으면 웹 방식으로** 동작한다.
 * 이름은 플러그인 등록 이름(`Geolocation` · `Haptics` · `Share` · `Keyboard` · `TextZoom` · `App` · `Browser`).
 */
export function hasNativePlugin(name: string): boolean {
  const cap = capacitorGlobal();
  if (!cap?.isNativePlatform?.()) return false;
  try {
    return Boolean(cap.isPluginAvailable?.(name));
  } catch {
    return false;
  }
}

/** "ios" · "android" · null(브라우저 · PWA). */
export function nativePlatform(): "ios" | "android" | null {
  const cap = capacitorGlobal();
  if (!cap?.isNativePlatform?.()) return null;
  const platform = cap.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

export type NativeAppInfo = { platform: "ios" | "android"; build: number; version: string };

let nativeAppInfo: Promise<NativeAppInfo | null> | null = null;

/** 설치된 앱의 버전 · 빌드 번호(앱이 아니면 null). 한 번 읽어 둔다. */
export function getNativeAppInfo(): Promise<NativeAppInfo | null> {
  nativeAppInfo ??= (async () => {
    const platform = nativePlatform();
    if (!platform || !hasNativePlugin("App")) return null;
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      const build = Number.parseInt(info.build, 10);
      return { platform, build: Number.isFinite(build) ? build : 0, version: info.version };
    } catch {
      return null;
    }
  })();
  return nativeAppInfo;
}

/**
 * 앱 안 브라우저(`@capacitor/browser` — iOS SFSafariViewController · Android Custom Tab) 공통 옵션(2026-10-09, 네이티브 품질 N5).
 * 툴바를 앱 바탕색(아이보리)으로 — 기본값은 브라우저 색(흰색 · 회색)이라 앱에서 다른 앱으로 넘어간 느낌이 났다. 아이콘 색은 OS 가 대비로 고른다.
 */
export const IN_APP_BROWSER_OPTIONS = { presentationStyle: "popover", toolbarColor: "#FFFFFF" } as const;

/**
 * 앱 사용자 에이전트 꼬리표 — `capacitor.config.ts` `appendUserAgent` 와 같아야 한다. 서버(`mobile-device.ts`)는 이 꼬리표가 있으면
 * 기기 종류와 상관없이 모바일 화면으로 보낸다(아이패드 앱이 Mac 으로 보내는 UA 때문에 관리 콘솔로 가지 않게).
 */
export const NATIVE_APP_UA_TAG = "StayOpsApp";

/**
 * 웹이 요구하는 **최소 앱 빌드 번호**(Android `versionCode` · iOS `CURRENT_PROJECT_VERSION`). 이보다 낮은 설치본에는
 * 「업데이트」 화면을 띄운다(`NativeUpdateGate`).
 *
 * 올리는 때: 웹이 새 네이티브 플러그인 · 설정 **없이는 동작할 수 없게** 바뀔 때만. 플러그인 판정(`hasNativePlugin`)으로 웹 방식
 * 대체가 되면 올리지 않는다. 올리기 전에 그 빌드가 두 스토어에 **이미 배포돼 있어야** 한다 — 아니면 사용자가 받을 새 버전이 없다.
 * 문서: docs/engineering/03-deployment-strategy.md 「웹 · 앱 버전 어긋남」.
 */
export const MIN_NATIVE_BUILD: Record<"ios" | "android", number> = { ios: 1, android: 1 };

/**
 * 스토어 주소. Android 는 앱 ID 로 정해진다. iOS 는 App Store 앱 ID(숫자)가 C9 등록 후 생긴다 — 그 전에는 null 이라
 * 업데이트 화면에 버튼 없이 안내만 나온다.
 */
export const NATIVE_STORE_URL: Record<"ios" | "android", string | null> = {
  // market: 주소는 Play 스토어 앱으로 바로 연다(앱 안 브라우저를 거치지 않는다 — http 가 아니라 NativeShellBridge 가 건드리지 않고 OS 로 넘어간다).
  android: "market://details?id=com.harutokyo.foldy",
  ios: null,
};

/**
 * `com.harutokyo.foldy://auth/callback?...` 이면 웹 콜백 경로(`/auth/callback?...`)를, 아니면 null.
 *
 * `new URL()` 로 나누지 않고 **문자열로** 본다(2026-10-08, N10). 예전 Chromium WebView(에뮬레이터 API 35 기본값 등)는 커스텀
 * 스킴 주소에서 host 를 나누지 않아 `//auth/callback` 전체를 pathname 으로 읽었다 — 그래서 판정이 늘 null 이 되어 Google
 * 로그인 코드가 조용히 버려지고 앱이 로그인 화면에 머물렀다. Node(테스트)에서는 재현되지 않는다.
 */
export function nativeCallbackToWebPath(url: string): string | null {
  const prefix = `${NATIVE_APP_SCHEME}://auth/callback`;
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  // `/auth/callbackX` 같은 다른 경로는 거른다 — 바로 뒤는 비었거나 쿼리 · 조각만 허용.
  if (rest !== "" && !rest.startsWith("?") && !rest.startsWith("#")) return null;
  const query = rest.split("#")[0];
  return `/auth/callback${query}`;
}
