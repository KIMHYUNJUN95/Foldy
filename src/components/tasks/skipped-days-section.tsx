"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { skipOccurrenceOn, unskipOccurrenceOn } from "@/app/mobile/tasks/[id]/actions";
import { TaskToast } from "@/components/tasks/task-toast";
import { haptic } from "@/lib/haptics";
import type { Dictionary, Locale } from "@/lib/i18n";
import { SKIPPED_DAYS_VISIBLE } from "@/lib/task-skipped-days";

type Copy = Dictionary["tasks"];

function dayLabel(ymd: string, locale: Locale, withWeekday: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    ...(withWeekday ? { weekday: "short" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${ymd}T00:00:00Z`));
}

/**
 * 반복 업무 상세의 「건너뛴 날」 — 최근 30일에 건너뛴 회차를 다시 살린다(2026-10-28).
 * 미리 건너뛰어 둔 앞날은 위에 「앞으로 건너뛸 날」 묶음으로 따로(가까운 날부터, 2026-10-29) — 지난 날과 섞으면 「최근 30일」이 틀려진다.
 * 건너뛰기 토스트는 몇 초 뒤 사라져서, 놓친 뒤에는 되돌릴 길이 없었다.
 * 줄은 서버를 기다리지 않고 바로 접히고(`.row-collapse`), 실패하면 다시 펴진다.
 */
export function SkippedDaysSection({
  copy,
  days,
  locale,
  taskId,
  upcomingDays = [],
}: {
  copy: Copy;
  /** 최신순 YYYY-MM-DD (서버에서 `selectRecentSkippedDays` 로 고른다). */
  days: string[];
  locale: Locale;
  taskId: string;
  /** 오늘 뒤에 미리 건너뛴 회차, 가까운 날부터(`selectUpcomingSkippedDays`). */
  upcomingDays?: string[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<
    { message: string; action?: { label: string; onAction: () => void } } | null
  >(null);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function show(next: NonNullable<typeof toast>) {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), 6000);
  }
  function setLeave(date: string, on: boolean) {
    setLeaving((cur) => {
      const next = new Set(cur);
      if (on) next.add(date);
      else next.delete(date);
      return next;
    });
  }

  function restore(date: string) {
    haptic("light");
    setLeave(date, true);
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await unskipOccurrenceOn(taskId, date)).ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        haptic("error");
        setLeave(date, false);
        show({ message: copy.errors.save_failed });
        return;
      }
      haptic("success");
      show({
        message: copy.skippedDaysRestoredToast.replace("{date}", dayLabel(date, locale, false)),
        action: { label: copy.skippedDaysSkipAgain, onAction: () => skipAgain(date) },
      });
      router.refresh();
    });
  }
  function skipAgain(date: string) {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
    startTransition(async () => {
      try {
        await skipOccurrenceOn(taskId, date);
        // 다시 건너뛴 줄은 접힘 표시를 풀어 둔다 — 새 목록이 오면 접히지 않은 채로 나온다.
        setLeave(date, false);
        router.refresh();
      } catch {
        haptic("error");
        show({ message: copy.errors.save_failed });
      }
    });
  }

  // 방금 되살린 줄(접히는 중)도 목록에 남아 있어야 접힘 움직임이 보인다 — 새 props 가 오면 사라진다.
  if (days.length === 0 && upcomingDays.length === 0 && !toast) return null;
  const hiddenCount = Math.max(0, days.length - SKIPPED_DAYS_VISIBLE);
  const shown = expanded ? days : days.slice(0, SKIPPED_DAYS_VISIBLE);

  const row = (date: string) => (
    <div className="row-collapse" data-leaving={leaving.has(date) ? "" : undefined} key={date}>
      <div className="tkw-sk__row">
        <span>{dayLabel(date, locale, true)}</span>
        <button
          aria-label={copy.skippedDaysRestoreFor.replace("{date}", dayLabel(date, locale, true))}
          className="tkw-sk__btn"
          onClick={() => restore(date)}
          type="button"
        >
          {copy.skippedDaysRestore}
        </button>
      </div>
    </div>
  );

  return (
    <section aria-label={copy.skippedDaysTitle} className="tkw-sk">
      {upcomingDays.length > 0 ? (
        <>
          <div className="tkw-sk__h">
            <b>{copy.skippedDaysUpcomingTitle}</b>
          </div>
          {upcomingDays.map(row)}
        </>
      ) : null}
      {days.length > 0 ? (
        <>
          <div className="tkw-sk__h">
            <b>{copy.skippedDaysTitle}</b>
            <span>{copy.skippedDaysRange}</span>
          </div>
          {shown.map(row)}
          {!expanded && hiddenCount > 0 ? (
            <button className="tkw-sk__btn tkw-sk__more" onClick={() => setExpanded(true)} type="button">
              {(hiddenCount === 1 ? copy.skippedDaysMoreOne : copy.skippedDaysMore).replace(
                "{count}",
                String(hiddenCount),
              )}
            </button>
          ) : null}
        </>
      ) : null}
      {toast ? (
        <TaskToast action={toast.action} message={toast.message} onDismiss={() => setToast(null)} />
      ) : null}
    </section>
  );
}
