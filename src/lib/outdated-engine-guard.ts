/**
 * 너무 오래된 브라우저 엔진 안내 (2026-10-09, 앱 출시 준비).
 *
 * Next.js 16 이 지원하는 최소 엔진은 **Chrome 111 · Safari 16.4** 다. 그보다 낡은 엔진에서는 스크립트가 아예 돌지 않아 빈 화면이나
 * 눌리지 않는 화면이 된다 — 사용자는 이유를 모른다.
 * - Android 앱: 최소 Android 7(minSdk 24)이라 「Android System WebView」를 오래 업데이트하지 않은 폰이 걸린다 → Play 스토어에서 WebView 업데이트 안내.
 * - iOS 앱: 최소 iOS 16.4(`IPHONEOS_DEPLOYMENT_TARGET`)라 앱은 해당 없음. 브라우저 · PWA 의 옛 iOS 는 「OS 업데이트」 안내.
 *
 * React 보다 먼저, 낡은 엔진에서도 도는 **ES5 인라인 스크립트**로 판정해 화면을 덮는다(`buildOutdatedEngineScript`, 루트 레이아웃 <head>).
 * 판정 함수(`detectOutdatedEngine`)는 테스트와 실제 스크립트가 **같은 코드**를 쓰도록 문자열로 옮겨 심는다 — ES5 문법만 쓸 것.
 */

export const MIN_CHROME_MAJOR = 111;
export const MIN_IOS = [16, 4] as const;

export type OutdatedEngine = "app" | "browser" | null;

/* eslint-disable no-var -- 낡은 엔진에서 그대로 실행되는 코드라 ES5 로 쓴다 */
export function detectOutdatedEngine(ua: string, minChrome: number, minIosMajor: number, minIosMinor: number): OutdatedEngine {
  var inAndroidApp = /StayOpsApp/.test(ua) || (/Android/.test(ua) && /; wv\)/.test(ua));
  var chrome = /(?:Chrome|CriOS)\/(\d+)/.exec(ua);
  if (chrome && !/CriOS/.test(ua) && parseInt(chrome[1], 10) < minChrome) {
    return inAndroidApp && /Android/.test(ua) ? "app" : "browser";
  }
  var ios = /(?:iPhone|iPad|iPod)[^)]*? OS (\d+)_(\d+)/.exec(ua);
  if (ios) {
    var major = parseInt(ios[1], 10);
    var minor = parseInt(ios[2], 10);
    if (major < minIosMajor || (major === minIosMajor && minor < minIosMinor)) return "browser";
  }
  return null;
}
/* eslint-enable no-var */

export type OutdatedEngineCopy = {
  title: string;
  bodyApp: string;
  bodyBrowser: string;
  action: string;
};

const WEBVIEW_STORE_URL = "market://details?id=com.google.android.webview";

/** 루트 레이아웃 <head> 에 넣을 인라인 스크립트. 문구는 서버가 문서 언어로 골라 넣는다(`dictionary.appShell`). */
export function buildOutdatedEngineScript(copy: OutdatedEngineCopy): string {
  const detect = detectOutdatedEngine.toString();
  const json = JSON.stringify(copy).replace(/</g, "\\u003c");
  return `(function(){try{var kind=(${detect})(navigator.userAgent||"",${MIN_CHROME_MAJOR},${MIN_IOS[0]},${MIN_IOS[1]});if(!kind)return;var c=${json};document.documentElement.setAttribute("data-outdated-engine",kind);var show=function(){if(document.getElementById("stayops-outdated"))return;var d=document.createElement("div");d.id="stayops-outdated";d.setAttribute("role","alertdialog");d.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#ffffff;color:#16141f;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px 16px;font-family:-apple-system,system-ui,sans-serif";var w=document.createElement("div");w.style.cssText="max-width:340px;width:100%";var h=document.createElement("h1");h.style.cssText="font-size:20px;line-height:1.35;margin:0 0 10px;font-weight:700";h.textContent=c.title;var p=document.createElement("p");p.style.cssText="font-size:14px;line-height:1.6;margin:0;color:#5b6472";p.textContent=kind==="app"?c.bodyApp:c.bodyBrowser;w.appendChild(h);w.appendChild(p);if(kind==="app"){var a=document.createElement("a");a.href="${WEBVIEW_STORE_URL}";a.textContent=c.action;a.style.cssText="display:block;margin-top:24px;height:48px;line-height:48px;border-radius:14px;background:#7a52e6;color:#fff;font-size:15px;font-weight:700;text-decoration:none";w.appendChild(a)}d.appendChild(w);document.documentElement.appendChild(d)};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",show);else show()}catch(e){}})();`;
}
