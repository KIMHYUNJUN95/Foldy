"use client";

/**
 * 제안함 목록 — 화이트 리디자인(2026-10-15, 시안 Sugg-Phone · Sugg-Fold · Sugg-Tablet).
 * 머리(제목 · 한 줄 설명 · 「+ 쓰기」) → 글자 탭 받은 · 보낸 · 참조(개수) → 상태 칩 줄 대신 글자 하나 「진행 중만 ⌄」(누르면 공용
 * BottomSheet 에서 고름) + 옅은 요약 → 줄(상태 글자 · 보낸 → 받는 · 시간 / 굵은 제목). 데이터 · 필터 규칙은 그대로.
 * 폴드는 가운데 540px 한 줄, 태블릿 가로는 `SplitList` 목록 | 상세 칸(연 줄 옅은 보라).
 * See docs/product/22-staff-suggestions-workflow.md 「화이트 리디자인 — 모바일」.
 */

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { LiveWash } from "@/components/shared/live-wash";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { StaffSuggestionStatus } from "@/lib/suggestions";
import type { SuggestionListData, SuggestionListItem } from "@/lib/suggestions-queries";
import "./suggestions-white.css";

type SgCopy = Dictionary["mobile"]["suggestions"];
type FilterKey = "active" | "all" | StaffSuggestionStatus;

const SEGMENTS = ["received", "sent", "referenced"] as const;
const FILTERS: FilterKey[] = ["active", "all", "submitted", "reviewing", "on_hold", "completed"];

/** 2시간 전 · 어제 · 10/6 — 하루 안은 상대 시간, 그 뒤는 짧은 날짜(도쿄). */
export function suggestionWhen(iso: string, locale: Locale): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diffSec < 60) return rtf.format(0, "second");
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), "minute");
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), "hour");
  if (diffSec < 172800) return rtf.format(-1, "day");
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(iso));
}

function matchesFilter(status: StaffSuggestionStatus, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "submitted" || status === "reviewing";
  return status === filter;
}

function Row({
  f,
  segment,
  locale,
  hydrated,
  copy,
  index,
}: {
  f: SuggestionListItem;
  segment: (typeof SEGMENTS)[number];
  locale: Locale;
  hydrated: boolean;
  copy: SgCopy;
  index: number;
}) {
  const me = copy.white.meShort;
  const from = segment === "received" ? f.authorName || "—" : segment === "sent" ? me : f.authorName || "—";
  const to = segment === "sent" ? f.recipientName || "—" : segment === "received" ? me : f.recipientName || "—";
  return (
    <Link
      className="sgw-row"
      data-live={f.id}
      href={`/mobile/suggestions/${f.id}`}
      style={{ "--i": index } as CSSProperties}
    >
      <span className="sgw-meta">
        <span className="sgw-st" data-s={f.status}>
          {copy.status[f.status]}
        </span>
        <span aria-hidden="true" className="sgw-dot">
          ·
        </span>
        <span className="sgw-meta__route">
          {from} → {to}
        </span>
        <span className="sgw-meta__time">{hydrated ? suggestionWhen(f.createdAt, locale) : ""}</span>
      </span>
      <span className="sgw-row__t">{f.title}</span>
    </Link>
  );
}

const CHEVRON = (
  <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const CHECK = (
  <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24" width="18">
    <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
  </svg>
);

export function SuggestionsList({
  data,
  locale,
  copy,
}: {
  data: SuggestionListData;
  locale: Locale;
  copy: SgCopy;
}) {
  const w = copy.white;
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>("received");
  const [filter, setFilter] = useState<FilterKey>("active");
  const [sheetOpen, setSheetOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const segLabel: Record<(typeof SEGMENTS)[number], string> = {
    sent: copy.segSent,
    received: copy.segReceived,
    referenced: copy.segReferenced,
  };
  const filterLabel = (key: FilterKey) =>
    key === "active" ? copy.filterActive : key === "all" ? copy.filterAll : copy.status[key];
  const buttonLabel = filter === "all" ? copy.filterAll : w.only.replace("{label}", filterLabel(filter));

  const visible = useMemo(
    () => data[segment].filter((f) => matchesFilter(f.status, filter)),
    [data, segment, filter],
  );
  const countFor = (key: (typeof SEGMENTS)[number]) =>
    data[key].filter((f) => matchesFilter(f.status, filter)).length;
  const summary =
    filter === "active"
      ? `${copy.status.submitted} · ${copy.status.reviewing}`
      : w.countLine.replace("{n}", String(visible.length));

  return (
    <div className="sgw">
      <header className="sgw-h">
        <div className="sgw-h__t">
          <h1>{copy.listTitle}</h1>
          <p>{w.sub}</p>
        </div>
        <Link className="sgw-tbtn" href="/mobile/suggestions/new">
          + {w.write}
        </Link>
      </header>

      <div aria-label={copy.listTitle} className="sgw-tabs" role="tablist">
        {SEGMENTS.map((s) => {
          const n = countFor(s);
          return (
            <button
              aria-selected={segment === s}
              className="sgw-tab"
              key={s}
              onClick={() => setSegment(s)}
              role="tab"
              type="button"
            >
              {segLabel[s]}
              {n > 0 ? <b>{n}</b> : null}
            </button>
          );
        })}
      </div>

      <div className="sgw-filter">
        <button aria-haspopup="dialog" className="sgw-filter__b" onClick={() => setSheetOpen(true)} type="button">
          {buttonLabel}
          {CHEVRON}
        </button>
        <span className="sgw-filter__s">· {summary}</span>
      </div>

      <div className="sgw-list" key={`${segment}:${filter}`}>
        {visible.length === 0 ? (
          <div className="sgw-empty">
            <b>{w.emptyTitle}</b>
            <span>{w.emptySub}</span>
          </div>
        ) : (
          <LiveWash move sig={visible.map((f) => f.id).join(",")}>
            {visible.map((f, i) => (
              <Row copy={copy} f={f} hydrated={hydrated} index={i} key={f.id} locale={locale} segment={segment} />
            ))}
          </LiveWash>
        )}
      </div>

      {sheetOpen ? (
        <BottomSheet ariaLabel={w.filterTitle} onClose={() => setSheetOpen(false)}>
          {({ close }) => (
            <div className="sgw-fs" role="radiogroup" aria-label={w.filterTitle}>
              <div className="sgw-fs__h">
                <b>{w.filterTitle}</b>
                <span>{w.filterHint}</span>
              </div>
              {FILTERS.map((key) => {
                const on = filter === key;
                const n = data[segment].filter((f) => matchesFilter(f.status, key)).length;
                return (
                  <button
                    aria-checked={on}
                    className="sgw-fs__o"
                    key={key}
                    onClick={() => {
                      setFilter(key);
                      close();
                    }}
                    role="radio"
                    type="button"
                  >
                    <span>{filterLabel(key)}</span>
                    <em>{n}</em>
                    {on ? CHECK : <i aria-hidden="true" style={{ width: 18 }} />}
                  </button>
                );
              })}
            </div>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}
