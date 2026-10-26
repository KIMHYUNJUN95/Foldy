"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";

export type LanguageOption = { code: Locale; label: string };

type LanguageSegmentedProps = {
  /** 폼 필드 이름. 숨은 input 이 값을 실어 서버 액션이 그대로 받는다. */
  name: string;
  /** 처음 선택된 로케일. */
  defaultValue: Locale;
  /** 현지화된 선택지(라벨은 사전에 있는 각 언어의 자국어 표기). */
  options: LanguageOption[];
  /** radiogroup 의 접근성 라벨. */
  ariaLabel: string;
  /** 값을 React 상태로도 추적하는 호출부를 위한 선택적 변경 훅. */
  onChange?: (value: Locale) => void;
};

/**
 * 언어 선택용 알약 형태 3택 세그먼트 토글.
 *
 * 흰색 표시자(`thumb`)가 선택지 사이를 미끄러지며 활성
 * 라벨의 너비에 맞게 크기가 바뀌어 라벨 길이가 달라도 정렬이 유지된다. 네이티브
 * `<select>` 를 대체하면서 숨은 input 으로 기존 폼/서버 액션 흐름을
 * 유지한다. 색은 프로젝트의 의미 토큰을 쓴다(청록 `--primary`, `--muted`
 * 트랙, `--surface` thumb, 비활성 텍스트는 `--muted-foreground`).
 */
export function LanguageSegmented({
  name,
  defaultValue,
  options,
  ariaLabel,
  onChange,
}: LanguageSegmentedProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<Locale>(defaultValue);
  const [thumb, setThumb] = useState<{ left: number; width: number }>({
    left: 4,
    width: 0,
  });

  // 활성 옵션을 측정해 thumb 위치를 잡는다. 값이
  // 바뀔 때와 트랙 크기가 바뀔 때(컨테이너 너비, 비동기 폰트 로드) 다시 측정해
  // 표시자가 항상 활성 라벨의 너비/위치와 맞는다.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const measure = () => {
      const idx = options.findIndex((option) => option.code === value);
      const buttons =
        wrap.querySelectorAll<HTMLButtonElement>("[data-seg-opt]");
      const el = buttons[idx];
      if (el) {
        setThumb({ left: el.offsetLeft, width: el.offsetWidth });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [value, options]);

  function select(code: Locale) {
    setValue(code);
    onChange?.(code);
  }

  return (
    <div
      ref={wrapRef}
      role="radiogroup"
      aria-label={ariaLabel}
      // `.adm` 의 `--muted` 재정의로 콘솔에서만 트랙이 시커멓게 나오던 문제는 콘솔 변수
      // 접두어화(`--adm-*`, 2026-08-03)로 해소됐다 — 토큰을 그대로 쓴다.
      className="relative flex h-12 rounded-[13px] bg-muted p-1"
    >
      <input type="hidden" name={name} value={value} />
      <span
        aria-hidden="true"
        // 위치는 `left` 가 아니라 `transform` 으로 옮긴다 — `left` 는 레이아웃 속성이라 매 프레임
        // 리플로우를 부르고, `transform` 은 컴포지터에서 끝난다. 세그먼트가 `flex-1` 이라 폭은
        // 항상 같으므로 `width` 는 트랜지션 없이 그대로 적용하면 된다(원래도 변한 적이 없다).
        // `left-0` + `translateX(offsetLeft)` 는 기존 `left: offsetLeft` 와 같은 자리다 —
        // 둘 다 위치 기준 조상의 패딩 박스가 원점이다.
        className="pointer-events-none absolute bottom-1 left-0 top-1 z-[1] rounded-[9px] bg-surface shadow-[0_2px_6px_rgba(20,40,38,0.12)] transition-transform duration-[260ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
      />
      {options.map((option) => {
        const isActive = option.code === value;
        return (
          <button
            key={option.code}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-seg-opt
            onClick={() => select(option.code)}
            className={`relative z-[2] flex flex-1 items-center justify-center text-[13.5px] transition-colors ${
              isActive
                ? "font-bold text-primary"
                : "font-semibold text-muted-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
