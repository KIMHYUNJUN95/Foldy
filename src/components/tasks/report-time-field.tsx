"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fromMinutes, parsePart, partDone, stepTime, toMinutes } from "@/lib/report-schedule-time";
import { cn } from "@/lib/utils";
import "./report-time-field.css";

/**
 * 업무일지 「보낼 시각」 직접 입력 칸 — 「오늘 [17] : [37]」(2026-10-20 2차, 시안 HBVDqUS4 ① · R1dhvKv7 ①).
 * PC 업무일지 창의 작은 창과 모바일 시트가 같이 쓴다. 1분 단위.
 *
 * - **키보드:** 숫자 두 자리(또는 시 3~9 · 분 6~9 한 자리)면 다음 칸으로. ↑ ↓ = 1(Shift 분 10), Enter = `onSubmit`, 빈 분 칸에서
 *   Backspace = 시 칸으로. 칸에 들어오면 전체 선택이라 바로 덮어 친다.
 * - **마우스 · 터치:** 칸마다 ▲ ▼ — 누르면 1, 꾹 누르면 0.4초 뒤부터 계속. 칸 위 휠 = 1씩. ▲ ▼ 는 Tab 순서에서 뺀다(칸 안 ↑ ↓ 와 같은 일).
 * - 값이 없으면(지금 바로) 「--」. ▲ ▼ · 휠로 시작하면 고를 수 있는 가장 이른 시각(5분 단위 올림)부터.
 * - 지난 시각인지는 부모가 정한다(`invalid` + `describedBy` 로 오류 줄 연결). 숫자가 바뀔 때 움직임은 없다(자주 쓰는 조작).
 */
type Part = "hour" | "minute";

export type ReportTimeFieldLabels = {
  group: string;
  today: string;
  hour: string;
  minute: string;
  hourUp: string;
  hourDown: string;
  minuteUp: string;
  minuteDown: string;
};

const HOLD_DELAY_MS = 400;
const HOLD_EVERY_MS = 70;
const WHEEL_STEP_PX = 40;

export function ReportTimeField({
  value,
  onChange,
  nowMin,
  labels,
  invalid = false,
  describedBy,
  aside,
  onSubmit,
  autoFocus = false,
  size = "md",
  onStep,
}: {
  /** 「HH:MM」, 없으면 null(지금 바로). */
  value: string | null;
  onChange: (next: string) => void;
  nowMin: number;
  labels: ReportTimeFieldLabels;
  invalid?: boolean;
  describedBy?: string;
  /** 칸 오른쪽 — 「1시간 12분 뒤」. */
  aside?: ReactNode;
  /** Enter — 친 값을 확정한 뒤 그 값으로 부른다. */
  onSubmit?: (value: string | null) => void;
  autoFocus?: boolean;
  /** md = PC 작은 창, lg = 모바일 시트(▲▼ 44). */
  size?: "md" | "lg";
  /** ▲ ▼ · 휠 한 번마다(모바일 햅틱). */
  onStep?: () => void;
}) {
  // 치는 중인 글자. null 이면 value 를 보여 준다.
  const [draft, setDraft] = useState<{ hour: string; minute: string } | null>(null);
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const segRefs = { hour: useRef<HTMLDivElement>(null), minute: useRef<HTMLDivElement>(null) };
  // 휠 · 꾹 누름은 이벤트가 렌더 사이에 이어지므로 최신 값을 ref 로 본다.
  const live = useRef({ value, nowMin, onChange, onStep });
  useEffect(() => {
    live.current = { value, nowMin, onChange, onStep };
  });

  const shown = {
    hour: draft?.hour ?? (value ? value.slice(0, 2) : ""),
    minute: draft?.minute ?? (value ? value.slice(3, 5) : ""),
  };

  const step = (part: Part, delta: number) => {
    const cur = live.current;
    const next = stepTime(cur.value, part, delta, cur.nowMin);
    live.current = { ...cur, value: next };
    setDraft(null);
    cur.onChange(next);
    cur.onStep?.();
  };

  /** 친 글자를 값으로 확정. 확정한 값(또는 그대로인 값)을 돌려준다. */
  const commit = (d: { hour: string; minute: string } | null): string | null => {
    if (!d) return value;
    const baseMin = value ? toMinutes(value) : null;
    const hour = d.hour === "" ? (baseMin === null ? null : Math.floor(baseMin / 60)) : parsePart(d.hour, "hour") ?? 23;
    const minute = d.minute === "" ? (baseMin === null ? 0 : baseMin % 60) : parsePart(d.minute, "minute") ?? 59;
    setDraft(null);
    if (hour === null) return value;
    const next = fromMinutes(hour * 60 + minute);
    if (next !== value) onChange(next);
    return next;
  };

  /** 다른 칸으로 — 값이 바뀐 렌더 뒤에 선택해야 덮어 칠 수 있다(먼저 고르면 새 값이 들어오며 선택이 풀린다). */
  const jump = (to: Part) => {
    const el = to === "hour" ? hourRef.current : minuteRef.current;
    el?.focus();
    requestAnimationFrame(() => el?.select());
  };

  const type = (part: Part, raw: string) => {
    let digits = raw.replace(/\D/g, "");
    // 꽉 찬 칸 끝에 이어 치면(「00」 + 7) 새로 치는 것으로 본다.
    if (digits.length > 2) digits = digits.slice(-1);
    const next = { ...shown, ...draft, [part]: digits };
    if (!partDone(digits, part)) {
      setDraft(next);
      return;
    }
    commit(next);
    if (part === "hour") jump("minute");
  };

  const onKey = (part: Part) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (draft) commit(draft);
      step(part, (e.key === "ArrowUp" ? 1 : -1) * (part === "minute" && e.shiftKey ? 10 : 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit?.(commit(draft));
      return;
    }
    if (part === "minute" && e.key === "Backspace" && shown.minute === "") {
      e.preventDefault();
      jump("hour");
      return;
    }
    const input = e.currentTarget;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (part === "hour" && e.key === "ArrowRight" && atEnd) {
      e.preventDefault();
      jump("minute");
    } else if (part === "minute" && e.key === "ArrowLeft" && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      jump("hour");
    }
  };

  // 휠 — 칸 위에서만, 창이 같이 스크롤되지 않게 passive:false 로 건다(React onWheel 은 막을 수 없다).
  useEffect(() => {
    const cleanups = (["hour", "minute"] as const).map((part) => {
      const el = segRefs[part].current;
      if (!el) return () => {};
      let acc = 0;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        acc += e.deltaY;
        if (Math.abs(acc) < WHEEL_STEP_PX && Math.abs(e.deltaY) < WHEEL_STEP_PX) return;
        step(part, acc < 0 ? 1 : -1);
        acc = 0;
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    });
    return () => cleanups.forEach((fn) => fn());
    // step 은 live ref 로 최신 값을 본다 — 한 번만 건다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 꾹 누르면 계속.
  const hold = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const stopHold = () => {
    clearTimeout(hold.current.t);
    clearInterval(hold.current.i);
    hold.current = {};
  };
  useEffect(() => stopHold, []);

  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => {
      hourRef.current?.focus();
      hourRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  const stepper = (part: Part, dir: 1 | -1) => (
    <button
      type="button"
      tabIndex={-1}
      className="rtf__st"
      aria-label={part === "hour" ? (dir > 0 ? labels.hourUp : labels.hourDown) : dir > 0 ? labels.minuteUp : labels.minuteDown}
      // 칸의 초점을 뺏지 않는다 — 누른 뒤에도 바로 이어서 칠 수 있게.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (draft) commit(draft);
        step(part, dir);
        stopHold();
        hold.current.t = setTimeout(() => {
          hold.current.i = setInterval(() => step(part, dir), HOLD_EVERY_MS);
        }, HOLD_DELAY_MS);
      }}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onLostPointerCapture={stopHold}
      onClick={(e) => {
        // 포인터는 onPointerDown 이 이미 했다 — 보조 기술의 「누르기」(detail 0)만 여기서.
        if (e.detail === 0) step(part, dir);
      }}
    >
      {dir > 0 ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
    </button>
  );

  const seg = (part: Part) => (
    <div ref={segRefs[part]} className={cn("rtf__seg", invalid && "is-err")}>
      {stepper(part, 1)}
      <input
        ref={part === "hour" ? hourRef : minuteRef}
        className="rtf__in"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="--"
        aria-label={part === "hour" ? labels.hour : labels.minute}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={shown[part]}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => type(part, e.target.value)}
        onKeyDown={onKey(part)}
        onBlur={() => {
          // 다른 칸으로 옮길 때는 확정하지 않는다(시만 쳐 둔 상태 그대로) — 칸 밖으로 나갈 때만.
          requestAnimationFrame(() => {
            const active = document.activeElement;
            if (active !== hourRef.current && active !== minuteRef.current && draft) commit(draft);
          });
        }}
      />
      {stepper(part, -1)}
    </div>
  );

  return (
    <div className="rtf" data-size={size} role="group" aria-label={labels.group}>
      <span className="rtf__day">{labels.today}</span>
      {seg("hour")}
      <span className="rtf__colon" aria-hidden="true">
        :
      </span>
      {seg("minute")}
      {aside ? <div className="rtf__aside">{aside}</div> : null}
    </div>
  );
}
