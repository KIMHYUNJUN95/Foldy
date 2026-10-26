"use client";

import {
  forwardRef,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";

const ITEM_H = 44; // 드럼 항목당 px
const PAD_H = ITEM_H * 2; // 위·아래 2칸 여백이 선택 행을 가운데 유지

const HOUR_ITEMS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
); // "01" … "12"
const MIN_ITEMS = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
); // "00" … "59"

function localeTag(locale: string): string {
  if (locale === "ko") return "ko-KR";
  if (locale === "ja") return "ja-JP";
  return "en-US";
}

function ampmLabels(locale: string): [string, string] {
  const formatter = new Intl.DateTimeFormat(localeTag(locale), {
    hour: "numeric",
    hour12: true,
    timeZone: "UTC",
  });
  const label = (hour: number, fallback: string) =>
    formatter
      .formatToParts(new Date(Date.UTC(2026, 0, 1, hour, 0, 0)))
      .find((part) => part.type === "dayPeriod")?.value ?? fallback;
  return [label(0, "AM"), label(12, "PM")];
}

function parseValue(value: string): {
  ampmIdx: number;
  hourIdx: number;
  minIdx: number;
} {
  if (!value) return { ampmIdx: 0, hourIdx: 8, minIdx: 0 }; // 기본값 09:00 AM
  const [hStr = "0", mStr = "0"] = value.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampmIdx = h >= 12 ? 1 : 0;
  const h12 = h % 12;
  // h12=0 → "12" 표시(HOUR_ITEMS 인덱스 11), h12=1 → "01"(인덱스 0) 등.
  const hourIdx = h12 === 0 ? 11 : h12 - 1;
  return { ampmIdx, hourIdx, minIdx: m };
}

function to24h(ampmIdx: number, hourIdx: number, minIdx: number): string {
  const h12 = hourIdx + 1; // 1-12
  let h24: number;
  if (ampmIdx === 0) {
    h24 = h12 === 12 ? 0 : h12;
  } else {
    h24 = h12 === 12 ? 12 : h12 + 12;
  }
  return `${String(h24).padStart(2, "0")}:${String(minIdx).padStart(2, "0")}`;
}

/** "HH:MM" 24시간 문자열을 표시용으로 바꾼다(예: "오전 10:30"). */
export function formatTimeDisplay(value: string, locale: string): string {
  if (!value) return "--:--";
  const [hStr = "0", mStr = "0"] = value.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const [amLabel, pmLabel] = ampmLabels(locale);
  const ampm = h >= 12 ? pmLabel : amLabel;
  const h12 = h % 12 || 12;
  return `${ampm} ${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── 드럼 열 ──────────────────────────────────────────────────────────────

type DrumColProps = {
  items: string[];
  initialIdx: number;
  onSettle: (idx: number) => void;
};

const DrumCol = forwardRef<HTMLDivElement, DrumColProps>(
  ({ items, initialIdx, onSettle }, ref) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 스냅 애니메이션을 일으키지 않고 초기 스크롤 위치를 설정한다.
    useEffect(() => {
      const el = (ref as RefObject<HTMLDivElement>).current;
      if (el) el.scrollTop = initialIdx * ITEM_H;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleScroll = useCallback(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const el = (ref as RefObject<HTMLDivElement>).current;
        if (!el) return;
        const idx = Math.max(
          0,
          Math.min(Math.round(el.scrollTop / ITEM_H), items.length - 1),
        );
        onSettle(idx);
      }, 80);
    }, [items.length, onSettle, ref]);

    return (
      <div ref={ref} className="drum" onScroll={handleScroll}>
        <div style={{ height: PAD_H }} />
        {items.map((item) => (
          <div key={item} className="drum__item">
            {item}
          </div>
        ))}
        <div style={{ height: PAD_H }} />
      </div>
    );
  },
);
DrumCol.displayName = "DrumCol";

// ─── 시트 ────────────────────────────────────────────────────────────────────

type Props = {
  /** "HH:MM" 24시간 형식, 초기값이 없으면 빈 문자열. */
  value: string;
  /** 큰 시간 표시 위에 나오는 짧은 필드 라벨. */
  label: string;
  confirmLabel: string;
  locale: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
};

export function TimePickerSheet({
  value,
  label,
  confirmLabel,
  locale,
  onConfirm,
  onClose,
}: Props) {
  const [amLabel, pmLabel] = ampmLabels(locale);
  const ampmItems = [amLabel, pmLabel];
  const init = parseValue(value);

  const [ampmIdx, setAmpmIdx] = useState(init.ampmIdx);
  const [hourIdx, setHourIdx] = useState(init.hourIdx);
  const [minIdx, setMinIdx] = useState(init.minIdx);

  const ampmRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);

  function readFinalIdx(
    r: RefObject<HTMLDivElement | null>,
    max: number,
  ): number {
    if (!r.current) return 0;
    return Math.max(
      0,
      Math.min(Math.round(r.current.scrollTop / ITEM_H), max - 1),
    );
  }

  function handleConfirm(close: () => void) {
    const ai = readFinalIdx(ampmRef, ampmItems.length);
    const hi = readFinalIdx(hourRef, HOUR_ITEMS.length);
    const mi = readFinalIdx(minRef, MIN_ITEMS.length);
    onConfirm(to24h(ai, hi, mi));
    close();
  }

  const h12Display = hourIdx + 1;
  const displayStr = `${ampmItems[ampmIdx]} ${String(h12Display).padStart(2, "0")}:${String(minIdx).padStart(2, "0")}`;

  return (
    <BottomSheet onClose={onClose}>
      {({ close }) => (
        <div className="att">
          <div className="tpick">
            <p className="tpick__label">{label}</p>
            <p className="tpick__display">{displayStr}</p>

            <div className="tpick__outer">
              {/* 선택 하이라이트 — 마스크된 열 div 안에 두지 않음 */}
              <div className="tpick__sel" aria-hidden="true" />
              <div className="tpick__cols">
                <DrumCol
                  ref={ampmRef}
                  items={ampmItems}
                  initialIdx={init.ampmIdx}
                  onSettle={setAmpmIdx}
                />
                <DrumCol
                  ref={hourRef}
                  items={HOUR_ITEMS}
                  initialIdx={init.hourIdx}
                  onSettle={setHourIdx}
                />
                <DrumCol
                  ref={minRef}
                  items={MIN_ITEMS}
                  initialIdx={init.minIdx}
                  onSettle={setMinIdx}
                />
              </div>
            </div>

            <button
              type="button"
              className="tpick__btn"
              onClick={() => handleConfirm(close)}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
