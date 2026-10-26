/* Foldy 서비스 워커.
 *
 * 목표: (1) 설치 가능한 PWA(Android 설치 프롬프트에는 fetch 핸들러가 있는 SW 가 필요),
 * (2) 친절한 오프라인 페이지, (3) 빠른 정적 자산, (4) 설치된 앱의 **즉시 콜드 런치**
 * (전체 문서 이동에 대한 stale-while-revalidate 앱 셸 캐시로 구현).
 *
 * 콜드 런치 전략(2026-07-22): 전체 문서 이동(설치된 PWA 열기 / 강제 새로고침)은
 * 마지막으로 캐시한 사본을 즉시 내려주고 백그라운드에서 다시 검증한다. 잠깐 오래된 내용을 보여주는 대신
 * 서버 렌더가 끝나길 기다리지 않고 화면이 바로 뜬다.
 * 로그인이 필요한 운영 앱이라 두 가지 안전장치를 둔다.
 *   - 성공한 same-origin 비리다이렉트 HTML 만 캐시한다. 리다이렉트(예: 로그아웃 →
 *     /auth/login)가 나오면 콘텐츠로 내려주지 않고 오래된 로그인 상태 사본을 지운다(EVICT).
 *   - 오래된 사본을 내려준 뒤 클라이언트에 메시지를 보내 페이지가 최신 서버 데이터를 가져오게 한다(router.refresh)
 *     — 재검증이 리다이렉트로 끝났다면 강제 새로고침한다. 그래서 내용은 즉시 보이고
 *     곧 최신 상태로 스스로 바로잡힌다. 실행 중인 앱 안의 클라이언트(RSC) 이동은
 *     이 핸들러가 건드리지 않으므로 앱 내 데이터는 이전처럼 실시간이다.
 *   - 이전 배포의 캐시 사본은 절대 화면에 그리지 않는다(2026-10-19): SW 가 사본의
 *     `x-foldy-build` 헤더를 `/api/build` 와 비교해 다르면 네트워크 문서를 기다린다.
 * 배포 시 이전 캐시를 무효화하려면 캐시 이름을 올린다. */
const STATIC_CACHE = "stayops-static-v5"; // v3·v4 (2026-10-09): 로고 교체 · 흰 줄 복원 — /icons 는 cache-first 라 올려야 새 아이콘이 보인다. v5 (2026-10-22): 오프라인 화면 교체(React 없이 다시 불러오기 · 다시 시도) — 저장본을 새로 받게
const NAV_CACHE = "stayops-nav-v3"; // v3 (2026-10-09): 이름 교체(Foldy) — 이름 바꾸기 전 화면 저장본(「Stay Ops」)을 버린다
const OFFLINE_URL = "/offline";
// 오프라인 화면이 쓰는 앱 아이콘. 네트워크 없이 뜨는 화면이라 **함께 프리캐시해야** 한다 —
// 런타임 캐시에만 기대면 한 번도 받은 적 없는 기기에서 깨진 이미지가 뜬다(2026-08-04).
const OFFLINE_ICON = "/icons/icon-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, OFFLINE_ICON]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, NAV_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// 캐시해도 되는 전체 문서 이동(즉시 콜드 런치용). 인증 흐름과 API/액션
// 엔드포인트는 항상 네트워크로 가야 한다(오래된 로그인 셸을 내려주지 않고,
// 로그인/리다이렉트를 앱 콘텐츠처럼 캐시하지 않기 위해).
function isCacheableNavigation(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p.startsWith("/auth") || p.startsWith("/onboarding") || p.startsWith("/api")) return false;
  return true;
}

async function offlineFallback() {
  const cache = await caches.open(STATIC_CACHE);
  return (await cache.match(OFFLINE_URL)) || Response.error();
}

/** 캐시 사본이 "방금 담은 것"으로 볼 수 있는 시간. 이 안쪽이면 새로고침 신호를 보내지 않는다. */
const NAV_FRESH_MS = 30_000;

/** 지금 배포의 이름표를 묻는 시간 한도. 넘기면(느린 망 · 오프라인) 확인을 포기하고 저장본을 그대로 내준다. */
const BUILD_CHECK_MS = 1500;

/**
 * 지금 배포의 이름표(`/api/build`, 문서 헤더 `x-foldy-build` 와 같은 값). 못 받으면 null.
 *
 * 저장본이 **옛 배포**의 화면이면 내주지 않는다(2026-10-19). 옛 화면을 먼저 그리면 곧이은 `router.refresh()` 에서
 * Next 가 빌드 차이를 보고 페이지를 통째로 다시 불러와, 진입 모션(admin-entry · app-splash)이 두 번 돌았다
 * (Edge 설치 앱에서 사용자 지적). 그 화면 안의 진입 코드도 저장 당시 버전이라 고친 동작이 첫 번째엔 안 보였다.
 */
async function liveBuild() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BUILD_CHECK_MS);
  try {
    const res = await fetch("/api/build", { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.build === "string" ? body.build : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 담은 시각을 헤더에 실어 저장한다(Response 에는 저장 시각이 남지 않는다). */
async function putNavCached(cache, req, res) {
  const body = await res.clone().blob();
  const headers = new Headers(res.headers);
  headers.set("x-so-cached-at", String(Date.now()));
  await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

/** 헤더가 없는 예전 사본은 `0` 이라 항상 stale 로 취급된다 — 안전한 쪽으로 기운다. */
function isRecentlyCached(res) {
  const at = Number(res.headers.get("x-so-cached-at") || 0);
  return at > 0 && Date.now() - at < NAV_FRESH_MS;
}

async function notifyNavRevalidated(res, requestedUrl) {
  const wins = await self.clients.matchAll({ type: "window" });
  // 리다이렉트/에러면 우리가 내준 캐시 사본이 더 이상 유효하지 않다는 뜻이라(로그아웃 등) 하드
  // 리로드를 시킨다. 그 외에는 조용히 서버 데이터만 다시 당긴다.
  //
  // **단, 최종 URL 이 요청한 URL 과 같으면 리다이렉트로 치지 않는다**(2026-08-04). 미들웨어가 세션
  // 쿠키를 갱신하며 같은 주소로 307 을 내보내는 경우가 있는데, 그걸 "다른 곳으로 가야 한다"로
  // 읽어서 `window.location.reload()` 를 걸었다 — 화면이 한 번 더 깜빡이는 원인이었다.
  const movedElsewhere = !!res && res.redirected && res.url && res.url !== requestedUrl;
  const redirected = !res || !res.ok || movedElsewhere;
  const message = { type: redirected ? "sw-nav-redirected" : "sw-nav-fresh" };
  for (const win of wins) win.postMessage(message);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 전체 문서 이동: 캐시 가능한 앱 경로는 stale-while-revalidate, 그 외에는 network-first
  // (오프라인 폴백 포함).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const url = new URL(req.url);

        if (!isCacheableNavigation(url)) {
          try {
            return await fetch(req);
          } catch {
            return offlineFallback();
          }
        }

        const navCache = await caches.open(NAV_CACHE);
        const cached = await navCache.match(req);

        const revalidate = fetch(req)
          .then(async (res) => {
            if (res.ok && !res.redirected && res.type === "basic") {
              await putNavCached(navCache, req, res);
            } else {
              // 리다이렉트(로그아웃 / 이동됨) 또는 오류 → 오래된 로그인 상태 사본을 버린다.
              await navCache.delete(req);
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          // 옛 배포의 저장본이면 그리지 않고 새 문서를 기다린다(처음 켤 때와 같음). 이름표가 없는 예전 사본도 옛 것으로 본다.
          // 이름표를 못 받으면(오프라인 · 1.5초 초과) 확인 없이 저장본 — 빨리 켜지는 쪽과 오프라인에서 열리는 쪽을 지킨다.
          // 새 문서 요청(revalidate)은 이미 출발해 있어, 같은 배포일 때 늘어나는 건 작은 이름표 요청 한 번뿐이다.
          const live = await liveBuild();
          if (live && live !== cached.headers.get("x-foldy-build")) {
            const res = await revalidate;
            return res || cached;
          }

          // 방금 담은 사본이면 굳이 화면을 새로고침하지 않는다(2026-08-04).
          //
          // 예전에는 캐시로 그린 **모든** 내비게이션마다 `router.refresh()` 를 걸었다. 앱을
          // 잠깐 백그라운드에 뒀다 돌아오거나 같은 화면을 연달아 열면, 캐시 페인트 → 새로고침
          // 재렌더로 화면이 두 번 깜빡였다. 사본이 몇십 초 안쪽이면 서버 데이터가 달라졌을 가능성이
          // 낮으므로 조용히 넘어간다 — 캐시 갱신 자체는 그대로 돌기 때문에 다음 진입은 최신이다.
          const fresh = isRecentlyCached(cached);
          event.waitUntil(
            revalidate.then((res) => {
              if (!fresh) return notifyNavRevalidated(res, req.url);
            }),
          );
          return cached;
        }

        // 아직 캐시 사본이 없음(첫 실행 / 방금 삭제됨): 네트워크를 쓰고, 실패하면 오프라인 페이지로 폴백한다.
        const res = await revalidate;
        return res || offlineFallback();
      })(),
    );
    return;
  }

  // 변하지 않는 정적 자산: cache-first (콘텐츠 해시가 붙어 있어 오래될 일이 없다).
  const url = new URL(req.url);
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons"))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});
