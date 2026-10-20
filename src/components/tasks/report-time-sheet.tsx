"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Dictionary } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import {
  DAY_LAST_MIN,
  QUICK_TIMES,
  durationLabel,
  earliestMinute,
  fromMinutes,
  offsetTime,
  slotOpen,
  toMinutes,
  tokyoNowMinutes,
} from "@/lib/report-schedule-time";
import { ReportTimeWheel } from "./report-time-wheel";

type Copy = Dictionary["tasks"];

/**
 * 업무일지 「보낼 시각」 시트(2026-10-20 3차, 시안 JnZtYSQ8 A) — 업무일지 시트 위에 한 장 더 뜬다.
 * 위 빠른 선택 한 줄 · 큰 시각 + 남은 시간 · 시 · 분 휠 · 「이 시각으로 정하기」. 정하기를 눌러야 반영되고, 끌어 내리거나 바깥을
 * 누르면 그대로 닫힌다(고른 값 안 바뀜). 키패드는 뜨지 않는다.
 */
export function ReportTimeSheet({
  copy,
  value,
  nowMin,
  dateLabel,
  onApply,
  onClose,
}: {
  copy: Copy;
  /** 지금 고른 시각(null = 지금 바로). */
  value: string | null;
  nowMin: number;
  dateLabel: string;
  onApply: (next: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(value);
  const earliest = earliestMinute(nowMin);
  // 지금 바로일 때 휠이 가리킬 자리 — 가장 이른 시각을 5분 단위로 올린 값.
  const resting = earliest === null ? null : fromMinutes(Math.min(DAY_LAST_MIN, Math.ceil(earliest / 5) * 5));
  const quick: { key: string; label: string; time: string | null }[] = [
    { key: "now", label: copy.reportWhenNow, time: null },
    { key: "in30", label: copy.reportWhenIn30, time: offsetTime(nowMin, 30) },
    { key: "in60", label: copy.reportWhenIn60, time: offsetTime(nowMin, 60) },
    ...QUICK_TIMES.map((t) => ({ key: t, label: t as string, time: t as string })),
  ];
  const dur = (minutes: number) =>
    durationLabel(minutes, { hm: copy.reportDurHM, h: copy.reportDurH, m: copy.reportDurM });

  return (
    <BottomSheet
      ariaLabel={copy.reportWhen}
      header={
        <div className="tkw-rpt__h">
          <h2>{copy.reportWhenAsk}</h2>
          <span>{copy.reportWhenToday.replace("{time}", "").trim()} · {dateLabel}</span>
        </div>
      }
      onClose={onClose}
      zIndexClassName="z-[90]"
    >
      {({ close }) => (
        <div className="tkw-when">
          {/* 빠른 선택 — 누르면 휠이 그 시각으로 굴러간다. 가로로 밀리는 줄이라 화면 스와이프 뒤로가기는 끈다. */}
          <div aria-label={copy.reportWhen} className="tkw-when__q" data-swipe-back="off" role="radiogroup">
            {quick.map((q) => (
              <button
                aria-checked={q.key === "now" ? draft === null : q.time !== null && draft === q.time}
                className="tkw-when__chip num"
                disabled={q.key !== "now" && (!q.time || !slotOpen(q.time, nowMin))}
                key={q.key}
                onClick={() => {
                  haptic("light");
                  setDraft(q.time);
                }}
                role="radio"
                type="button"
              >
                {q.label}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="tkw-when__rd">
            <b className="num">{draft ?? copy.reportWhenNow}</b>
            {draft ? <span>{copy.reportWhenIn.replace("{dur}", dur(Math.max(1, toMinutes(draft) - nowMin)))}</span> : null}
          </p>
          {resting ? (
            <ReportTimeWheel
              idle={draft === null}
              labels={{ group: copy.reportWhen, hour: copy.reportWhenHour, minute: copy.reportWhenMinute }}
              nowMin={nowMin}
              onChange={setDraft}
              onTick={() => haptic("light")}
              value={draft ?? resting}
            />
          ) : (
            <p className="tkw-rpt__msg">{copy.reportWhenNoSlots}</p>
          )}
          <button
            className="tkw-rpt__btn is-pri"
            onClick={() => {
              // 시트를 열어 둔 사이 시각이 지났으면 가장 이른 시각으로 맞춘다.
              const now = tokyoNowMinutes();
              const first = earliestMinute(now);
              const next = draft && !slotOpen(draft, now) ? (first === null ? null : fromMinutes(first)) : draft;
              haptic("success");
              onApply(next);
              close();
            }}
            type="button"
          >
            <Check aria-hidden="true" strokeWidth={3} />
            <span>{draft ? copy.reportWhenApply : copy.reportWhenApplyNow}</span>
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
