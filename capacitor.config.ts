import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * iOS · Android 앱 껍데기 (Capacitor, 2026-10-06 결정 — docs/planning/01-decision-log.md).
 *
 * 앱은 배포된 웹을 그대로 띄운다(`server.url`) — 웹 배포가 곧 앱 내용 갱신이다. 웹 · PWA 는 그대로 운영한다.
 * `webDir` 은 그 주소에 닿지 못할 때만 보이는 대체 화면.
 *
 * - `CAP_SERVER_URL` 로 다른 배포(미리보기 · 자체 도메인)를 가리킬 수 있다. 자체 도메인이 생기면(계획 A4 · C1) 기본값을 바꾼다.
 * - `appId` 는 스토어 등록(계획 C4) 전까지 바꿀 수 있다. 등록 후에는 바꿀 수 없다.
 * - 계획 · 진행: docs/planning/17-app-release-plan.md
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://stay-ops-two.vercel.app";

const config: CapacitorConfig = {
  appId: "com.harutokyo.foldy",
  appName: "Foldy",
  webDir: "capacitor-www",
  // 웹이 그려지기 전 WebView 바탕 — 시작 화면 · 웹 바탕과 같은 흰색이어야 깜빡이지 않는다(N11). 화이트 리디자인(2026-10)에서 아이보리 → 흰색.
  backgroundColor: "#FFFFFF",
  // 서버가 「앱」임을 알도록 UA 끝에 붙인다 — `src/lib/native-app.ts` NATIVE_APP_UA_TAG 와 같아야 한다. 아이패드 앱은 Mac UA 를 보내
  // 관리 콘솔로 갈 수 있었다. 꼬리표가 있으면 늘 모바일 화면(`src/lib/mobile-device.ts`).
  appendUserAgent: "StayOpsApp",
  server: {
    url: serverUrl,
    cleartext: false,
    // 배포된 웹을 못 불러오면(오프라인 · 서버 장애) 브라우저 기본 오류 화면 대신 `capacitor-www/index.html`(3개 언어 + 다시 시도)을 연다.
    // 그 파일의 APP_URL 은 위 기본 serverUrl 과 같아야 한다(계획 D2).
    errorPath: "index.html",
  },
  // 웹이 safe-area(env(safe-area-inset-*))를 직접 처리하므로 네이티브 쪽 여백은 넣지 않는다.
  ios: {
    contentInset: "never",
    // 링크를 길게 누르면 뜨는 Safari 식 미리보기(주소 · 「Safari 에서 열기」)를 끈다 — 네이티브 품질 N8.
    allowsLinkPreview: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // 뒤로가기(2026-10-20): Android 는 앱 플러그인 `PredictiveBack`(MainActivity 가 등록)이 예측 뒤로가기 제스처를 받아 웹 스와이프
    // 엔진으로 넘긴다. App 플러그인의 뒤로 처리는 늘 켜져 있어 OS 미리보기(홈으로 나가기)를 막으므로 끈다. 플러그인이 없는 옛 앱
    // 빌드는 이 설정도 옛것이라 `backButton` 으로 그대로 동작한다(NativeShellBridge).
    App: {
      disableBackButtonHandler: true,
    },
    // Android 15+ 는 앱을 상태바 · 내비게이션 바 아래까지 그린다(edge-to-edge). 웹은 이미 `viewport-fit=cover` +
    // `env(safe-area-inset-*)` 로 여백을 잡으므로 Capacitor 권장값 `native` 를 쓰고, 첫 화면이 튀지 않게 cover 힌트를 준다.
    SystemBars: {
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
      // 웹은 늘 밝은 아이보리 화면이다 → 상태바 아이콘은 어둡게(LIGHT = 밝은 바탕용). 기기 다크 모드여도 앱 화면은 밝으므로 따라가지 않는다(N1).
      style: "LIGHT",
    },
    // 키보드(2026-10-09). iOS: `none` = WebView 크기를 바꾸지 않는다 — 웹은 iOS Safari 처럼 visualViewport 로 키보드를 처리하도록
    // 맞춰져 있다(KeyboardInsetSync). 키보드 뒤 바탕은 앱 바탕색. 입력칸 위 「‹ › 완료」 막대는 NativeShellBridge 에서 숨긴다.
    // Android: edge-to-edge(전체 화면)에서는 키보드가 WebView 를 줄이지 않아 입력칸을 가리는 버그가 있어 우회를 켠다.
    Keyboard: {
      resize: KeyboardResize.None,
      autoBackdropColor: "auto",
      resizeOnFullScreen: true,
    },
    // 신분 서류 화면 가리기(2026-10-23, `@capgo/capacitor-privacy-screen`, docs/product/41 §10). 앱 시작 때는 꺼 둔다 —
    // 재류카드 촬영 · 관리자 카드 칸이 떠 있는 동안만 웹이 켠다(`src/lib/native/privacy-screen.ts`). Android: FLAG_SECURE(스크린샷 ·
    // 녹화 · 최근 앱 미리보기 막기). iOS: 켜져 있는 동안 앱 전환기 미리보기를 가리고 화면 캡처를 검게 만든다.
    PrivacyScreen: {
      enabled: false,
    },
  },
};

export default config;
