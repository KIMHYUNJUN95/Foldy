"use client";

/**
 * Frame 1 — Staff Suggestions main list (제안함).
 * Visual port of `frameList()` from the Feedback Box.html handoff: segmented tabs (보낸/받은/참조)
 * + status filter pills + feedback cards + FAB. Data-driven (Step 3) and fully localized (Step 8).
 * See docs/product/22-staff-suggestions-workflow.md.
 */

import { LiveWash } from "@/components/shared/live-wash";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { StaffSuggestionStatus } from "@/lib/suggestions";
import type { SuggestionListData, SuggestionListItem } from "@/lib/suggestions-queries";
import "./suggestions.css";
import { Ic, SgIcon } from "./sg-icons";
import { MobileFab } from "@/components/shell/mobile-fab";

type SgCopy = Dictionary["mobile"]["suggestions"];

const STAT_CLS: Record<StaffSuggestionStatus, string> = {
  submitted: "sub",
  reviewing: "rev",
  on_hold: "hold",
  completed: "done",
};

function StatChip({ k, copy }: { k: StaffSuggestionStatus; copy: SgCopy }) {
  return (
    <span className={`stat s-${STAT_CLS[k]}`}>
      <span className="d" />
      {copy.status[k]}
    </span>
  );
}

// Relative "x ago" via Intl (locale-correct, no manual strings). Past values use a negative delta.
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

function matchesFilter(status: StaffSuggestionStatus, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "submitted" || status === "reviewing";
  return status === filter;
}

function Card({
  f,
  segment,
  locale,
  hydrated,
  copy,
}: {
  f: SuggestionListItem;
  segment: keyof SuggestionListData;
  locale: Locale;
  hydrated: boolean;
  copy: SgCopy;
}) {
  // Show the meaningful counterparty: the recipient on Sent, the author on Received/Referenced.
  const counterparty = segment === "sent" ? f.recipientName : f.authorName;
  const counterpartyLabel = segment === "sent" ? copy.recipientLabel : copy.routeFrom;
  return (
    <Link href={`/mobile/suggestions/${f.id}`} className="fcard" data-live={f.id}>
      <div className="fcard__top">
        <StatChip k={f.status} copy={copy} />
        <span className="fcard__time">{hydrated ? relativeTime(f.createdAt, locale) : ""}</span>
      </div>
      <div className="fcard__title">{f.title}</div>
      <div className="fcard__excerpt">{f.excerpt}</div>
      <div className="fcard__foot">
        <span className="dirline">
          <span className="lbl">{counterpartyLabel}</span>
          <span className="av av--p av--sm">{(counterparty || "—").slice(0, 1)}</span>
          {counterparty || "—"}
        </span>
        <span className="fcard__meta">
          {f.referencesCount ? (
            <span className="mi">
              <Ic>{SgIcon.eye}</Ic>
              {f.referencesCount}
            </span>
          ) : null}
          {f.commentCount ? (
            <span className="mi">
              <Ic>{SgIcon.comment}</Ic>
              {f.commentCount}
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}

const SEGMENTS = ["sent", "received", "referenced"] as const;
const FILTERS: { key: string; dot: string | null }[] = [
  { key: "active", dot: null },
  { key: "all", dot: null },
  { key: "submitted", dot: "var(--sub)" },
  { key: "reviewing", dot: "var(--rev)" },
  { key: "on_hold", dot: "var(--hold)" },
  { key: "completed", dot: "var(--done)" },
];

export function SuggestionsList({
  data,
  locale,
  copy,
}: {
  data: SuggestionListData;
  locale: Locale;
  copy: SgCopy;
}) {
  const [segment, setSegment] = useState<keyof SuggestionListData>("received");
  const [filter, setFilter] = useState<string>("active");
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
  const filterLabel = (key: string) =>
    key === "active"
      ? copy.filterActive
      : key === "all"
        ? copy.filterAll
        : copy.status[key as StaffSuggestionStatus];

  const visible = useMemo(
    () => data[segment].filter((f) => matchesFilter(f.status, filter)),
    [data, segment, filter],
  );
  const countFor = (key: keyof SuggestionListData) =>
    data[key].filter((f) => matchesFilter(f.status, filter)).length;

  return (
    <div className="sg">
      <div className="scroll">
        <div className="ptitle-row">
          <h1 className="ptitle">{copy.listTitle}</h1>
        </div>
        <div className="seg">
          {SEGMENTS.map((s) => (
            <button
              key={s}
              type="button"
              className={`seg__b${segment === s ? " on" : ""}`}
              onClick={() => setSegment(s)}
            >
              {segLabel[s]} <span className="n">{countFor(s)}</span>
            </button>
          ))}
        </div>
        <div className="fbar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`fpill${filter === f.key ? " on" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.dot ? <span className="d" style={{ background: f.dot }} /> : null}
              {filterLabel(f.key)}
            </button>
          ))}
        </div>
        <div className="flist">
          {visible.length === 0 ? (
            <p
              style={{
                padding: "40px 8px",
                textAlign: "center",
                color: "var(--muted-foreground, #8a8f98)",
                fontSize: "13.5px",
                fontWeight: 600,
              }}
            >
              {copy.empty}
            </p>
          ) : (
            <LiveWash move sig={visible.map((f) => f.id).join(",")}>
              {visible.map((f) => (
                <Card key={f.id} f={f} segment={segment} locale={locale} hydrated={hydrated} copy={copy} />
              ))}
            </LiveWash>
          )}
        </div>
      </div>
      <MobileFab href="/mobile/suggestions/new" label={copy.fabLabel} />
    </div>
  );
}
