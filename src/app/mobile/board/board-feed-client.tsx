"use client";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { BoardTagFilter } from "@/components/board/board-tag-filter";
import { BoardListRow } from "@/components/board/board-list-row";
import { BoardEmptyState } from "@/components/board/board-empty-state";
import { boardMetaLine, boardRelativeTime } from "@/components/board/board-time";
import { loadMoreBoardPosts } from "./actions";
import type { BoardPost } from "@/components/board/board-types";
import type { Dictionary, Locale } from "@/lib/i18n";
import "@/components/board/board-white.css";

/**
 * 게시판 피드 — 화이트 리디자인(2026-10-15, 시안 Board-Phone · Board-Fold · Board-Tablet).
 * 머리(「게시판」 + 관리자에게만 빨간 「처리할 신고 n건 ›」 + 오른쪽 「+ 글쓰기」) → 글자 탭 태그 → 줄로 나눈 글 목록.
 * 고정 글이 맨 위, 그다음 최신순. 열어 본 글의 안 읽음 점은 누른 그 자리에서 줄어 사라진다(태블릿 2분할은 칸에 열린 줄을 보고).
 */
export function BoardFeedClient({
  locale,
  copy,
  initialPosts,
  initialCursor,
  tags,
  selectedCategory,
  pendingReportCount = 0,
}: {
  locale: Locale;
  copy: Dictionary["board"];
  initialPosts: BoardPost[];
  initialCursor: string | null;
  tags: string[];
  selectedCategory: string | null;
  /** owner · office_admin 에게만 0보다 크다 — 신고 처리 화면 진입(2026-10-06). */
  pendingReportCount?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // 「더 보기」로 붙인 고정 아닌 글. 고정 글은 언제나 서버 첫 페이지에서 온다. 태그를 바꾸면 page.tsx 의 `key` 로 새로 마운트된다.
  const [extraPosts, setExtraPosts] = useState<BoardPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const markOpened = (id: string) => setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // 서버에는 안정된 「지금」이 없다 — 상대 시각은 하이드레이션 뒤에만.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // 태블릿 2분할은 링크 클릭을 가로채 오른쪽 칸에 연다(onClick 까지 오지 않을 수 있음) — 칸에 열린 줄(data-split-active)을 보고 점을 지운다.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as HTMLElement;
        if (!el.hasAttribute("data-split-active")) continue;
        const id = el.closest<HTMLElement>("[data-post-id]")?.dataset.postId;
        if (id) markOpened(id);
      }
    });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-split-active"] });
    return () => observer.disconnect();
  }, []);

  // 같은 id 가 두 번 오지 않게(페이지 경계의 같은 시각 · 그사이 고정이 바뀐 글).
  const seen = new Set<string>();
  const allPosts = [...initialPosts, ...extraPosts].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  const ordered = [...allPosts.filter((p) => p.isPinned), ...allPosts.filter((p) => !p.isPinned)];
  const isEmpty = ordered.length === 0;

  const selectedTag = selectedCategory ?? copy.allTag;
  const displayTags = [copy.allTag, ...tags];

  function onSelectTag(tag: string) {
    const next = tag === copy.allTag ? "/mobile/board" : `/mobile/board?category=${encodeURIComponent(tag)}`;
    startTransition(() => router.replace(next));
  }

  async function onLoadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const result = await loadMoreBoardPosts({ category: selectedCategory, before: cursor });
      if ("posts" in result) {
        setExtraPosts((prev) => [...prev, ...result.posts]);
        setCursor(result.nextCursor);
      } else {
        setLoadError(copy.errSaveFailed);
      }
    } catch {
      setLoadError(copy.errSaveFailed);
    } finally {
      setLoadingMore(false);
    }
  }

  const rowCopy = {
    pinnedBadge: copy.pinnedBadge,
    unreadAria: copy.unreadAria,
    reactionAdd: copy.reactionAdd,
    feedFiles: copy.feedFiles,
    commentsN: copy.commentsN,
  };

  return (
    <div className="bdw" ref={rootRef}>
      <header className="bdw-head">
        <div className="bdw-head__l">
          <h1>{copy.title}</h1>
          {pendingReportCount > 0 ? (
            <Link className="bdw-head__rep num" href="/mobile/board/reports">
              {copy.reportsPending.replace("{count}", String(pendingReportCount))}
              <ChevronRight aria-hidden="true" strokeWidth={2.4} />
            </Link>
          ) : null}
        </div>
        <Link className="bdw-compose" href="/mobile/board/compose">
          <Plus aria-hidden="true" strokeWidth={2.2} />
          {copy.compose}
        </Link>
      </header>

      {displayTags.length > 1 ? (
        <BoardTagFilter
          allTag={copy.allTag}
          ariaLabel={copy.tagSection}
          onSelect={onSelectTag}
          selected={selectedTag}
          tags={displayTags}
        />
      ) : null}

      {isEmpty ? (
        <BoardEmptyState
          subtitle={selectedCategory ? copy.emptyFilteredSubtitle : copy.emptySubtitle}
          title={selectedCategory ? copy.emptyFilteredTitle : copy.emptyTitle}
        />
      ) : (
        <div className={`bdw-list${isPending ? " is-pending" : ""}`}>
          {ordered.map((post) => (
            <BoardListRow
              copy={rowCopy}
              isUnread={post.isUnread && !opened.has(post.id)}
              key={post.id}
              metaLine={boardMetaLine(post.authorRole, hydrated ? boardRelativeTime(post.createdAt, locale) : "")}
              onOpen={() => markOpened(post.id)}
              post={post}
            />
          ))}
        </div>
      )}

      {!isEmpty && cursor ? (
        <button className="bdw-more" disabled={loadingMore} onClick={onLoadMore} type="button">
          {loadingMore ? copy.loadingMore : copy.loadMore}
        </button>
      ) : null}
      {loadError ? <p className="bdw-err">{loadError}</p> : null}
    </div>
  );
}
