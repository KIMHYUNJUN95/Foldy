import type { Metadata } from "next";

// i18n-ignore-file: offline fallback is static and trilingual because session locale may be unavailable.

export const metadata: Metadata = {
  // 언어 중립 — 아래 스크립트가 기기 언어로 「오프라인 · Foldy」 / 「オフライン · Foldy」 / 「Offline · Foldy」 로 바꾼다.
  title: "Foldy",
};

/**
 * 연결이 돌아오면 다시 불러오기 — **React 없이 도는 맨 스크립트**(2026-10-22 N6).
 *
 * 서비스 워커는 이 화면을 **원래 가려던 주소**(예: `/mobile/calendar`)에 내보낸다. 그래서 Next 가 이 화면을 React 로 살려내지
 * 못했고(주소와 화면이 다르다), 예전 `OfflineAutoReload`(useEffect)가 한 번도 실행되지 않았다 — 인터넷이 돌아와도 앱을 껐다 켜기
 * 전까지 이 화면에 갇혔다(사용자 보고 「아무것도 안 눌림」, 로컬 재현: 온라인 복귀 6초 뒤에도 그대로). 그래서:
 * - 기기 언어(ko · ja · 그 밖 en) 한 가지만 보인다(스크립트가 못 돌면 세 언어 다). 탭 제목도 그 언어로(2026-10-23 — 전엔 한국어 고정).
 * - `online` 이벤트 + 3초마다 `/api/build` 를 두드려 닿으면 다시 불러온다(iOS 는 `online` 이벤트가 믿을 만하지 않다).
 * - 「다시 시도」 버튼 — 누르면 바로 확인하고, 닿으면 다시 불러온다.
 */
const SCRIPT = `(function(){
  var l=(navigator.language||"").toLowerCase();
  var lang=l.indexOf("ko")===0?"ko":l.indexOf("ja")===0?"ja":"en";
  document.documentElement.lang=lang;
  document.title=({ko:"오프라인 · Foldy",ja:"オフライン · Foldy",en:"Offline · Foldy"})[lang];
  var blocks=document.querySelectorAll("[data-offline-lang]");
  for(var i=0;i<blocks.length;i++){if(blocks[i].getAttribute("data-offline-lang")!==lang)blocks[i].hidden=true;}
  var busy=false;
  function check(){
    if(busy)return;busy=true;
    fetch("/api/build",{cache:"no-store"}).then(function(r){if(r.ok)location.reload();busy=false;},function(){busy=false;});
  }
  window.addEventListener("online",check);
  setInterval(check,3000);
  var btns=document.querySelectorAll("[data-offline-retry]");
  for(var j=0;j<btns.length;j++){btns[j].addEventListener("click",check);}
})();`;

const COPY = [
  { lang: "ko", title: "연결이 끊겼어요", body: "인터넷에 연결되면 자동으로 다시 불러옵니다.", retry: "다시 시도" },
  { lang: "ja", title: "オフラインです", body: "接続が戻ると自動で再読み込みします。", retry: "再試行" },
  { lang: "en", title: "You’re offline", body: "We’ll reload automatically once you’re back online.", retry: "Try again" },
];

/**
 * Offline fallback served by the service worker when a navigation fails with no network.
 * Static + self-contained (no session / data / i18n context, since it must render offline).
 * Trilingual to match the product's ko/ja/en requirement — the inline script shows only the device language.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-8 text-center text-foreground">
      {/* 실제 PWA 앱 아이콘. 예전엔 여기에 그라데이션 박스 + 이탤릭 "S" 를 그렸는데 그건 제품
          로고가 아니었다(2026-08-04). `next/image` 대신 <img> 인 이유: 이 페이지는 서비스 워커가
          네트워크 없이 캐시에서 내보내므로, 이미지 최적화 엔드포인트(/_next/image)를 탈 수 없다.
          이 경로는 SW 가 프리캐시한다(`OFFLINE_ICON`). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Foldy"
        className="size-16 rounded-[20px]"
        height={64}
        src="/icons/icon-192.png"
        width={64}
      />
      {COPY.map((copy) => (
        <div className="flex flex-col items-center gap-3" data-offline-lang={copy.lang} key={copy.lang} lang={copy.lang}>
          <h1 className="mt-2 text-[19px] font-black tracking-[-0.02em]">{copy.title}</h1>
          <p className="text-[13.5px] font-medium leading-relaxed text-muted-foreground">{copy.body}</p>
          <button
            className="mt-2 h-11 rounded-full bg-primary px-6 text-[14px] font-bold text-primary-foreground"
            data-offline-retry=""
            type="button"
          >
            {copy.retry}
          </button>
        </div>
      ))}
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </main>
  );
}
