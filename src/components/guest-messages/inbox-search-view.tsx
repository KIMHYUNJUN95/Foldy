"use client";

/**
 * 손님 메시지 검색 칸 · 결과 머리 줄 — 모바일 3폭 · PC 콘솔이 같이 쓴다(47 §5-10). 줄 모양은 각 화면이 그린다(링크 · 버튼).
 */

import { useId } from "react";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import type { InboxSearchHitRow, useInboxSearch } from "@/components/guest-messages/use-inbox-search";
import { SEARCH_MAX_CHARS } from "@/lib/guest-messages/inbox-search";

type Search = ReturnType<typeof useInboxSearch>;

export function InboxSearchBox({ search, copy }: { search: Search; copy: GmCopy }) {
  const hintId = useId();
  return (
    <div className="gm-search" role="search">
      <svg className="gm-search__ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={SEARCH_MAX_CHARS}
        value={search.input}
        placeholder={copy.searchPlaceholder}
        aria-label={copy.searchLabel}
        aria-describedby={search.tooShort ? hintId : undefined}
        onChange={(event) => search.change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            search.submit();
          } else if (event.key === "Escape" && search.input) {
            event.preventDefault();
            search.clear();
          }
        }}
      />
      {search.input ? (
        <button type="button" className="gm-search__clear" aria-label={copy.searchClear} onClick={search.clear}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      ) : null}
      {search.tooShort ? (
        <span id={hintId} className="gm-search__hint">
          {copy.searchTooShort}
        </span>
      ) : null}
    </div>
  );
}

/** 지금 그릴 결과 줄 — 새 답이 오기 전엔 앞 결과(흐리게). 아직 아무 답도 없으면 null. */
export function searchRows(search: Search): InboxSearchHitRow[] | null {
  if (search.answer?.status === "ready") return search.answer.results;
  return search.stale?.results ?? null;
}

/** 결과 머리 줄(찾는 중 · N개 · 더 있을 수 있음) + 빈 · 실패 자리. 줄이 있으면 머리 줄만. */
export function InboxSearchState({ search, copy }: { search: Search; copy: GmCopy }) {
  const answer = search.answer;
  if (answer?.status === "error") {
    return (
      <div className="gm-empty" role="alert">
        <b>{copy.searchFailed}</b>
        <span>{copy.loadFailedBody}</span>
        <button type="button" className="gm-btn" onClick={search.submit}>
          {copy.retryLoad}
        </button>
      </div>
    );
  }
  const rows = searchRows(search);
  if (!rows) {
    return (
      <p className="gm-search__status" role="status">
        {copy.searchLoading}
      </p>
    );
  }
  if (answer && rows.length === 0) {
    return (
      <div className="gm-empty" role="status">
        <b>{copy.searchEmptyTitle}</b>
        <span>{copy.searchEmptyBody}</span>
      </div>
    );
  }
  return (
    <p className="gm-search__status" role="status">
      {search.loading ? copy.searchLoading : fill(copy.searchCount, { n: rows.length })}
      {!search.loading && answer?.status === "ready" && answer.truncated ? <span>{copy.searchMore}</span> : null}
    </p>
  );
}
