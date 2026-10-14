"use client";

// 게스트 피드백 모바일 — 고르기 칸(플랫폼 · 건물 · 객실). 화이트 리디자인(2026-10-14, 시안 FB-Phone).
// 회색 바탕 44px 칸 → 눌러 펼치는 목록(.ofw-dd__menu 와 같은 모양). 고르면 주소만 바꾸고 서버가 다시 그린다.
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { haptic } from "@/lib/haptics";

export type FilterOption = { label: string; href: string; on: boolean };

export function FeedbackFilterDd({
  label,
  ariaLabel,
  options,
  disabled,
  align = "left",
}: {
  label: string;
  ariaLabel: string;
  options: FilterOption[];
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`fbw-dd${open ? " is-open" : ""}`} ref={ref}>
      <button
        type="button"
        className="fbw-dd__btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${ariaLabel}: ${label}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <ul className={`fbw-dd__menu${align === "right" ? " is-right" : ""}`} id={id} aria-label={ariaLabel}>
          {options.map((option) => (
            <li key={option.href}>
              <button
                type="button"
                aria-pressed={option.on}
                className={option.on ? "on" : undefined}
                onClick={() => {
                  setOpen(false);
                  haptic("light");
                  startTransition(() => router.push(option.href, { scroll: false }));
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
