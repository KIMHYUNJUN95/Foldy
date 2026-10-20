"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { earliestMinute, fromMinutes, minuteGone, toMinutes } from "@/lib/report-schedule-time";
import { cn } from "@/lib/utils";
import "./report-time-wheel.css";

/**
 * 업무일지 「보낼 시각」 휠 — 시 · 분 두 열(2026-10-20 3차, 시안 JnZtYSQ8 A). 모바일 시각 시트가 쓴다. 1분 단위.
 *
 * - 엄지로 굴리면 칸에 맞춰 멈춘다(scroll-snap). 한 칸 넘을 때마다 `onTick`(가벼운 진동).
 * - 지난 시 · 분은 흐린 줄긋기로 남고, 거기서 멈추면 가장 이른 시각으로 굴러 돌아간다 — 오류 문구가 필요 없다.
 * - 줄을 누르면 그 값으로 굴러간다. 열마다 role=spinbutton — ↑ ↓ 1씩, Page Up/Down 10씩(분), Home/End.
 * - 값은 부모가 쥔다(`value`). 굴리는 동안에도 바로바로 알려 줘서 위 큰 시각이 같이 바뀐다.
 */
const ROW = 44;
const SETTLE_MS = 120;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const pad = (n: number) => String(n).padStart(2, "0");

export function ReportTimeWheel({
  value,
  onChange,
  nowMin,
  labels,
  idle = false,
  onTick,
}: {
  /** 「HH:MM」 — 휠이 가리키는 시각. */
  value: string;
  onChange: (next: string) => void;
  nowMin: number;
  labels: { group: string; hour: string; minute: string };
  /** 아직 아무것도 안 고름(지금 바로) — 가운데 값을 회색으로. */
  idle?: boolean;
  onTick?: () => void;
}) {
  const min = toMinutes(value);
  const hour = Math.floor(min / 60);
  const minute = min % 60;
  const earliest = earliestMinute(nowMin);

  /** 멈췄을 때 — 지난 시각이면 가장 이른 시각으로. */
  const emit = (next: number, settled: boolean) => {
    const fixed = settled && earliest !== null && minuteGone(next, nowMin) ? earliest : next;
    const hhmm = fromMinutes(fixed);
    if (hhmm !== value) onChange(hhmm);
  };

  return (
    <div className={cn("rtw", idle && "is-idle")} role="group" aria-label={labels.group}>
      <span className="rtw__band" aria-hidden="true" />
      <Column
        index={hour}
        items={HOURS}
        gone={(h) => h * 60 + 59 < (earliest ?? 24 * 60)}
        label={labels.hour}
        onPick={(h, settled) => emit(h * 60 + minute, settled)}
        onTick={onTick}
        step={1}
      />
      <span className="rtw__colon" aria-hidden="true">
        :
      </span>
      <Column
        index={minute}
        items={MINUTES}
        gone={(m) => minuteGone(hour * 60 + m, nowMin)}
        label={labels.minute}
        onPick={(m, settled) => emit(hour * 60 + m, settled)}
        onTick={onTick}
        step={10}
      />
    </div>
  );
}

function Column({
  index,
  items,
  gone,
  label,
  onPick,
  onTick,
  step,
}: {
  index: number;
  items: number[];
  gone: (n: number) => boolean;
  label: string;
  onPick: (n: number, settled: boolean) => void;
  onTick?: () => void;
  /** Page Up / Down 한 번에 움직일 칸 수. */
  step: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 사람이 굴리는 중인가 — 부모가 값을 바꿔 휠을 굴릴 때(빠른 선택 · 지난 시각 되돌림)는 알리지 않는다.
  const user = useRef(false);
  const holding = useRef(false);
  const last = useRef(index);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  // 스크롤 이벤트는 렌더 사이에 오므로 최신 콜백을 ref 로 본다.
  const live = useRef({ onPick, onTick });
  useEffect(() => {
    live.current = { onPick, onTick };
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.round(el.scrollTop / ROW) === index) return;
    if (user.current) return;
    if (!mounted.current) {
      el.scrollTop = index * ROW;
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: index * ROW, behavior: reduce ? "auto" : "smooth" });
  }, [index]);
  useEffect(() => {
    mounted.current = true;
    return () => clearTimeout(timer.current);
  }, []);

  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (holding.current) return;
      const el = ref.current;
      if (!el || !user.current) return;
      user.current = false;
      live.current.onPick(clampIndex(Math.round(el.scrollTop / ROW), items.length), true);
    }, SETTLE_MS);
  };

  const grab = () => {
    user.current = true;
  };

  const go = (next: number) => {
    user.current = false;
    live.current.onPick(clampIndex(next, items.length), true);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      PageUp: index - step,
      PageDown: index + step,
      Home: 0,
      End: items.length - 1,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    go(map[e.key]);
  };

  return (
    <div
      ref={ref}
      className="rtw__col"
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={items[0]}
      aria-valuemax={items[items.length - 1]}
      aria-valuenow={items[index]}
      aria-valuetext={pad(items[index])}
      onKeyDown={onKey}
      onPointerDown={() => {
        grab();
        holding.current = true;
      }}
      onPointerUp={() => {
        holding.current = false;
        settle();
      }}
      onPointerCancel={() => {
        holding.current = false;
        settle();
      }}
      onTouchStart={() => {
        grab();
        holding.current = true;
      }}
      onTouchEnd={() => {
        holding.current = false;
        settle();
      }}
      onWheel={grab}
      onScroll={(e) => {
        const i = clampIndex(Math.round(e.currentTarget.scrollTop / ROW), items.length);
        if (i !== last.current) {
          last.current = i;
          if (user.current) {
            live.current.onTick?.();
            live.current.onPick(i, false);
          }
        }
        settle();
      }}
    >
      {items.map((n, i) => (
        <span
          key={n}
          aria-hidden="true"
          className={cn("rtw__item", i === index && "is-sel", gone(n) && "is-gone")}
          onClick={() => go(i)}
        >
          {pad(n)}
        </span>
      ))}
    </div>
  );
}

const clampIndex = (i: number, length: number) => Math.min(length - 1, Math.max(0, i));
