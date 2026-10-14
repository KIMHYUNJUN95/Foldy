import Link from "next/link";
import { Plus } from "lucide-react";
import { ReviewRangeChip } from "./review-range-chip";
import { RANGE_PRESET_DAYS } from "./review-list";
import { getDictionary, type Locale } from "@/lib/i18n";
import "./feedback-mobile.css";

export type FeedbackView = "manual" | "reviews" | "rooms";

/** 기간 줄 글자 — 프리셋과 맞으면 «최근 N일 · 9월 10일 – 10월 9일», 아니면 날짜만. */
export function rangeLine(locale: Locale, from: string, to: string, days: number | null): string {
  const t = getDictionary(locale).complaints;
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" });
  const span = `${fmt.format(new Date(`${from}T00:00:00Z`))} – ${fmt.format(new Date(`${to}T00:00:00Z`))}`;
  return days ? `${t.wRecentDays.replace("{n}", String(days))} · ${span}` : span;
}

/**
 * 게스트 피드백 모바일 머리 — 화이트 리디자인(2026-10-14, 시안 FB-Phone · FBManual-Phone · FBRooms-Phone).
 * 제목 · 기간 줄(누르면 공용 범위 캘린더 시트) · 「+ 컴플레인 등록」 → 보기 셋 세그(수동 컴플레인 옆 미처리 수).
 * 수동 컴플레인 보기에는 기간이 없다(오래된 미처리가 기간 밖으로 숨으면 안 된다 — PC 와 같다).
 */
export function FeedbackHead({
  locale,
  view,
  openCount,
  canCreate,
  range,
  baseParams,
}: {
  locale: Locale;
  view: FeedbackView;
  openCount: number;
  canCreate: boolean;
  range: { from: string; to: string; days: number | null } | null;
  /** 기간을 바꿀 때 유지할 쿼리(보기 · 고르기). */
  baseParams: Record<string, string>;
}) {
  const dict = getDictionary(locale);
  const t = dict.complaints;
  const tabs: { id: FeedbackView; label: string; count?: number }[] = [
    { id: "reviews", label: t.viewReviews },
    { id: "manual", label: t.viewManual, count: openCount },
    { id: "rooms", label: t.viewRooms },
  ];

  return (
    <div className="fbw fbw-head">
      <div className="fbw-head__top">
        <div className="fbw-head__tt">
          <h1>{t.pageTitle}</h1>
          {range ? (
            <ReviewRangeChip
              from={range.from}
              to={range.to}
              locale={locale}
              baseParams={baseParams}
              variant="line"
              labels={{
                chip: rangeLine(locale, range.from, range.to, range.days),
                title: t.rangeTitle,
                apply: dict.common.apply,
                clear: dict.common.clear,
                close: dict.common.close,
                previousMonth: t.rangePrevMonth,
                nextMonth: t.rangeNextMonth,
                selectStart: t.rangeHintStart,
                selectEnd: t.rangeHintEnd,
                summary: t.rangeSummary,
                presets: RANGE_PRESET_DAYS.map((days) => ({ days, label: t.rangeDays.replace("{n}", String(days)) })),
              }}
            />
          ) : null}
        </div>
        {canCreate ? (
          <Link href="/mobile/complaints/new" className="fbw-head__new">
            <Plus aria-hidden="true" />
            {t.createAction}
          </Link>
        ) : null}
      </div>
      <nav className="fbw-tabs" aria-label={t.pageTitle}>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={`/mobile/complaints?view=${tab.id}`}
            className={view === tab.id ? "on" : undefined}
            aria-current={view === tab.id ? "page" : undefined}
            scroll={false}
          >
            {tab.label}
            {tab.count ? <b>{tab.count}</b> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
