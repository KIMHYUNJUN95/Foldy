"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { getDictionary } from "@/lib/i18n";
import {
  isSplitPaneMessage,
  matchesDetail,
  SPLIT_DETAIL_PATTERNS,
  SPLIT_PANE_NAME,
  TABLET_QUERY,
  type SplitDetailKey,
} from "@/lib/split-pane";

/**
 * 목록 · 상세 2분할 — 태블릿 가로(2026-10-05, Claude Design 시안 7a).
 *
 * 도메인 계약: docs/product/16-mobile-navigation.md 「목록 → 상세 2분할」 · 순수 판정 `src/lib/split-pane.ts`
 *
 * - 목록 화면을 이걸로 감싼다. **태블릿 가로에서만** 왼쪽 목록(400px, 따로 넘어감) · 오른쪽 상세 칸이 된다. 폰 · 폴드에서는
 *   아무것도 하지 않는다(감싼 내용 그대로).
 * - 목록 안의 링크가 상세 주소(`detailPattern`)면 넘어가지 않고 오른쪽 칸에 연다. 코드로 여는 곳(`router.push`)은
 *   `useSplitPush()` 를 쓴다.
 * - 칸에서 저장 · 상태 변경(서버 액션)이 끝나면 왼쪽 목록을 새로 읽는다. 칸이 상세 밖으로 가면(삭제 후 목록, 다른 화면 링크)
 *   칸을 닫고 그 주소로 이 화면을 옮긴다. 고른 줄은 남색 테두리.
 */

type SplitContextValue = { open: (href: string) => boolean };
const SplitContext = createContext<SplitContextValue | null>(null);

function subscribeTablet(listener: () => void) {
  const query = window.matchMedia(TABLET_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** 태블릿 가로인가. 서버 렌더에서는 아니다. */
export function useIsTablet(): boolean {
  return useSyncExternalStore(subscribeTablet, () => window.matchMedia(TABLET_QUERY).matches, () => false);
}

/** `router.push` 대신 — 2분할 안이면 오른쪽 칸에 열고, 아니면 그대로 이동한다. */
export function useSplitPush() {
  const context = useContext(SplitContext);
  const router = useRouter();
  return useCallback(
    (href: string) => {
      if (context?.open(href)) return;
      router.push(href);
    },
    [context, router],
  );
}

function paneSrc(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}pane=1`;
}

export function SplitList({
  children,
  detail,
}: {
  children: ReactNode;
  /** 오른쪽 칸에 열 상세 주소의 종류(`SPLIT_DETAIL_PATTERNS`). 서버 화면에서도 넘길 수 있게 이름으로 받는다. */
  detail: SplitDetailKey;
}) {
  const detailPattern = SPLIT_DETAIL_PATTERNS[detail];
  const { session } = useSession();
  const common = getDictionary(session?.user.preferredLanguage ?? "ko").common;
  const emptyText = common.splitEmpty;
  const closeLabel = common.close;
  const router = useRouter();
  const isTablet = useIsTablet();
  const [href, setHref] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const open = useCallback(
    (next: string) => {
      if (!isTablet || !matchesDetail(detailPattern, next)) return false;
      if (next !== href) setLoading(true);
      setHref(next);
      return true;
    },
    [detailPattern, href, isTablet],
  );

  // 폭이 줄어 태블릿 가로가 아니게 되면(회전 · 창 크기) 열려 있던 상세로 그대로 넘어간다 — 보던 것을 잃지 않게.
  const lastHrefRef = useRef<string | null>(null);
  useEffect(() => {
    lastHrefRef.current = href;
  }, [href]);
  useEffect(() => {
    if (isTablet || !lastHrefRef.current) return;
    const target = lastHrefRef.current;
    lastHrefRef.current = null;
    router.push(target);
  }, [isTablet, router]);

  // 칸에서 온 신호 — 바뀜이면 목록을 새로, 상세 밖으로 갔으면 칸을 닫고 이 화면을 그리로.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isSplitPaneMessage(event.data)) return;
      if (event.data.kind === "mutated") {
        router.refresh();
        return;
      }
      const path = event.data.path.replace(/([?&])pane=1(&|$)/, "$1").replace(/[?&]$/, "");
      if (matchesDetail(detailPattern, path)) return;
      setHref(null);
      if (path.split("?")[0] === window.location.pathname) router.refresh();
      else router.push(path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [detailPattern, router]);

  // 고른 줄 표시 — 목록의 그 상세 링크에 테두리(링크가 아닌 줄은 표시 없이 칸만 열린다).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = href?.split(/[?#]/)[0] ?? null;
    for (const anchor of list.querySelectorAll<HTMLAnchorElement>("a[data-split-active]")) anchor.removeAttribute("data-split-active");
    if (!target || !isTablet) return;
    for (const anchor of list.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (new URL(anchor.href).pathname === target) anchor.setAttribute("data-split-active", "");
    }
    // 고른 주소 · 폭 · 목록 내용(children)이 바뀔 때만 다시 훑는다 — 전엔 의존성 없이 칸 로딩 표시 같은 모든 다시 그림마다 링크를 전부 훑었다.
  }, [children, href, isTablet]);

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isTablet || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank") return;
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return;
    const next = `${url.pathname}${url.search}`;
    if (!matchesDetail(detailPattern, next)) return;
    event.preventDefault();
    event.stopPropagation();
    open(next);
  };

  return (
    <SplitContext.Provider value={{ open }}>
      <div className="split-list" data-split={isTablet ? "on" : undefined}>
        <div className="split-list__list" onClickCapture={onClickCapture} ref={listRef}>
          {children}
        </div>
        {isTablet && (
          <section aria-label={emptyText} className="split-list__pane">
            {href ? (
              <>
                <div className="split-list__bar">
                  {loading && <span aria-hidden="true" className="split-list__loading" />}
                  <button aria-label={closeLabel} className="split-list__close" onClick={() => setHref(null)} type="button">
                    <X aria-hidden="true" />
                  </button>
                </div>
                <iframe
                  className="split-list__frame"
                  name={SPLIT_PANE_NAME}
                  onLoad={() => setLoading(false)}
                  ref={frameRef}
                  src={paneSrc(href)}
                  title={emptyText}
                />
              </>
            ) : (
              <p className="split-list__empty">{emptyText}</p>
            )}
          </section>
        )}
      </div>
    </SplitContext.Provider>
  );
}
