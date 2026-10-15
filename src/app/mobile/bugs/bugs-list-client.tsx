"use client";

/**
 * 버그 신고 목록 — 화이트 리디자인(2026-10-15, 시안 BugList-Phone).
 * 머리(「버그 신고」 · 「내가 보낸 신고 N건」 · 보라 「+ 신고」) → 줄(굵은 제목 / `BR-xxxx · 날짜` · 상태 색 글자 · ›) → 안내 한 줄.
 * 검토자(대표 · 사무직)는 조직 전체 신고를 보고 줄에 신고자 이름이 붙는다. 폴드는 가운데 540px, 태블릿 가로는 SplitList 목록 | 상세 칸.
 * See docs/product/25-bug-report-workflow.md 「화이트 리디자인 — 모바일」.
 */

import type { CSSProperties } from "react";
import Link from "next/link";
import { LiveWash } from "@/components/shared/live-wash";
import { bugStatusLabel, type BugCopy, type BugReport } from "@/components/bugs/bug-types";
import "@/components/bugs/bugs-white.css";

/** BR-XXXX — uuid 앞 4자리. */
export function formatBugCode(id: string): string {
  return `BR-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/** 10/14 — 도쿄 날짜. */
export function formatBugDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(iso));
}

const CHEVRON = (
  <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

type Props = {
  copy: BugCopy;
  reports: BugReport[];
  isReviewer: boolean;
};

export function BugsListClient({ copy, reports, isReviewer }: Props) {
  const w = copy.white;
  const sub = (isReviewer ? w.subAll : w.subMine).replace("{n}", String(reports.length));

  return (
    <div className="bgw">
      <header className="bgw-h">
        <div className="bgw-h__t">
          <h1>{copy.title}</h1>
          <p>{sub}</p>
        </div>
        <Link className="bgw-cta" href="/mobile/bugs/new">
          + {w.newCta}
        </Link>
      </header>

      <div className="bgw-list">
        {reports.length === 0 ? (
          <div className="bgw-empty">
            <b>{w.emptyTitle}</b>
            <span>{w.emptySub}</span>
          </div>
        ) : (
          <LiveWash move sig={reports.map((b) => `${b.id}:${b.status}`).join(",")}>
            {reports.map((bug, i) => (
              <Link
                className="bgw-row"
                data-live={`${bug.id}:${bug.status}`}
                href={`/mobile/bugs/${bug.id}`}
                key={bug.id}
                style={{ "--i": i } as CSSProperties}
              >
                <span className="bgw-row__b">
                  <span className="bgw-row__t">{bug.title}</span>
                  <span className="bgw-row__m">
                    <span className="bgw-id">{formatBugCode(bug.id)}</span> · {formatBugDay(bug.createdAt)}
                    {isReviewer && bug.reporterName ? ` · ${bug.reporterName}` : ""}
                  </span>
                </span>
                <span className="bgw-st" data-s={bug.status}>
                  {bugStatusLabel(copy, bug.status)}
                </span>
                {CHEVRON}
              </Link>
            ))}
          </LiveWash>
        )}
      </div>

      <p className="bgw-note">{w.note}</p>
    </div>
  );
}
