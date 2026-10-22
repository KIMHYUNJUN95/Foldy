# Deployment Strategy

## Requirement

Foldy must be usable on both iPhone and Android even before public App Store / Google Play release.

The product may start as an internal company app before public launch.

The first stage must be free/low-cost, and Apple Developer account is not expected to be available immediately.

## Target Platforms

Required:

- iOS
- Android
- Admin web

## Public Store Release

Public store release is not planned immediately.

However, the app should be designed so it can later be released through:

- Apple App Store
- Google Play Store

## Internal Use Before Store Release

Possible approaches:

### PWA

Recommended for first stage.

Pros:

- No Apple Developer account required to start
- No Google Play Console account required to start
- Works on iPhone, Android, and desktop
- Can be added to home screen

Important:

- iPhone web push requires iOS 16.4+ and Home Screen installation.
- Staff onboarding should include "Add to Home Screen" instructions.

### iOS

Options:

- TestFlight
- Apple Business Manager / Custom App later if needed
- Development/internal builds for limited testing

### Android

Options:

- Internal app sharing
- Closed testing track
- APK/AAB internal distribution depending on setup

## Notification Requirement

Push notifications are important and must work on mobile devices.

The notification system should also support an in-app notification center that can be viewed from:

- Mobile app
- Admin web

## Technical Implication

If using React Native + Expo:

- EAS Build should be evaluated for internal iOS/Android builds.
- Push notification setup must be tested on real devices.
- Apple/Google developer account requirements should be checked before implementation.

## Open Questions

- How many internal iPhone users need access?
- How many internal Android users need access?
- Should the first internal version use TestFlight for iOS?
- Should Android use closed testing or direct APK distribution?

## Developer Account Status

Current status:

- Apple Developer account: not available yet
- Google Play Console account: not available yet

Required before reliable internal mobile distribution:

- Create Apple Developer account
- Create Google Play Console account

Priority:

- Apple Developer account is especially important for iPhone testing and TestFlight distribution.

Current recommendation:

- Start with PWA before creating developer accounts.
- Create Apple Developer and Google Play Console accounts later before native app release.

## 앱 빌드 (Capacitor, 2026-10-06)

결정: `docs/planning/01-decision-log.md` 2026-10-06 「앱 껍데기는 Capacitor」. 진행 체크리스트: `docs/planning/17-app-release-plan.md`.

### 구조

| 파일 · 폴더 | 무엇 |
| --- | --- |
| `capacitor.config.ts` | 앱 ID `com.harutokyo.foldy`(C4 전까지 변경 가능) · 앱 이름 · `server.url`(앱이 띄우는 배포 주소, 기본 `https://stay-ops-two.vercel.app`, `CAP_SERVER_URL` 로 덮어씀) |
| `capacitor-www/index.html` | 배포 주소에 닿지 못할 때만 보이는 대체 화면(ko/ja/en) |
| `android/` | Android Studio 프로젝트. 권한: 인터넷 · 카메라 · 위치(정밀 · 대략) |
| `ios/` | Xcode 프로젝트(Swift Package Manager — CocoaPods 불필요). `Info.plist` 권한 문구: 카메라 · 위치(사용 중) · 사진(영문 기본 — ko/ja 현지화는 C6) |
| `.vercelignore` | 웹 배포에서 위 네이티브 폴더 제외 |

- **앱 내용 = 배포된 웹.** 웹을 배포하면 앱도 바로 바뀐다. 네이티브 설정 · 플러그인을 바꿀 때만 앱을 다시 빌드한다.
- 네이티브 폴더는 git 으로 관리한다. 빌드 산출물(`build/`, `public/` 복사본 등)은 각 폴더의 `.gitignore` 가 제외한다.

### 명령

```bash
npm run cap:sync      # capacitor.config.ts · 플러그인 변경을 android/ · ios/ 에 반영
npm run cap:android   # Android Studio 로 열기
npm run cap:ios       # Xcode 로 열기 (macOS 만)
```

### 빌드 환경 (사용자 PC)

- **Android**: Android Studio(Windows · macOS 가능) → `android/` 열기 → 에뮬레이터 · 실기기 실행. 개발자 계정 없이도 실기기 설치(APK) 가능.
- **iOS**: **macOS + Xcode 필수**(Windows · Linux 불가). 실기기 설치 · TestFlight 는 Apple Developer Program 가입 후.
  Mac 이 없으면 클라우드 빌드(GitHub Actions macOS 러너, Codemagic 등)를 검토한다.
- WSL(이 저장소 개발 환경)에는 Java · Android SDK 가 없다 — 네이티브 빌드는 위 환경에서 한다.

### 앱 안 Google 로그인 (B2, 2026-10-06)

Google 은 앱 내 WebView 의 OAuth 를 막는다(`403 disallowed_useragent`). 앱에서는 이렇게 돈다 — 웹 · PWA 는 그대로다.

1. 로그인 화면 Google 버튼(`GoogleSubmitButton`)이 앱 안이면(`isNativeApp()`) 폼을 보내지 않고 서버 액션
   `getNativeGoogleSignInUrl` 로 로그인 URL 만 받는다. 이때 `redirectTo` = **`com.harutokyo.foldy://auth/callback`**(쿼리 없음 — 아래 주의),
   PKCE 확인 쿠키는 앱 WebView 에 심긴다.
2. 그 URL 을 `@capacitor/browser` 로 연다(iOS SFSafariViewController · Android Custom Tab).
3. 로그인이 끝나면 Supabase 가 `com.harutokyo.foldy://auth/callback?code=…` 로 보내고, OS 가 앱을 연다.
4. 루트 레이아웃의 `NativeAuthBridge` 가 `appUrlOpen`(실행 중) · `getLaunchUrl()`(콜드 스타트)을 받아 브라우저를 닫고 WebView 를
   `/auth/callback?code=…` 로 보낸다 → 기존 콜백이 1번의 쿠키로 세션을 만든다.

- 스킴 정의는 네 곳이 **같아야** 한다: `src/lib/native-app.ts` `NATIVE_APP_SCHEME` · `AndroidManifest.xml` intent-filter ·
  iOS `Info.plist` `CFBundleURLTypes` · **Supabase Auth → URL Configuration → Redirect URLs 에 `com.harutokyo.foldy://auth/callback`**.
  마지막이 빠지면 Supabase 가 Site URL(웹)로 돌려보내 로그인이 시스템 브라우저에서 끝나고 앱은 로그아웃 상태로 남는다.
- **`redirectTo` 는 등록된 주소와 글자까지 같아야 한다.** 2026-10-08 까지 `?next=%2Fmobile` 을 붙여 보냈더니 목록과 맞지 않아
  Supabase 가 Site URL 로 돌려보냈다(auth 로그의 `referer` 가 `https://stay-ops-two.vercel.app`). Chrome 에 이미 웹 로그인이 있어서
  **앱 안 브라우저(Custom Tab) 안에서 로그인된 웹이 열려** 앱에 들어간 것처럼 보였다 — 위쪽에 주소 · X · 공유 버튼이 있으면 앱이 아니다.
  지금은 쿼리 없이 보내고, 콜백이 기기 기본 경로(`/mobile`)로 보낸다.
- **앱 복귀 주소는 문자열로 판정한다**(`nativeCallbackToWebPath`). 예전 Chromium WebView 는 `com.harutokyo.foldy://auth/callback` 에서
  host 를 나누지 않아(`//auth/callback` 이 통째로 pathname) `new URL()` 판정이 늘 실패했고, 로그인 코드가 조용히 버려졌다(2026-10-08).
- 회원가입 확인 · 비밀번호 재설정 **메일 링크**는 아직 브라우저에서 열린다(앱으로 열려면 Universal Links / App Links — 계획 C2).

### 앱 안 WebView 보정 (B3, 2026-10-06)

`NativeShellBridge`(루트 레이아웃, 앱에서만 동작):

| 상황 | 웹에서 | 앱에서 |
| --- | --- | --- |
| 다른 출처 링크(Beds24 · Airbnb · Booking · 지도 등), `target="_blank"` 다른 출처 | 새 탭 | 앱 안 브라우저(`@capacitor/browser`) |
| `download` 링크 · 첨부 다운로드(서명 URL을 `a.click()`) | 다운로드 | 앱 안 브라우저(미리보기 · 공유 · 저장) |
| 같은 출처 `target="_blank"` · `window.open` | 새 탭 | 같은 WebView 에서 이동(시스템 브라우저는 로그인 쿠키가 다르다) |
| 다른 출처 `window.open`(예: 캘린더 지도) | 새 탭 | 앱 안 브라우저 |
| `tel:` · `mailto:` | OS | Capacitor 가 OS 로 넘김(손대지 않음) |
| Android 뒤로가기 버튼 | — | 오버레이 닫기 → 이전 화면 → 앱 최소화(`16-mobile-navigation.md`) |
| 앱 안 브라우저 모양 | — | 툴바 = 앱 바탕색 아이보리(`IN_APP_BROWSER_OPTIONS` — 외부 링크 · Google 로그인 공통, N5) |
| 링크 · 사진 길게 누르기 | 브라우저 메뉴 | 메뉴 없음(`contextmenu` 차단, 입력칸 · 편집 영역 제외). iOS 링크 미리보기 off(`ios.allowsLinkPreview: false`) — N8 |
| 앱 아이콘 꾹 누르기(2026-10-22) | — | 출퇴근 · 할 일 추가 · 오늘 내 방. iOS `Info.plist` `UIApplicationShortcutItems` → `SceneDelegate` 가 `com.harutokyo.foldy://open/<id>` 로 넘김 · Android `res/xml/shortcuts.xml`(같은 주소 VIEW 인텐트). 웹 `NativeAuthBridge` + `nativeShortcutToWebPath`(허용 목록). id 를 바꾸면 세 곳을 같이 |
| 연결 상태(2026-10-22) | `navigator.onLine` | `@capacitor/network` 로 오프라인 알약 판정(`OfflinePill`). 플러그인 없는 옛 빌드는 브라우저 값 |

- 상태바 · 내비게이션 바: `capacitor.config.ts` `plugins.SystemBars` = `insetsHandling: "native"` + `initialViewportFitValueHint: "cover"`
  + `style: "LIGHT"`(어두운 아이콘). 웹의 `viewport-fit=cover` · `env(safe-area-inset-*)` 가 그대로 쓰인다(Android 15+ edge-to-edge 대응).
  WebView 가 여백으로 밀리는 경우 상태바 뒤에 보이는 창 바탕은 `styles.xml` `android:windowBackground` = 아이보리 `#F7F4EE`
  (기본 검정이라 상태바가 검게 보였다 — 네이티브 품질 N1). iOS 는 `NativeShellBridge` 가 `SystemBars.setStyle(Light)` 로 맞춘다.
  **웹에 다크 팔레트가 생기면** 이 고정값들을 테마에 따라 바꿔야 한다.
- 카메라: Android 는 Capacitor WebChromeClient 가 웹 요청을 런타임 권한으로 바꿔 묻고, iOS 는 Capacitor 가 WebView 요청을 승인해
  `Info.plist` 문구의 OS 팝업만 뜬다.
- 위치(N2, 2026-10-08): 앱에서는 `navigator.geolocation` 대신 **`@capacitor/geolocation`** 으로 읽는다(`attendance-capture.tsx`
  `getNativeGpsOnce`). WebView 의 웹 위치 요청은 OS 권한과 별도로 「stay-ops-two.vercel.app wants to use your device's location」
  웹 팝업을 띄웠다(iOS 는 앱을 켤 때마다). 브라우저 · PWA 는 그대로 Geolocation API.
- 서비스 워커는 앱에서 **쓰지 않는다**(2026-10-09, 아래 「앱 출시 보강」). 오프라인 대체 화면은 `capacitor-www`. 실기기 확인(B1-1).

### Android 첫 실행 (Windows + Android Studio, Mac 없음)

저장소는 WSL 안에 있지만, Android Studio 는 WSL 경로 프로젝트를 열면 「WSL 안에 JDK 를 설치하라」(`Gradle JVM option is incorrect`)며
동기화에 실패한다(2026-10-06 실제로 겪음). 그래서 **앱 빌드에 필요한 것만 Windows 폴더로 복사해서 연다.**

1. WSL 에서 `npm run cap:android:win` (= `scripts/dev/sync-android-to-windows.sh`) — `cap sync` 후 `android/` 와 그것이 참조하는
   `node_modules/@capacitor/*` 를 같은 구조로 **`C:\dev\stayops-android`** 에 복사한다(빌드 산출물 · `.idea` · `local.properties` 는 건드리지 않음).
2. Android Studio → File → Open → **`C:\dev\stayops-android\android`** → Trust Project → Gradle 동기화(처음 몇 분).
3. Device Manager 에서 에뮬레이터를 만들거나 USB 디버깅 실기기 연결 → ▶ Run. 이 PC 에서 검증된 설정(2026-10-08): **Pixel 8 · API 35 「Google Play
   Intel x86_64 Atom」(「16 KB Page Size」 아님) · Additional settings 에서 Default boot = Cold · Graphics acceleration = Software · RAM 2048MB**.
   최신 미리보기 API(37.x)나 하드웨어 그래픽에서는 에뮬레이터가 멈췄다. 「Project update recommended(AGP 업그레이드)」 알림은 누르지 않는다
   (Gradle 플러그인 버전은 Capacitor 가 맞춘 값).
4. 확인: 이메일 로그인 → Google 로그인(시스템 브라우저 → 앱 복귀) → 홈 → 출퇴근 QR(카메라 · 위치 권한 팝업) → 게시판 첨부 다운로드 →
   룸 링크 외부 링크 → 시트 열고 뒤로가기 버튼 → 비행기 모드로 연결 실패 화면 · 자동 복귀 → 새 아이콘 · 시작 화면.
- 네이티브 설정 · 플러그인을 바꾸면 1번을 다시 돌린다. 웹 화면만 바뀐 것은 다시 빌드할 필요 없다(앱이 배포된 웹을 띄운다).
- Windows Defender 가 Gradle 을 느리게 하면 Android Studio 알림의 「Exclude folders」로 `C:\dev\stayops-android` 를 제외한다.
- **iOS**: Mac 이 없으므로 Apple Developer 가입 후 클라우드 빌드(Codemagic · GitHub Actions macOS 러너 등)로 TestFlight 에 올린다(계획 B1-3).
  그 전까지는 `.github/workflows/ios-build-check.yml` 이 `ios/**` · `capacitor.config.ts` · `package*.json` 변경 때(또는 Actions 에서 수동 실행)
  서명 없이 시뮬레이터용으로 빌드해 Xcode 프로젝트가 깨지지 않았는지, 앱 묶음에 `*.lproj/InfoPlist.strings` · `PrivacyInfo.xcprivacy` 가
  들어갔는지 확인한다.

### 연결 실패 화면 (계획 D2, 2026-10-07)

- 앱은 배포된 웹(`server.url`)을 띄우므로, 그 주소를 못 불러오면 원래는 **WebView 기본 오류 화면**(「웹페이지를 사용할 수 없음」)이 떴다.
  `capacitor.config.ts` 에 `server.errorPath: "index.html"` 을 넣어 `capacitor-www/index.html` 이 대신 열린다.
- 화면: 아이콘 + 「인터넷에 연결되어 있지 않아요」(기기 오프라인) 또는 「Foldy 에 연결할 수 없어요」(온라인인데 서버 실패) + 다시 시도.
  연결이 돌아오면(`online` 이벤트) 자동으로 한 번 다시 시도한다. 다시 시도 = 앱 첫 화면(`APP_URL`)으로 이동.
- 정적 파일이라 `i18n.ts` 를 못 쓴다 → 파일 안 `COPY` 에 ko/ja/en 을 두고 기기 언어로 하나만 보여 준다(없으면 영어).
- **`APP_URL` 은 `capacitor.config.ts` 의 기본 `serverUrl` 과 같아야 한다** — 자체 도메인 교체(C1) 때 두 곳을 같이 고친다.
- 확인(B1-1): 앱을 켠 상태에서 비행기 모드 → 다른 화면으로 이동 / 앱 재시작 → 이 화면이 뜨는지, 비행기 모드 해제 → 자동 복귀.

### 앱 출시 보강 (2026-10-09)

출시 전 점검에서 찾은 기술 공백을 한 번에 메웠다(17번 「출시 보강 목록」 H1~H13). 플러그인 · 네이티브 설정이 바뀌었으므로 **`npm run cap:android:win` → ▶ Run 재설치**가 필요하다.

**지원 범위 · 낡은 엔진**
- Next.js 16 최소 엔진 = **Chrome 111 · Safari 16.4**. iOS 앱 최소 버전을 15.0 → **16.4**(`IPHONEOS_DEPLOYMENT_TARGET`). 15.x 아이폰에서는 웹이
  돌지 않아 빈 화면이 됐을 것이다. Android 는 minSdk 24(Android 7) 그대로 — 대신 **WebView 가 Chrome 111 보다 낡았으면** 업데이트 안내를 띄운다.
- 안내: `src/lib/outdated-engine-guard.ts` — 루트 레이아웃 `<head>` 맨 앞의 ES5 인라인 스크립트(Next 런타임이 못 도는 엔진에서도 실행).
  앱(Android WebView) = 「Android System WebView 를 Play 스토어에서 업데이트」 + 버튼(`market://details?id=com.google.android.webview`),
  브라우저 · PWA = 「브라우저 · OS 업데이트」. 문구 `dictionary.appShell.outdated*`(서버가 문서 언어로 골라 넣음). 판정 함수는 테스트와 실제 스크립트가 같은 코드.

**웹 · 앱 버전 어긋남**
- 앱은 배포된 웹을 띄우므로 **웹 배포는 이미 깔린 모든 앱 버전에 즉시 들어간다.** 새 웹이 옛 설치본에 없는 플러그인을 부르면 동작이 끊긴다.
- 규칙 1: 네이티브 플러그인은 **반드시 `hasNativePlugin(이름)`(`src/lib/native-app.ts`)으로 거르고, 없으면 웹 방식으로** 동작한다
  (위치 · 진동 · 공유 · 키보드 · 글자 크기 · 앱 안 브라우저 적용).
- 규칙 2: 웹 방식 대체가 불가능한 변경이면 `MIN_NATIVE_BUILD` 를 올린다 → 그보다 낮은 빌드에는 `NativeUpdateGate` 가 「Foldy 업데이트」
  화면으로 앱 전체를 덮는다(Android = Play 스토어 버튼, iOS = App Store ID 가 생기기 전까지 안내만). **올리기 전에 그 빌드가 두 스토어에 배포돼 있어야 한다.**
- 빌드 번호: Android `versionCode` · iOS `CURRENT_PROJECT_VERSION` 을 같은 숫자로 맞추고 스토어에 올릴 때마다 1씩 올린다. 지금 **2**(키보드 · 진동 · 공유 · 글자 크기 플러그인).

**앱에서 끈 것 · 고정한 것**
- **서비스 워커 끔**: 앱에서는 등록하지 않고, 예전 빌드가 남긴 것은 다음 실행 때 해제 + 캐시 삭제(`service-worker-register.tsx`). 앱은 늘 최신 배포를 띄우는데
  SW 가 배포 직후 옛 HTML 을 먼저 보여 주고, 자기 오프라인 화면을 따로 띄웠다. 오프라인은 `server.errorPath`(연결 실패 화면)가 맡는다.
- **관리 콘솔 안 열림**: `appendUserAgent: "StayOpsApp"` → 서버(`mobile-device.ts`)가 늘 모바일 화면으로 보낸다. 아이패드 앱은 Mac UA 를 보내
  첫 요청이 관리 콘솔로 갈 수 있었다. 그래서 앱에는 관리 콘솔의 엑셀 · PDF 내보내기 · 인쇄(WebView 에서 동작 안 함)가 나오지 않는다.
  모바일 화면의 내려받기는 게시판 첨부(서명 URL → 앱 안 브라우저) 하나뿐이다.

**네이티브 동작**
- 키보드(`@capacitor/keyboard`): iOS 입력칸 위 「‹ › 완료」 막대 숨김(`NativeShellBridge`). iOS `resize: None` — 웹은 Safari 처럼 visualViewport 로
  키보드를 처리하도록 맞춰져 있다(`KeyboardInsetSync`). 키보드 뒤 바탕 = 앱 바탕색(`autoBackdropColor: auto`). Android `resizeOnFullScreen` —
  edge-to-edge 에서 키보드가 입력칸을 가리는 버그 우회.
- 진동(`@capacitor/haptics`): `haptic()`(`src/lib/haptics.ts`)이 앱에서는 Taptic Engine · 시스템 진동. 호출부는 그대로. iOS 앱은 예전에 진동이 전혀 없었다.
- 공유(`@capacitor/share`): `shareLink()`(`src/lib/share-link.ts`) — 앱 = OS 공유 시트, 브라우저 = Web Share → 클립보드. Android WebView 는
  `navigator.share` 가 없어 링크 복사로만 끝났다. 쓰는 곳: 게시판 글 공유.
- 글자 크기(`@capacitor/text-zoom`): 기기 글자 크기를 따르되 **0.85~1.15 배**로 묶는다. 앱으로 돌아올 때마다 다시 맞춘다. Android WebView 는
  원래 제한 없이 따라가 큰 글씨에서 화면이 깨질 수 있었고 iOS 는 아예 무시했다.

**오류 수집**
- 외부 서비스 없이 `POST /api/client-errors` → **Vercel 런타임 로그**에 `[client-error] {json}` 한 줄. Vercel → Logs 에서 `client-error` 로 검색.
  DB 에 저장하지 않는다(보관 = Vercel 로그 보관 기간).
- 보내는 것: 출처(`error-boundary` · `global-error` · `window-error` · `unhandled-rejection`) · 메시지 · 스택(4KB) · digest · **경로만**(쿼리 제외 — 로그인 코드) ·
  플랫폼(ios · android · pwa · web) · 앱 버전 · 빌드 · 온라인 여부 · UA. **사용자 · 조직 ID 는 보내지 않는다**(개인정보 라벨 「진단, 연결 안 됨」 — `18` §3 · §4, 방침 「오류 진단 정보」).
- 오류 화면에 걸린 오류는 모든 화면에서, 잡히지 않은 오류는 앱 · 설치한 PWA 에서만(브라우저 확장 잡음 제외). 한 화면 최대 10건 · 같은 메시지 한 번.
- 오류 화면(`error.tsx` · `global-error.tsx` → `AppErrorScreen`)도 바꿨다: 예전엔 흰 바탕 영어 「Something went wrong / Try again」뿐이라, 오프라인에서
  화면을 옮기면 이 화면이 뜨고 다시 시도가 먹지 않았다(N6 「영어만 나오고 아무것도 안 눌림」의 원인으로 보임). 지금은 3개 언어 · 아이보리 ·
  오프라인이면 오프라인 안내 + 연결되면 자동 재시도 · 홈으로.

**보안 · 스토어 설정**
- Android 백업 끔: `allowBackup="false"` + `dataExtractionRules`(클라우드 · 기기 이전 모두 제외). 앱 데이터에 WebView 로그인 쿠키가 있어 다른 기기로 로그인 상태가 복원될 수 있었다.
- iOS 위치 권한 문구는 `NSLocationWhenInUseUsageDescription` 과 `NSLocationAlwaysAndWhenInUseUsageDescription` 두 키 모두(같은 문구, ko/ja/en). `@capacitor/geolocation` 이 쓰는 `ion-ios-geolocation` 이 백그라운드 위치 API 를 포함해 Apple 이 두 번째 키를 요구한다 — 없으면 업로드 처리에서 ITMS-90683(권한 문구 누락)으로 빌드가 거부된다. 앱은 사용 중 권한만 요청하므로 「항상 허용」 팝업은 뜨지 않는다(2026-10-20).
- iOS `ITSAppUsesNonExemptEncryption = false` — HTTPS 외 자체 암호화가 없다. TestFlight 업로드마다 수출 규정 질문을 받지 않는다.

### Android 릴리스 서명 (2026-10-09)

Play 에 올릴 AAB 는 **업로드 키**로 서명한다(Play App Signing 이 배포 키를 따로 관리). Play Console 계정(A3) 없이도 지금 만들어 둘 수 있다.

1. 키 만들기 — Android Studio → Build → **Generate Signed App Bundle or APK** → Android App Bundle → Key store path 「Create new…」.
   저장 위치는 **빌드 사본 밖**(예: `C:\dev\stayops-keys\stayops-upload.jks`), Alias `upload`, 유효 기간 25년 이상, 이름 · 조직에 회사 정보.
2. `C:\dev\stayops-android\android\keystore.properties` 를 만든다(저장소에는 넣지 않는다 — `android/.gitignore`, 동기화 스크립트도 지우지 않음):
   ```
   storeFile=C:/dev/stayops-keys/stayops-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```
   `android/app/build.gradle` 이 이 파일이 있으면 release 빌드를 자동으로 서명한다(없으면 서명 없이).
3. **키 파일과 비밀번호를 회사 비밀 보관소 두 곳 이상에 백업한다.** 잃어버리면 Play Console 에서 업로드 키 재설정을 요청해야 한다(며칠 걸림).
4. 릴리스 AAB: Build → Generate Signed App Bundle → release → `android/app/release/app-release.aab`. 올릴 때마다 `versionCode` +1(iOS 빌드 번호도 같이).

### iOS TestFlight 업로드 (Mac 없이, 2026-10-09)

`.github/workflows/ios-testflight.yml` — GitHub 의 macOS 러너가 서명된 앱을 만들어 App Store Connect(TestFlight)에 올린다. **수동 실행만**
(Actions → iOS TestFlight → Run workflow). 인증서 · 프로비저닝 파일은 손으로 만들지 않는다 — App Store Connect API 키로 Xcode 의
**클라우드 관리 서명**(`-allowProvisioningUpdates`)이 배포 인증서 · 프로필을 알아서 만든다.

준비(Apple Developer 가입 A2 뒤 한 번):
1. developer.apple.com → Identifiers 에 번들 ID `com.harutokyo.foldy` 등록(`capacitor.config.ts` appId 와 같은 값).
2. App Store Connect → 앱 → 새 앱(이름 Foldy, 번들 ID 위 값, SKU 아무 값) — 업로드 대상이 있어야 한다.
3. App Store Connect → Users and Access → Integrations → **App Store Connect API** → 키 생성(역할 **Admin** — 클라우드 서명에 필요) →
   `AuthKey_XXXX.p8` 내려받기(한 번만 받을 수 있다), Key ID · Issuer ID 기록.
4. GitHub 저장소 → Settings → Secrets and variables → Actions → 4개: `APPLE_TEAM_ID`(Membership 의 Team ID) · `ASC_KEY_ID` · `ASC_ISSUER_ID` ·
   `ASC_KEY_P8_BASE64`(`.p8` 파일을 base64 한 줄로 — Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))`).

- 빌드 번호 = `project.pbxproj` `CURRENT_PROJECT_VERSION`(Android `versionCode` 와 같은 값). 같은 번호는 두 번 못 올린다 — 다시 올릴 땐 두 곳을
  함께 +1 해 커밋하거나, 시험 업로드는 실행 화면의 `build_number` 칸으로 덮어쓴다.
- 시크릿이 하나라도 없으면 첫 단계에서 「Missing secrets」로 바로 멈춘다(빌드 비용 없음).
- 올린 빌드는 App Store Connect → TestFlight 에서 처리(10~30분) 후 내부 테스터에게 보인다(C8). 첫 업로드 때 「수출 규정」 질문은
  `ITSAppUsesNonExemptEncryption = false` 로 건너뛴다.

### 아이콘 · 스플래시

- **원본 = 「접힌 리넨」 로고(2026-10-09 교체)** — 라벤더(`#EFE7FF`) 바탕 위 보라 3톤 둥근 막대 세 겹. 벡터 정의가
  `scripts/dev/generate-app-icons.mjs` 안의 `BG` · `MARK` 에 있고, 돌리면 원본 SVG `public/brand/logo.svg`(바탕 포함) ·
  `logo-mark.svg`(막대만)도 같이 써 준다. 시안 20종은 디자인 캔버스에 그대로 보관(채택안 = 13 Folded Linen 원본 그대로 — 맨 아래 막대에 흰 줄(접힌 자국) 있음).
  `node scripts/dev/generate-app-icons.mjs` → `node scripts/gen-splash.mjs` 순서로 돌리면 다음을 모두 다시 만든다:
  PWA `public/icons/*`(192 · 512 둥근 네모 · maskable 512 · apple-touch 180) · `public/favicon.ico`(16/32/48),
  iOS `AppIcon`(1024, 알파 없음) · `Splash`, Android `mipmap-*`(옛 둥근 네모 · 원형 · 적응형 = 라벤더 배경 층 + 막대 72% 전경) ·
  `drawable-nodpi/splash_icon.png`(960px), 연결 실패 화면 `capacitor-www/icon.png`, 스토어 원본 `store-assets/icon-1024.png` ·
  `play-icon-512.png`, iOS PWA 시작 이미지 `public/splash/*`.
  **favicon 은 `public/favicon.ico` 하나만 둔다** — `src/app/favicon.ico` 가 있으면 Next 가 그걸 우선해서 쓴다(2026-10-15 까지
  create-next-app 기본 Vercel 삼각형이 남아 있어 브라우저 탭에 검은 삼각형이 보였다 → 지움).
  - 앱 안에서 로고를 쓰는 곳(웹 시작 화면 · 오프라인 · 404 · 오류 화면 · 관리자 사이드바 마크 · 로그인 브랜드 마크 · 자동화 아바타)은
    전부 `public/icons/icon-192.png` 를 읽으므로 따로 고칠 곳이 없다.
  - 벡터에서 바로 그리므로 1024 스토어 아이콘도 선명하다(예전 회색 문 로고는 512 를 2배로 늘린 것이었다).
  - 옛 `generate-pwa-icons.mjs`(남색 "S" 임시 마크)는 쓰지 않는다 — 돌리면 `public/icons` 를 옛 마크로 덮어쓴다.
- Android 시작 화면: `styles.xml` 의 `windowSplashScreen*` — 아이보리 바탕 + 가운데 원(아이콘 배경색 = 로고 라벤더 `#EFE7FF`) 안의 막대.
  core-splashscreen 이 Android 7~11 에도 같은 모양으로 그린다. 시작 화면 아이콘은 240dp 로 그려지므로 960px(`drawable-nodpi`).
- `drawable*/splash.png` 비트맵은 **없앴다**: 시작 테마 `android:background` 로 깔았더니 화면 비율에 맞지 않게 늘어나 로고가 잠깐 엉뚱한
  위치에 보였다(N11). 시작 테마 바탕 · WebView 바탕(`capacitor.config.ts` `backgroundColor`)은 아이보리 단색.
- **웹 시작 화면(`src/components/pwa/splash-screen.tsx`)은 앱에서 숨긴다** — `SPLIT_PANE_BOOT_SCRIPT` 앞부분이 그리기 전에
  `html[data-native-app]` 을 달고 `globals.css` 가 `[data-splash]` 를 감춘다. 겹치면 OS 시작 화면 → 웹의 작은 네모 아이콘(튀어나오는
  애니메이션)으로 로고가 순간 이동 · 흐려 보였다(N11). 브라우저 · PWA 에서는 웹 시작 화면이 그대로 뜬다.
- 아이콘 · 시작 화면을 바꾸면 `npm run cap:android:win` 후 ▶ Run(네이티브 그림이라 재설치 필요).

## 저장소 · 프로젝트 이름과 푸시 검사 (2026-10-20)

- **이름:** 깃허브 저장소 `KIMHYUNJUN95/Stay-Ops` → **`KIMHYUNJUN95/Foldy`**, Vercel 프로젝트 `stay-ops` → **`foldy`** (사용자 지시).
  깃허브는 옛 주소를 새 주소로 넘겨 주므로 옛 `origin` 으로도 push · fetch 된다(새로 받는 곳은 `https://github.com/KIMHYUNJUN95/Foldy.git`).
  **앱 주소 `stay-ops-two.vercel.app` 은 그대로** — 출시 전 새 도메인을 사면 그때 한 번에 옮긴다(바꿀 곳: `capacitor.config.ts` ·
  `.github/workflows` 의 예약 작업 5개 · Supabase pg_cron 3개 · Supabase Auth 주소 · Beds24 웹훅 · 구글 OAuth). 아래 「Initial Web Hosting」.
- **`.github/workflows/ci.yml` — 푸시마다 검사:** main 푸시 · PR 마다 `npm ci` → lint → `tsc --noEmit` → `npm test` → `npm run build`
  (Node 24, Vercel 과 같음). 비밀값 없이 공개 값 자리에 가짜 값만 넣는다 — .env 없는 깨끗한 복사본에서 끝까지 도는 것 확인.
  문서(`docs/**` · `*.md`)만 바뀐 커밋은 건너뛴다. **배포를 막지는 않는다**(Vercel 은 따로 배포) — 깨진 커밋을 몇 분 안에 알리는 용도.
- **`.github/workflows/secret-scan.yml` — 비밀값 유출 검사:** 저장소가 **공개**라 푸시 · PR 마다 gitleaks 로 새 커밋을 검사한다.
  걸리면 커밋을 되돌리는 것으로는 부족하다 — 이력에 남으므로 **그 비밀값을 바로 교체**한다. 오탐은 `.gitleaksignore` 에 지문으로,
  진짜 비밀값이 아님을 확인한 것만 넣는다. 2026-10-20 전체 이력 1,031 커밋 검사: 진짜 유출 0건 · 오탐 3건(vault 비밀값 이름 2 · 테스트용 가짜 QR 토큰 1, DB 대조 0건).

## Initial Web Hosting

Decision:

- Use Vercel for the initial internal PWA/admin web deployment.

Initial domain:

```txt
*.vercel.app
```

Later:

- Add company domain or subdomain if available.
- Consider dedicated product domain before public release.

Reason:

- Fast setup
- Free/low-cost start
- HTTPS support for PWA and Web Push requirements

## App Store 준비 (2026-10-06)

### 방향

1. **비공개 배포 먼저** — Apple Business Manager **Custom App**(조직 단위 배포) 또는 **Unlisted App**(링크로만 설치).
   거래처 · 사내 직원만 쓰는 업무 앱이라 공개 심사 부담(최소 기능 4.2 · 사용자 콘텐츠 1.2)이 작다. 다만 심사 자체는 받는다.
2. **공개 출시는 그 뒤** — 아래 「공개 출시 전」 항목을 채운 다음.
3. 앱 껍데기(네이티브 래퍼)를 무엇으로 할지는 아직 정하지 않았다. 현재 코드를 살리는 Capacitor 래핑 + 네이티브 기능(푸시 · 카메라 ·
   위치 · Apple 로그인 · 공유 시트)이 1안. **PWA-first 방향 변경이므로 결정 시 결정 로그에 남긴다.**

### 지금 갖춘 것

| 항목 | 위치 | 비고 |
| --- | --- | --- |
| 개인정보처리방침 | `/legal/privacy` | App Store Connect 「개인정보처리방침 URL」. `#security` 앵커 = 로그인 화면 「보안」 링크 |
| 이용약관 | `/legal/terms` | |
| 고객지원 | `/support` | App Store Connect 「지원 URL」. 문의 메일 = `NEXT_PUBLIC_SUPPORT_EMAIL`(비면 「관리자에게 확인」 문구) |
| 계정 삭제 안내(웹) | `/legal/account-deletion` | Google Play 「계정 삭제 URL」. 앱 안 · 웹 직접 삭제 + 로그인 불가 시 메일 요청(본인 확인 후 30일 이내). 삭제 · 잔존 항목은 `deleteAccount` 실제 동작 기준 |
| 앱 안 계정 삭제 | 계정 → 보안 → 계정 삭제 (`src/app/account/actions.ts` `deleteAccount`) | 5.1.1(v) 충족 |
| 앱 안에서 약관 · 지원 접근 | 계정 → 보안 「약관 및 지원」, 로그인 화면 하단 · 가입 폼 동의 문구 · 도움말 | |

- 세 페이지는 **로그인 없이** 열린다(미들웨어 보호 경로 밖). 언어 = `?lang=` → `stayops_locale` 쿠키 → Accept-Language.
  상단에서 한국어 · 日本語 · English 전환.
- 본문은 `src/lib/legal-content.ts`(조항 단위 ko/ja/en), 화면 크롬은 `dictionary.legal`. 공용 틀 = `src/components/legal/legal-page-shell.tsx`.
- 폰 · 폴드 · 태블릿 모두 760px 읽기 폭 한 칸(문서라 줄 길이를 넓히지 않는다).
- **본문은 실제 구현과 맞아야 한다.** 수집 항목(계정 · 근태 GPS/기기 정보 · 업무 기록 · Beds24 투숙객 정보) · 외부 처리자
  (Supabase · Vercel · Google · Beds24 · DeepL · Slack) · 삭제 동작이 바뀌면 `legal-content.ts` 와 이 절을 같이 고친다.
  App Store 개인정보 라벨도 같은 목록으로 작성한다.

### 남은 일

남은 항목 · 순서 · 담당 · 진행 상태는 **`docs/planning/17-app-release-plan.md`** 한 곳에서 관리한다(Android 포함).
