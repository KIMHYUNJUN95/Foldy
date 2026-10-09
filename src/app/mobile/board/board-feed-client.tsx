"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag, Pencil } from "lucide-react";
import { BoardTagFilter } from "@/components/board/board-tag-filter";
import { BoardListRow } from "@/components/board/board-list-row";
import { BoardEmptyState } from "@/components/board/board-empty-state";
import { loadMoreBoardPosts } from "./actions";
import type { BoardPost } from "@/components/board/board-types";
import type { Dictionary, Locale } from "@/lib/i18n";

// Locale-correct relative time via Intl (no manual strings); rendered only after hydration to avoid
// a server/client mismatch (the server has no stable "now").
function relativeTime(iso: string, locale: Locale): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.34524],
    ["month", 12],
    ["year", Infinity],
  ];
  let value = diffSec;
  for (const [unit, span] of units) {
    if (Math.abs(value) < span) return rtf.format(-Math.round(value), unit);
    value = value / span;
  }
  return rtf.format(-Math.round(value), "year");
}

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

  // Accumulated non-pinned posts loaded via "더 보기". Pinned posts always come from the server page.
  // This component is remounted (via `key` in page.tsx) on filter change, so these reset naturally.
  const [extraPosts, setExtraPosts] = useState<BoardPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // false on the server, true after client hydration — avoids a relative-time SSR mismatch without
  // a setState-in-effect.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // De-dup by id: a created_at tie at the page boundary, or a post whose pin state changed between
  // loads, could otherwise surface the same id twice and crash React with duplicate keys.
  const seen = new Set<string>();
  const allPosts = [...initialPosts, ...extraPosts].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  const pinned = allPosts.filter((p) => p.isPinned);
  const normal = allPosts.filter((p) => !p.isPinned);
  const isEmpty = allPosts.length === 0;

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

  function renderRow(post: BoardPost) {
    return (
      <Link key={post.id} href={`/mobile/board/${post.id}`} className="block">
        <BoardListRow
          id={post.id}
          title={post.title ?? post.content.slice(0, 60)}
          category={post.category}
          authorName={post.authorName}
          timeLabel={hydrated ? relativeTime(post.createdAt, locale) : ""}
          commentCount={post.commentCount}
          isPinned={post.isPinned}
          isUnread={post.isUnread}
          pinnedBadge={copy.pinnedBadge}
          unreadAria={copy.unreadAria}
        />
      </Link>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* 페이지 헤더 */}
      <div className="shrink-0 px-[18px] pb-[8px]">
        <div className="mb-[13px] flex items-center gap-[9px]">
          <h1 className="text-[22px] font-black tracking-[-0.03em] text-foreground">
            {copy.title}
          </h1>
          <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-border bg-surface px-[7px] text-[11px] font-black text-muted-foreground shadow-[0_4px_10px_-6px_rgb(122_82_230/0.25)]">
            {allPosts.length}
          </span>
          {pendingReportCount > 0 && (
            <Link
              href="/mobile/board/reports"
              className="ml-auto flex h-9 items-center gap-[5px] rounded-full border border-[rgb(197_40_46/0.35)] bg-[#fdecec] px-[12px] text-[12.5px] font-extrabold text-[#c5282e]"
            >
              <Flag className="size-[14px]" aria-hidden="true" />
              {copy.reportsChip.replace("{count}", String(pendingReportCount))}
            </Link>
          )}
          <Link
            href="/mobile/board/compose"
            className={`${pendingReportCount > 0 ? "" : "ml-auto "}flex h-9 items-center gap-[6px] rounded-full bg-primary px-[15px] text-[13.5px] font-extrabold text-white shadow-[0_10px_18px_-10px_rgb(122_82_230/0.55)]`}
          >
            <Pencil className="size-4" aria-hidden="true" />
            {copy.compose}
          </Link>
        </div>
      </div>

      {/* 태그 필터 */}
      {displayTags.length > 1 && (
        <div className="shrink-0 pb-[10px]">
          <BoardTagFilter tags={displayTags} selected={selectedTag} onSelect={onSelectTag} />
        </div>
      )}

      {/* 필터 결과 레이블 */}
      {selectedCategory && !isEmpty && (
        <div className="shrink-0 px-[18px] pb-[2px] pt-[11px] text-[11.5px] font-bold text-muted-foreground">
          <b className="text-primary">{selectedCategory}</b>{" "}
          {copy.filterResultSuffix.replace("{count}", String(allPosts.length))}
        </div>
      )}

      {/* 목록 or 빈 상태 */}
      {isEmpty ? (
        <BoardEmptyState
          title={selectedCategory ? copy.emptyFilteredTitle : copy.emptyTitle}
          subtitle={selectedCategory ? copy.emptyFilteredSubtitle : copy.emptySubtitle}
        />
      ) : (
        <div className={`px-[18px] pb-[120px] ${isPending ? "opacity-60 transition-opacity" : ""}`}>
          {pinned.map(renderRow)}
          {normal.map(renderRow)}

          {cursor && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="mt-[18px] flex h-11 w-full items-center justify-center rounded-[12px] border border-border bg-surface text-[13.5px] font-extrabold text-[#3a3746] disabled:opacity-60"
            >
              {loadingMore ? copy.loadingMore : copy.loadMore}
            </button>
          )}
          {loadError && (
            <p className="mt-[10px] text-center text-[12px] font-semibold text-[#c5282e]">
              {loadError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
