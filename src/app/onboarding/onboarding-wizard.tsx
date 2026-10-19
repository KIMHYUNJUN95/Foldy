"use client";

import { FoldyMark } from "@/components/brand/foldy-mark";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import {
  joinWithInviteCode,
  previewInviteCode,
  submitOnboardingProfile,
} from "@/app/onboarding/actions";
import {
  ProfileForm,
  type ProfileFormCopy,
} from "@/app/onboarding/onboarding-forms";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Locale } from "@/lib/i18n";
import type { ProfileGender } from "@/lib/onboarding";
import { haptic } from "@/lib/haptics";
import "./onboarding-done.css";

// Navy accent gradient + shadow pulled from the design tokens (matches the auth screens).
const GRADIENT = "#7a52e6";
const SHADOW = "none";
// 흰 한 장(화이트 리디자인 2026-10-09) — 예전 아이보리 방사 그라데이션 대신.
const IVORY_BG = "#ffffff";
const PRIMARY_SOFT =
  "color-mix(in oklab, #7a52e6 8%, #ffffff)";

// Numbered steps shown in the progress bar: name → dob → phone → invite.
// (Language is intentionally not a wizard step — it's already chosen at login.)
const TOTAL_STEPS = 5;

export type OnboardingIntroCopy = {
  title: string;
  subtitle: string;
  itemBasicsTitle: string;
  itemBasicsSub: string;
  itemLangTitle: string;
  itemLangSub: string;
  itemInviteTitle: string;
  itemInviteSub: string;
  startCta: string;
};

export type OnboardingStepsCopy = {
  basicsEyebrow: string;
  continueCta: string;
  nameTitle: string;
  nameSubtitle: string;
  nameLabel: string;
  nameHint: string;
  dobTitle: string;
  dobSubtitle: string;
  dobYearLabel: string;
  dobMonthLabel: string;
  dobDayLabel: string;
  dobYearPlaceholder: string;
  dobMonthPlaceholder: string;
  dobDayPlaceholder: string;
  dobHint: string;
  dobSheetTitle: string;
  dobConfirm: string;
  genderTitle: string;
  genderSubtitle: string;
  genderLabel: string;
  genderHint: string;
  genderOptions: Record<ProfileGender, string>;
  phoneTitle: string;
  phoneSubtitle: string;
  phoneNumLabel: string;
  phoneInputPlaceholder: string;
  phoneHint: string;
  phoneCountrySheetTitle: string;
  phoneDuplicateHelp: string;
  backCta: string;
};

export type OnboardingJoinCopy = {
  inviteEyebrow: string;
  inviteTitle: string;
  inviteSubtitle: string;
  caseHint: string;
  verifyCta: string;
  checking: string;
  skip: string;
  invalidTitle: string;
  confirmEyebrow: string;
  confirmTitle: string;
  confirmSubtitle: string;
  roleLabel: string;
  verified: string;
  reviewCta: string;
  submitCta: string;
  // reused copy
  codePlaceholder: string;
  orgLabel: string;
  errors: Record<string, string>;
  roleCategories: Record<string, string>;
};

export type OnboardingReviewCopy = {
  title: string;
  subtitle: string;
  rowName: string;
  rowDob: string;
  rowGender: string;
  rowPhone: string;
  rowLang: string;
  rowOrg: string;
  rowRole: string;
  edit: string;
  infoTitle: string;
  infoBody: string;
  submit: string;
};

export type OnboardingSuccessCopy = {
  eyebrow: string;
  welcomePrefix: string;
  welcomeSuffix: string;
  bodyJoined: string;
  bodyNoTeam: string;
  startCta: string;
};

export type OnboardingExitCopy = {
  backToLogin: string;
};

type Country = { iso: string; flag: string; dial: string };
const GENDER_ORDER: ProfileGender[] = [
  "female",
  "male",
];

// Curated country codes (common for hospitality staff in Japan). Names are i18n-driven.
const COUNTRIES: Country[] = [
  { iso: "jp", flag: "🇯🇵", dial: "+81" },
  { iso: "kr", flag: "🇰🇷", dial: "+82" },
  { iso: "cn", flag: "🇨🇳", dial: "+86" },
  { iso: "tw", flag: "🇹🇼", dial: "+886" },
  { iso: "vn", flag: "🇻🇳", dial: "+84" },
  { iso: "ph", flag: "🇵🇭", dial: "+63" },
  { iso: "th", flag: "🇹🇭", dial: "+66" },
  { iso: "us", flag: "🇺🇸", dial: "+1" },
  { iso: "gb", flag: "🇬🇧", dial: "+44" },
];

const pad2 = (v: number) => String(v).padStart(2, "0");
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const daysInMonth = (year: number, month: number) =>
  new Date(year, month, 0).getDate();

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 19.5c1.3-3.3 4-4.9 7-4.9s5.7 1.6 7 4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5S14.4 18.2 12 20.5C9.6 18.2 8.4 15.2 8.4 12S9.6 5.8 12 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden="true">
      <path
        d="M12 3.8l1.9 4.5 4.5 1.9-4.5 1.9-1.9 4.5-1.9-4.5-4.5-1.9 4.5-1.9L12 3.8z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9L18 16z" fill="currentColor" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden="true">
      <path d="M4 7.5A1.5 1.5 0 015.5 6h13A1.5 1.5 0 0120 7.5V10a2 2 0 000 4v2.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 16.5V14a2 2 0 000-4V7.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 6v12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[19px]" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[19px]" aria-hidden="true">
      <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[14px]" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[15px]" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[12px]" aria-hidden="true">
      <path d="M12 3l7 2.5v5.2c0 4.5-3 8-7 10-4-2-7-5.5-7-10V5.5L12 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[17px]" aria-hidden="true">
      <path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[17px]" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Primary submit button with an in-place spinner (final join submission). */
function SpinnerButton({
  label,
  onClick,
  busy,
  disabled,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={off}
      aria-busy={busy}
      className={`relative flex h-[52px] w-full items-center justify-center rounded-[14px] text-[16px] font-semibold text-white ${
        off ? "pointer-events-none opacity-80" : ""
      }`}
      style={{ background: GRADIENT, boxShadow: off ? "none" : SHADOW }}
    >
      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="size-5 animate-spin rounded-full border-[2.4px] border-white/60 border-t-white" />
        </span>
      ) : null}
      <span className={busy ? "opacity-0" : ""}>{label}</span>
    </button>
  );
}

function ChecklistRow({
  icon,
  title,
  sub,
  divider,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  divider: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-[14px] py-[12px] ${divider ? "" : ""}`}
    >
      <span className="flex size-[44px] flex-none items-center justify-center rounded-[14px] bg-[#f4f1fd] text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-foreground">{title}</div>
        <div className="text-[13px] text-[#8b8898]">{sub}</div>
      </div>
    </div>
  );
}

/**
 * Progress header — numbered count + bar, with a back control in the left slot.
 *
 * 원래는 뒤로 버튼이 없었다(스와이프 / OS 백이 공통 패턴). 하지만 PC 에는 엣지 스와이프가 없어
 * 브라우저 뒤로가기 말고는 되돌아갈 방법이 없었다(2026-09-09). 좌측 112px 슬롯은 이미 비워져
 * 있었으므로 거기에 넣는다 — 모바일에도 함께 노출한다.
 *
 * 이동은 `history.back()` 이다. 위저드가 단계마다 `pushState` 하므로 popstate 로 이전 단계가
 * 복원되고, 브라우저 뒤로가기와 완전히 같은 경로를 탄다.
 */
function ProgressHeader({
  step,
  backLabel,
  onBack,
}: {
  step: number;
  backLabel?: string;
  onBack?: () => void;
}) {
  return (
    <header className="flex-none px-[24px] pb-[10px] pt-1">
      <div className="flex h-[48px] items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="-ml-[10px] inline-flex size-11 flex-none items-center justify-center rounded-[12px] text-foreground transition-colors hover:bg-black/[0.04]"
          >
            <ChevronLeftIcon />
          </button>
        ) : (
          <span className="-ml-[10px] size-11 flex-none" aria-hidden="true" />
        )}
        {/* 칸 나눈 진행 막대(화이트 리디자인 2026-10-09) — 지난 · 지금 단계는 보라, 남은 단계는 옅은 회색. */}
        <div className="flex flex-1 gap-[6px]" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <i
              key={i}
              className="block h-[4px] flex-1 rounded-full transition-colors duration-300"
              style={{ background: i < step ? GRADIENT : "#efeff3" }}
            />
          ))}
        </div>
        <span className="flex-none text-[13px] tabular-nums text-[#8b8898]">
          {step}/{TOTAL_STEPS}
        </span>
      </div>
    </header>
  );
}

function ExitToLoginForm({
  label,
  locale,
  compact = false,
}: {
  label: string;
  locale: Locale;
  compact?: boolean;
}) {
  return (
    <form action={signOut}>
      <input name="next" type="hidden" value={`/auth/login?lang=${locale}`} />
      <button
        type="submit"
        className={
          compact
            ? "inline-flex h-9 items-center justify-end text-right text-[12.5px] font-extrabold leading-tight text-muted-foreground underline-offset-2 hover:underline"
            : "text-[13px] font-extrabold text-muted-foreground underline-offset-2 hover:underline"
        }
      >
        {label}
      </button>
    </form>
  );
}

function StickyCta({
  label,
  onClick,
  disabled,
  withArrow,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  withArrow?: boolean;
}) {
  return (
    <div className="flex-none py-[14px] pb-[calc(max(14px,env(safe-area-inset-bottom))+var(--keyboard-inset,0px))]">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex h-[54px] w-full items-center justify-center gap-2 rounded-[15px] text-[15.5px] font-extrabold tracking-[-0.01em] text-white ${
          disabled ? "text-[#8b80ac]" : ""
        }`}
        style={{ background: disabled ? "#e6e1f5" : GRADIENT, boxShadow: "none" }}
      >
        {label}
        {withArrow && <ArrowRightIcon />}
      </button>
    </div>
  );
}

const WHEEL_H = 200;
const ITEM_H = 42;
const WHEEL_PAD = (WHEEL_H - ITEM_H) / 2;

/**
 * 스크롤 스냅 휠 컬럼 (연/월/일).
 *
 * 원래는 iOS 손가락 스크롤만 상정한 컴포넌트였다 — 항목이 클릭되지 않는 `<div>` 이고, 스크롤바는
 * 숨겨져 있고, 키보드 진입점도 없었다. PC 로 회원가입한 사용자가 "생년월일이 마우스 휠로 안 움직이고
 * 클릭으로만 된다"고 제보한 지점이다(2026-09-09). 그래서 데스크톱 입력 수단 네 가지를 명시적으로
 * 붙였다.
 *
 * - **휠**: 네이티브 스크롤에 맡기지 않고 `wheel` 을 직접 받아 칸 단위로 움직인다. 스냅 스크롤 +
 *   110ms 후 `scrollTop` 보정과 네이티브 관성 스크롤이 서로 밀어내던 문제가 사라진다. React 의
 *   `onWheel` 은 루트에 passive 로 붙어 `preventDefault` 가 먹지 않으므로 네이티브 리스너를 쓴다.
 * - **클릭**: 항목을 눌러 바로 선택.
 * - **키보드**: ↑↓ 한 칸, PageUp/PageDown 다섯 칸, Home/End 양끝, Enter 는 상위로(`onEnter`).
 * - **숫자 타이핑**: `199` → 1990 으로 점프. 연도 87개를 한 칸씩 굴리지 않아도 된다.
 *
 * 터치 스크롤은 그대로 네이티브다 — `wheel` 만 가로챈다.
 */

/** 휠 한 칸으로 치는 스크롤 거리(px). 크롬 마우스 노치 100px ≒ 두 칸. */
const WHEEL_STEP_PX = 50;
/** 한 번의 wheel 이벤트가 움직일 수 있는 최대 칸수 — 트랙패드 관성으로 튀는 것을 막는다. */
const WHEEL_MAX_STEPS = 4;

function Wheel({
  values,
  value,
  onChange,
  format,
  ariaLabel,
  autoFocus,
  onEnter,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const wheelAcc = useRef(0);
  const typeBuf = useRef("");
  const typeTimer = useRef<number | undefined>(undefined);
  const listId = useId();
  const idx = Math.max(0, values.indexOf(value));
  const [active, setActive] = useState(idx);

  const labelOf = (v: number) => (format ? format(v) : String(v));

  // Snap to the bound value on mount and whenever it changes externally (e.g. day clamp).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target;
    setActive(idx);
  }, [idx]);

  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const commit = useCallback(
    (i: number) => {
      const clamped = Math.min(values.length - 1, Math.max(0, i));
      setActive(clamped);
      const el = ref.current;
      if (el) el.scrollTop = clamped * ITEM_H;
      const next = values[clamped];
      if (next !== undefined && next !== value) onChange(next);
    },
    [onChange, value, values],
  );

  // 네이티브 wheel 리스너는 한 번만 붙이고, 최신 commit/active 는 ref 로 흘려보낸다
  // (use-sheet-drag-dismiss 와 같은 방식 — 매 렌더 재바인딩을 피한다).
  const commitRef = useRef(commit);
  const activeRef = useRef(active);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // deltaMode: 0 = px, 1 = 줄(파이어폭스), 2 = 페이지.
      const px =
        e.deltaMode === 1
          ? e.deltaY * ITEM_H
          : e.deltaMode === 2
            ? e.deltaY * WHEEL_H
            : e.deltaY;
      wheelAcc.current += px;
      const raw = Math.trunc(wheelAcc.current / WHEEL_STEP_PX);
      if (!raw) return;
      wheelAcc.current -= raw * WHEEL_STEP_PX;
      const steps = Math.max(-WHEEL_MAX_STEPS, Math.min(WHEEL_MAX_STEPS, raw));
      commitRef.current(activeRef.current + steps);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(settle.current);
      window.clearTimeout(typeTimer.current);
    },
    [],
  );

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.min(
      values.length - 1,
      Math.max(0, Math.round(el.scrollTop / ITEM_H)),
    );
    setActive(i);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const v = values[i];
      if (v !== value) onChange(v);
    }, 110);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = (delta: number) => {
      e.preventDefault();
      commit(active + delta);
    };
    if (e.key === "ArrowUp") return step(-1);
    if (e.key === "ArrowDown") return step(1);
    if (e.key === "PageUp") return step(-5);
    if (e.key === "PageDown") return step(5);
    if (e.key === "Home") {
      e.preventDefault();
      return commit(0);
    }
    if (e.key === "End") {
      e.preventDefault();
      return commit(values.length - 1);
    }
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      return onEnter();
    }
    if (!/^[0-9]$/.test(e.key)) return;

    // 숫자 타이핑 점프. 이어 친 숫자로 먼저 찾고, 없으면 방금 친 한 글자로 다시 시작한다
    // (1995 를 치다 오타가 나도 막다른 골목에 빠지지 않게).
    e.preventDefault();
    window.clearTimeout(typeTimer.current);
    typeBuf.current += e.key;
    let hit = values.findIndex((v) => labelOf(v).startsWith(typeBuf.current));
    if (hit < 0) {
      typeBuf.current = e.key;
      hit = values.findIndex((v) => labelOf(v).startsWith(typeBuf.current));
    }
    if (hit >= 0) commit(hit);
    typeTimer.current = window.setTimeout(() => {
      typeBuf.current = "";
    }, 900);
  }

  return (
    <div
      className="relative flex-1 rounded-[12px] transition-shadow focus-within:ring-[3px] focus-within:ring-primary/25"
      style={{ height: WHEEL_H }}
    >
      <div
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={`${listId}-${active}`}
        className="h-full snap-y snap-mandatory overflow-y-auto text-center outline-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          WebkitMaskImage:
            "linear-gradient(180deg, transparent, #000 32%, #000 68%, transparent)",
          maskImage:
            "linear-gradient(180deg, transparent, #000 32%, #000 68%, transparent)",
        }}
      >
        <div style={{ height: WHEEL_PAD }} />
        {values.map((v, i) => (
          <div
            key={v}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onClick={() => commit(i)}
            className={`cursor-pointer snap-center text-[17px] tabular-nums ${
              i === active
                ? "font-extrabold text-foreground"
                : Math.abs(i - active) === 1
                  ? "font-semibold text-muted-foreground"
                  : "font-semibold text-[#9a97a6]"
            }`}
            style={{ height: ITEM_H, lineHeight: `${ITEM_H}px` }}
          >
            {format ? format(v) : v}
          </div>
        ))}
        <div style={{ height: WHEEL_PAD }} />
      </div>
    </div>
  );
}

type DateParts = { year: number; month: number; day: number };

function BirthDateSheet({
  title,
  confirmLabel,
  labels,
  initial,
  onConfirm,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  /** 각 컬럼의 스크린리더 이름 — 연 / 월 / 일. */
  labels: { year: string; month: string; day: string };
  initial: DateParts;
  onConfirm: (parts: DateParts) => void;
  onClose: () => void;
}) {
  const maxYear = new Date().getFullYear();
  const years = range(1940, maxYear);
  const months = range(1, 12);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  const maxDay = daysInMonth(year, month);
  const days = range(1, maxDay);

  // Clamp the day in the year/month handlers (not an effect) when the range shrinks.
  function pickYear(y: number) {
    setYear(y);
    setDay((d) => Math.min(d, daysInMonth(y, month)));
  }
  function pickMonth(m: number) {
    setMonth(m);
    setDay((d) => Math.min(d, daysInMonth(year, m)));
  }

  return (
    <BottomSheet
      onClose={onClose}
      header={
        <p className="pb-[12px] pt-1 text-center text-[15px] font-extrabold text-foreground">
          {title}
        </p>
      }
    >
      {({ close }) => {
        // 휠에서 Enter 를 눌러도 확인으로 이어진다 — PC 에서는 여기까지 와서 마우스를 다시 잡는 게
        // 가장 번거로운 지점이다.
        const confirm = () => {
          onConfirm({ year, month, day });
          close();
        };
        return (
          <div>
            <div className="relative flex gap-[6px]" style={{ height: WHEEL_H }}>
              <div
                className="pointer-events-none absolute inset-x-0 top-1/2 h-[42px] -translate-y-1/2 rounded-[12px]"
                style={{ background: PRIMARY_SOFT }}
              />
              <Wheel
                values={years}
                value={year}
                onChange={pickYear}
                ariaLabel={labels.year}
                onEnter={confirm}
                autoFocus
              />
              <Wheel
                values={months}
                value={month}
                onChange={pickMonth}
                format={pad2}
                ariaLabel={labels.month}
                onEnter={confirm}
              />
              <Wheel
                values={days}
                value={day}
                onChange={setDay}
                format={pad2}
                ariaLabel={labels.day}
                onEnter={confirm}
              />
            </div>
            <button
              type="button"
              onClick={confirm}
              className="mt-[14px] flex h-[52px] w-full items-center justify-center rounded-[14px] text-[16px] font-semibold text-white"
              style={{ background: GRADIENT, boxShadow: SHADOW }}
            >
              {confirmLabel}
            </button>
          </div>
        );
      }}
    </BottomSheet>
  );
}

function DateCell({
  label,
  value,
  placeholder,
  grow,
  onClick,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  grow?: boolean;
  onClick: () => void;
}) {
  return (
    <div className={grow ? "flex-[1.4]" : "flex-1"}>
      <div className="mb-[6px] text-center text-[11px] font-extrabold uppercase tracking-[0.05em] t-eyebrow text-[#9a97a6]">
        {label}
      </div>
      <button
        type="button"
        onClick={onClick}
        className="h-[54px] w-full rounded-[14px] border border-border bg-surface text-center text-[16px] font-semibold text-foreground"
      >
        {value ?? (
          <span className="font-medium text-[#9a97a6]">{placeholder}</span>
        )}
      </button>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  editLabel,
  onEdit,
  divider,
}: {
  label: string;
  value: string;
  editLabel: string;
  onEdit?: () => void;
  divider: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-[14px] ${
        divider ? "border-t border-[#f1f1f4]" : ""
      }`}
    >
      <span className="w-[78px] flex-none text-[12px] font-bold text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-foreground">
        {value}
      </span>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="flex-none text-[12px] font-extrabold text-primary"
        >
          {editLabel}
        </button>
      )}
    </div>
  );
}

function GenderChoice({
  selected,
  label,
  active,
  onClick,
}: {
  selected: boolean;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex min-h-[84px] items-start justify-between rounded-[16px] px-[18px] py-[16px] text-left transition-colors ${
        active ? "bg-[#f1ecfd]" : "bg-[#f7f7f9] hover:bg-[#f4f4f7]"
      }`}
    >
      <div>
        <div className="text-[14.5px] font-extrabold tracking-[-0.01em] text-foreground">
          {label}
        </div>
      </div>
      <span
        className={`mt-[2px] flex size-6 items-center justify-center rounded-full border transition-colors ${
          active
            ? "border-[#7a52e6] bg-[#7a52e6] text-white"
            : "border-[#d0cfd8] bg-white text-transparent"
        }`}
        aria-hidden="true"
      >
        {selected ? <CheckIcon /> : null}
      </span>
    </button>
  );
}

function CountrySheet({
  title,
  countryNames,
  selectedIso,
  onSelect,
  onClose,
}: {
  title: string;
  countryNames: Record<string, string>;
  selectedIso: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      onClose={onClose}
      className="max-h-[72dvh]"
      header={
        <p className="pb-[12px] pt-1 text-center text-[15px] font-extrabold text-foreground">
          {title}
        </p>
      }
    >
      {({ close }) => (
        <div className="-mx-1 max-h-[58dvh] overflow-y-auto px-1">
          {COUNTRIES.map((c) => {
            const on = c.iso === selectedIso;
            return (
              <button
                key={c.iso}
                type="button"
                onClick={() => {
                  onSelect(c.iso);
                  close();
                }}
                className={`flex w-full items-center gap-3 rounded-[13px] px-3 py-[13px] text-left ${
                  on ? "bg-primary/[0.08]" : ""
                }`}
              >
                <span className="text-[22px] leading-none">{c.flag}</span>
                <span className="flex-1 text-[15px] font-bold text-foreground">
                  {countryNames[c.iso] ?? c.iso.toUpperCase()}
                </span>
                <span className="font-mono text-[14px] font-bold tabular-nums text-muted-foreground">
                  {c.dial}
                </span>
                {on && (
                  <span className="text-primary">
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * Multi-step onboarding wizard (redesign — Profile Setup handoff).
 *
 * Implemented screens: 0 intro · 1 name · 2 date of birth (wheel picker). Advancing
 * past dob reveals the existing profile form (with name + birth date carried forward)
 * so the flow stays fully functional while the remaining steps are redesigned.
 *
 * Back navigation uses the browser history (push/popstate) so OS / edge-swipe back
 * moves to the previous step — no in-screen back button (shared navigation pattern).
 */
export function OnboardingWizard({
  intro,
  steps,
  countries,
  join,
  review,
  success,
  exit,
  languageName,
  profile,
  initialStep = 0,
  allowInviteSkip = true,
  showExitToLogin = false,
}: {
  intro: OnboardingIntroCopy;
  steps: OnboardingStepsCopy;
  countries: Record<string, string>;
  join: OnboardingJoinCopy;
  review: OnboardingReviewCopy;
  success: OnboardingSuccessCopy;
  exit: OnboardingExitCopy;
  languageName: string;
  profile: {
    copy: ProfileFormCopy;
    locale: Locale;
    safeNext: string;
    initialName?: string;
    initialBirthDate?: string;
    initialGender?: ProfileGender | "";
    initialPhone?: string;
  };
  initialStep?: number;
  allowInviteSkip?: boolean;
  showExitToLogin?: boolean;
}) {
  const initialPhoneDigits = profile.initialPhone
    ? profile.initialPhone.replace(/\D/g, "")
    : "";
  const inferredCountry =
    COUNTRIES.find((c) => {
      const dialDigits = c.dial.replace(/\D/g, "");
      return (
        initialPhoneDigits.startsWith(dialDigits) &&
        initialPhoneDigits.length > dialDigits.length
      );
    }) ?? COUNTRIES[0];
  const initialNationalDigits = profile.initialPhone
    ? initialPhoneDigits.slice(inferredCountry.dial.replace(/\D/g, "").length)
    : "";
  const [step, setStep] = useState(initialStep);
  // 완료 화면에서 체크가 그려질 때 성공 진동 한 번(2026-10-14 모션).
  useEffect(() => {
    if (step !== 8) return;
    const id = window.setTimeout(() => haptic("success"), 450);
    return () => window.clearTimeout(id);
  }, [step]);
  const [depth, setDepth] = useState(0);
  const [name, setName] = useState(profile.initialName ?? "");
  const [dob, setDob] = useState<DateParts | null>(() => {
    const birth = profile.initialBirthDate?.trim();
    if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
    const [y, m, d] = birth.split("-").map(Number);
    if (!y || !m || !d) return null;
    return { year: y, month: m, day: d };
  });
  const [dobSheet, setDobSheet] = useState(false);
  const [gender, setGender] = useState<ProfileGender | "">(profile.initialGender ?? "");
  const [countryIso, setCountryIso] = useState(inferredCountry.iso);
  const [phone, setPhone] = useState(initialNationalDigits);
  const [countrySheet, setCountrySheet] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "verifying" | "error"
  >("idle");
  const [inviteErrorKey, setInviteErrorKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    organizationName: string;
    roleCategory: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErrorKey, setSubmitErrorKey] = useState<string | null>(null);
  const [phoneErrorKey, setPhoneErrorKey] = useState<string | null>(null);
  const [dest, setDest] = useState("/mobile");

  async function submit() {
    setSubmitting(true);
    setSubmitErrorKey(null);
    // try 안의 삼항은 React Compiler 가 컴포넌트째 건너뛰는 원인 — 밖에서 계산한다.
    const code = preview ? inviteCode.trim() : "";
    let result: Awaited<ReturnType<typeof submitOnboardingProfile>>;
    try {
      result = await submitOnboardingProfile({
        name: name.trim(),
        birthDate,
        gender,
        phoneNumber: phoneE164,
        preferredLanguage: profile.locale,
        inviteCode: code,
        next: profile.safeNext,
      });
    } catch {
      setSubmitErrorKey("network_error");
      setSubmitting(false);
      return;
    }
    if (result.ok) {
      setDest(result.redirectTo);
      setSubmitting(false);
      goTo(8);
      return;
    }
    if (result.errorKey === "phone_duplicate" || result.errorKey === "phone_invalid") {
      setPhoneErrorKey(result.errorKey);
      setSubmitting(false);
      goTo(4);
      return;
    }
    setSubmitErrorKey(result.errorKey);
    setSubmitting(false);
  }

  async function submitMembership() {
    setSubmitting(true);
    setSubmitErrorKey(null);
    try {
      const result = await joinWithInviteCode({
        inviteCode: inviteCode.trim(),
        next: profile.safeNext,
      });
      if (result.ok) {
        setDest(result.redirectTo);
        setSubmitting(false);
        goTo(8);
      } else {
        setSubmitErrorKey(result.errorKey);
        setSubmitting(false);
      }
    } catch {
      setSubmitErrorKey("network_error");
      setSubmitting(false);
    }
  }

  async function verifyInvite() {
    const trimmed = inviteCode.trim();
    if (!trimmed) return;
    setInviteStatus("verifying");
    setInviteErrorKey(null);
    try {
      const result = await previewInviteCode(trimmed);
      if (result.ok) {
        setPreview({
          organizationName: result.organizationName,
          roleCategory: result.roleCategory,
        });
        setInviteStatus("idle");
        goTo(6);
      } else {
        setPreview(null);
        setInviteErrorKey(result.errorKey);
        setInviteStatus("error");
      }
    } catch {
      setPreview(null);
      setInviteErrorKey("network_error");
      setInviteStatus("error");
    }
  }

  // 히스토리 깊이를 state 에 함께 실어 둔다. 뒤로 버튼은 **위저드 안에 돌아갈 단계가 있을 때만**
  // 보여야 한다 — 깊이 0(진입 지점)에서 뒤로를 누르면 앱을 벗어나 이전 사이트로 나가버린다.
  // 재가입(`initialStep = 5`)처럼 중간에서 시작하는 경우가 있어 step 값만으로는 판단할 수 없다.
  useEffect(() => {
    window.history.replaceState({ obStep: initialStep, obDepth: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      const s =
        e.state && typeof e.state.obStep === "number" ? e.state.obStep : initialStep;
      setStep(s);
      setDepth(e.state && typeof e.state.obDepth === "number" ? e.state.obDepth : 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialStep]);

  function goTo(next: number) {
    const nextDepth = depth + 1;
    window.history.pushState({ obStep: next, obDepth: nextDepth }, "");
    setDepth(nextDepth);
    setStep(next);
  }

  function goBack() {
    window.history.back();
  }

  const birthDate = dob ? `${dob.year}-${pad2(dob.month)}-${pad2(dob.day)}` : "";

  const selectedCountry =
    COUNTRIES.find((c) => c.iso === countryIso) ?? COUNTRIES[0];
  // E.164: country dial code + national number with the leading trunk "0" stripped.
  const nationalDigits = phone.replace(/\D/g, "").replace(/^0+/, "");
  const phoneE164 = nationalDigits
    ? `${selectedCountry.dial}${nationalDigits}`
    : "";
  const phoneValid = nationalDigits.length >= 6;
  const showExitLink = showExitToLogin;
  const exitAction = showExitLink ? (
    <ExitToLoginForm label={exit.backToLogin} locale={profile.locale} compact />
  ) : null;

  // ── Fallback · existing all-in-one profile form (unreachable in the normal flow) ─
  if (step >= 9) {
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={5} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto w-full max-w-[460px] flex-1 px-[26px] pb-[max(26px,env(safe-area-inset-bottom))]">
          <ProfileForm
            copy={profile.copy}
            locale={profile.locale}
            safeNext={profile.safeNext}
            defaultName={name.trim()}
            defaultBirthDate={birthDate}
            defaultGender={gender}
            defaultPhone={phoneE164}
          />
        </section>
      </main>
    );
  }

  // ── Step 7 · Success / welcome ───────────────────────────────────────────────
  if (step === 8) {
    const roleLabel = preview
      ? join.roleCategories[preview.roleCategory] ?? preview.roleCategory
      : "";
    const body = preview
      ? success.bodyJoined
          .replace("{org}", preview.organizationName)
          .replace("{role}", roleLabel)
      : success.bodyNoTeam;
    // 모션(2026-10-14, 시안 Motion-B-OnbDone-Phone): 빛 번짐 위로 체크 원이 튀어나오고 방사선 8개 · 체크 그리기 → 글이 폭포처럼 →
    // 조직 이름에 빛이 지나감 → 버튼이 올라오며 반짝 한 번. 빛 알갱이가 천천히 떠오름. 체크가 그려질 때 성공 진동(onboarding-done.css).
    const orgName = preview?.organizationName ?? "";
    const bodyParts = orgName && body.includes(orgName) ? body.split(orgName) : null;
    return (
      <main
        lang={profile.locale}
        className="obd flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <header className="h-[48px] flex-none" />
        <span className="obd__dust" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ "--x": `${Math.round(Math.cos(i * 2.39996) * 130)}px`, animationDelay: `${900 + i * 90}ms` } as React.CSSProperties} />
          ))}
        </span>
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="obd__ic mb-6" aria-hidden="true">
              <span className="obd__glow" />
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="obd__ray" style={{ "--r": `${i * 45}deg` } as React.CSSProperties} />
              ))}
              <span className="obd__dot">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </span>
            <span className="obd__ln">
              <span className="mb-[9px] inline-block text-[11px] font-extrabold uppercase tracking-[0.13em] t-eyebrow text-primary">{success.eyebrow}</span>
            </span>
            <h1 className="obd__ln obd__d2 whitespace-pre-line text-[32px] font-bold leading-[1.25] tracking-[-0.035em] t-display">
              <span className="inline-block">
                {success.welcomePrefix}
                {name.trim()}
                {success.welcomeSuffix}
              </span>
            </h1>
            <p className="obd__ln obd__d3 mt-3 max-w-[290px] text-[13.5px] font-semibold leading-[1.6] text-muted-foreground">
              <span className="inline-block">
                {bodyParts ? (
                  <>
                    {bodyParts[0]}
                    <span className="obd__org">{orgName}</span>
                    {bodyParts.slice(1).join(orgName)}
                  </>
                ) : (
                  body
                )}
              </span>
            </p>
          </div>

          <div className="obd__cta">
            <StickyCta
              label={success.startCta}
              onClick={() => { window.location.replace(dest); }}
              withArrow
            />
          </div>
        </section>
      </main>
    );
  }

  // ── Step 6 · Review all entered info ─────────────────────────────────────────
  if (step === 7) {
    const roleLabel = preview
      ? join.roleCategories[preview.roleCategory] ?? preview.roleCategory
      : "";
    const genderLabel = gender ? steps.genderOptions[gender] : "";
    const dobDisplay = dob
      ? `${dob.year}. ${pad2(dob.month)}. ${pad2(dob.day)}`
      : "";
    const phoneDisplay = `${selectedCountry.dial} ${nationalDigits}`;
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={5} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {review.title}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {review.subtitle}
            </p>

            <div className="mt-[22px] py-[2px]">
              <ReviewRow
                label={review.rowName}
                value={name.trim()}
                editLabel={review.edit}
                onEdit={() => goTo(1)}
                divider={false}
              />
              <ReviewRow
                label={review.rowDob}
                value={dobDisplay}
                editLabel={review.edit}
                onEdit={() => goTo(2)}
                divider
              />
              <ReviewRow
                label={review.rowGender}
                value={genderLabel}
                editLabel={review.edit}
                onEdit={() => goTo(3)}
                divider
              />
              <ReviewRow
                label={review.rowPhone}
                value={phoneDisplay}
                editLabel={review.edit}
                onEdit={() => goTo(4)}
                divider
              />
              {/* Language is chosen at login (not a wizard step) — shown read-only. */}
              <ReviewRow
                label={review.rowLang}
                value={languageName}
                editLabel={review.edit}
                divider
              />
              {preview && (
                <>
                  <ReviewRow
                    label={review.rowOrg}
                    value={preview.organizationName}
                    editLabel={review.edit}
                    onEdit={() => goTo(5)}
                    divider
                  />
                  <ReviewRow
                    label={review.rowRole}
                    value={roleLabel}
                    editLabel={review.edit}
                    onEdit={() => goTo(5)}
                    divider
                  />
                </>
              )}
            </div>

            {submitErrorKey ? (
              <div className="mt-[14px] flex items-start gap-[11px] rounded-[14px] border border-[rgb(197_40_46/0.24)] bg-[#fdecec] px-[14px] py-[13px]">
                <span className="mt-[1px] flex-none text-[#c5282e]">
                  <WarnIcon />
                </span>
                <div className="text-[12px] font-semibold leading-[1.5] text-[#c5282e]">
                  {join.errors[submitErrorKey] ?? submitErrorKey}
                </div>
              </div>
            ) : (
              <div
                className="mt-[14px] flex items-start gap-[11px] rounded-[14px] border px-[14px] py-[13px]"
                style={{
                  background: "hsl(206 66% 93%)",
                  borderColor: "color-mix(in oklab, hsl(206 70% 40%) 22%, transparent)",
                }}
              >
                <span className="mt-[1px] flex-none text-[hsl(206_70%_40%)]">
                  <InfoIcon />
                </span>
                <div>
                  <div className="text-[12.5px] font-extrabold text-[hsl(206_70%_40%)]">
                    {review.infoTitle}
                  </div>
                  <div className="mt-[2px] text-[11.5px] font-semibold leading-[1.5] text-[#3a3746]">
                    {review.infoBody}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-none py-[14px] pb-[max(14px,env(safe-area-inset-bottom))]">
            <SpinnerButton label={review.submit} onClick={submit} busy={submitting} />
          </div>
        </section>
      </main>
    );
  }

  // ── Step 5 · Organization / role confirmation (after a verified invite code) ──
  if (step === 6 && preview) {
    const roleLabel = join.roleCategories[preview.roleCategory] ?? preview.roleCategory;
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={5} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <p className="mb-[10px] mt-[14px] text-[13px] font-semibold t-eyebrow text-primary">
              {join.confirmEyebrow}
            </p>
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {join.confirmTitle}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {join.confirmSubtitle}
            </p>

            <div className="mt-[22px] overflow-hidden rounded-[16px] bg-[#f7f7f9]">
              <div className="relative px-[18px] pb-4 pt-[18px] text-foreground">
                <div className="relative flex items-center gap-[11px]">
                  <span className="flex size-[42px] flex-none items-center justify-center rounded-[12px] bg-[#16141f] text-[15px] font-bold text-white">
                    {preview.organizationName.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-extrabold tracking-[-0.01em]">
                      {preview.organizationName}
                    </div>
                  </div>
                  <span className="ml-auto inline-flex flex-none items-center gap-1 rounded-full bg-white/20 px-[9px] py-1 text-[10.5px] font-extrabold">
                    <ShieldIcon />
                    {join.verified}
                  </span>
                </div>
              </div>
              <div className="bg-surface px-[18px] py-[15px]">
                <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] t-eyebrow text-muted-foreground">
                  {join.roleLabel}
                </div>
                <div className="mt-2 text-[16px] font-extrabold tracking-[-0.01em]">
                  {roleLabel}
                </div>
              </div>
            </div>
          </div>

          {allowInviteSkip ? (
            <StickyCta label={join.reviewCta} onClick={() => goTo(7)} withArrow />
          ) : (
            <>
              {submitErrorKey && (
                <p className="px-[26px] pb-2 text-center text-[13px] font-bold text-red-600">
                  {join.errors[submitErrorKey] ?? submitErrorKey}
                </p>
              )}
              <StickyCta label={join.submitCta} onClick={submitMembership} disabled={submitting} />
            </>
          )}
        </section>
      </main>
    );
  }

  // ── Step 4 · Invite code entry (verify → preview, or skip) ───────────────────
  if (step === 5) {
    const verifying = inviteStatus === "verifying";
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={5} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <p className="mb-[10px] mt-[14px] text-[13px] font-semibold t-eyebrow text-primary">
              {join.inviteEyebrow}
            </p>
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {join.inviteTitle}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {join.inviteSubtitle}
            </p>

            <div className="mt-[22px]">
              <input
                autoFocus
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value.toUpperCase());
                  if (inviteStatus === "error") {
                    setInviteStatus("idle");
                    setInviteErrorKey(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !inviteCode.trim() || verifying) return;
                  e.preventDefault();
                  void verifyInvite();
                }}
                placeholder={join.codePlaceholder}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                enterKeyHint="done"
                // Oversized segmented code field (19px) — opt out of the touch ≥16px rule so it
                // keeps its intended large size (still ≥16px, so it never triggers iOS focus zoom).
                data-keep-font-size
                className={`h-[56px] w-full rounded-[14px] border bg-surface px-[15px] text-center font-mono text-[19px] font-bold tracking-[0.12em] text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-[15px] placeholder:font-medium placeholder:tracking-normal placeholder:text-[#9a97a6] ${
                  inviteStatus === "error"
                    ? "border-[#c5282e]"
                    : "border-border focus:border-primary focus:ring-[3.5px] focus:ring-primary/15"
                }`}
              />
              {inviteStatus === "error" ? (
                <div className="mt-[18px] flex items-start gap-[11px] rounded-[14px] border border-[rgb(197_40_46/0.24)] bg-[#fdecec] px-[14px] py-[13px]">
                  <span className="mt-[1px] flex-none text-[#c5282e]">
                    <WarnIcon />
                  </span>
                  <div>
                    <div className="text-[13px] font-extrabold text-[#c5282e]">
                      {join.invalidTitle}
                    </div>
                    <div className="mt-[3px] text-[11.5px] font-semibold leading-[1.5] text-[#3a3746]">
                      {(inviteErrorKey && join.errors[inviteErrorKey]) ?? join.invalidTitle}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-[14px] text-[11.5px] font-semibold text-[#9a97a6]">
                  {join.caseHint}
                </p>
              )}
            </div>
          </div>

          <div className="flex-none py-[14px] pb-[calc(max(14px,env(safe-area-inset-bottom))+var(--keyboard-inset,0px))]">
            <button
              type="button"
              onClick={verifyInvite}
              disabled={!inviteCode.trim() || verifying}
              className={`flex h-[52px] w-full items-center justify-center rounded-[14px] text-[16px] font-semibold text-white ${
                !inviteCode.trim() || verifying ? "opacity-40" : ""
              }`}
              style={{
                background: GRADIENT,
                boxShadow: !inviteCode.trim() || verifying ? "none" : SHADOW,
              }}
            >
              {verifying ? join.checking : join.verifyCta}
            </button>
            {allowInviteSkip && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    goTo(7);
                  }}
                  className="text-[13px] font-extrabold text-muted-foreground"
                >
                  {join.skip}
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  // ── Step 3 · Phone number ────────────────────────────────────────────────────
  if (step === 4) {
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={4} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <p className="mb-[10px] mt-[14px] text-[13px] font-semibold t-eyebrow text-primary">
              {steps.basicsEyebrow}
            </p>
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {steps.phoneTitle}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {steps.phoneSubtitle}
            </p>

            <div className="mt-[22px]">
              <div className="mb-2 text-[12.5px] font-extrabold text-[#3a3746]">
                {steps.phoneNumLabel}
              </div>
              <div className="flex gap-[10px]">
                <button
                  type="button"
                  onClick={() => setCountrySheet(true)}
                  className="flex h-[54px] flex-none items-center gap-[7px] rounded-[14px] border border-border bg-surface px-[13px] text-[15px] font-bold text-foreground"
                >
                  <span className="text-[17px] leading-none">
                    {selectedCountry.flag}
                  </span>
                  {selectedCountry.dial}
                  <span className="text-[#9a97a6]">
                    <ChevronDownIcon />
                  </span>
                </button>
                <input
                  autoFocus
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneErrorKey) {
                      setPhoneErrorKey(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !phoneValid) return;
                    e.preventDefault();
                    goTo(5);
                  }}
                  placeholder={steps.phoneInputPlaceholder}
                  className="h-[54px] flex-1 rounded-[14px] border border-border bg-surface px-[15px] text-[16px] font-semibold text-foreground outline-none transition-colors placeholder:font-medium placeholder:text-[#9a97a6] focus:border-primary focus:ring-[3.5px] focus:ring-primary/15"
                />
              </div>
              <p className="mt-2 text-[11.5px] font-semibold leading-[1.5] text-[#9a97a6]">
                {steps.phoneHint}
              </p>
              {phoneErrorKey ? (
                <div className="mt-[14px] flex items-start gap-[11px] rounded-[14px] border border-[rgb(197_40_46/0.24)] bg-[#fdecec] px-[14px] py-[13px]">
                  <span className="mt-[1px] flex-none text-[#c5282e]">
                    <WarnIcon />
                  </span>
                  <div>
                    <div className="text-[13px] font-extrabold text-[#c5282e]">
                      {join.errors[phoneErrorKey] ?? phoneErrorKey}
                    </div>
                    <div className="mt-[3px] text-[11.5px] font-semibold leading-[1.5] text-[#3a3746]">
                      {phoneErrorKey === "phone_duplicate"
                        ? steps.phoneDuplicateHelp
                        : steps.phoneHint}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <StickyCta
            label={steps.continueCta}
            onClick={() => goTo(5)}
            disabled={!phoneValid}
            withArrow
          />
        </section>

        {countrySheet && (
          <CountrySheet
            title={steps.phoneCountrySheetTitle}
            countryNames={countries}
            selectedIso={countryIso}
            onSelect={(iso) => {
              setCountryIso(iso);
              if (phoneErrorKey) {
                setPhoneErrorKey(null);
              }
            }}
            onClose={() => setCountrySheet(false)}
          />
        )}
      </main>
    );
  }

  // ── Step 2 · Date of birth ───────────────────────────────────────────────────
  if (step === 2) {
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={2} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <p className="mb-[10px] mt-[14px] text-[13px] font-semibold t-eyebrow text-primary">
              {steps.basicsEyebrow}
            </p>
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {steps.dobTitle}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {steps.dobSubtitle}
            </p>

            <div className="mt-[22px] flex gap-[10px]">
              <DateCell
                label={steps.dobYearLabel}
                value={dob ? String(dob.year) : null}
                placeholder={steps.dobYearPlaceholder}
                grow
                onClick={() => setDobSheet(true)}
              />
              <DateCell
                label={steps.dobMonthLabel}
                value={dob ? pad2(dob.month) : null}
                placeholder={steps.dobMonthPlaceholder}
                onClick={() => setDobSheet(true)}
              />
              <DateCell
                label={steps.dobDayLabel}
                value={dob ? pad2(dob.day) : null}
                placeholder={steps.dobDayPlaceholder}
                onClick={() => setDobSheet(true)}
              />
            </div>
            <p className="mt-2 text-[11.5px] font-semibold leading-[1.45] text-[#9a97a6]">
              {steps.dobHint}
            </p>
          </div>

          <StickyCta
            label={steps.continueCta}
            onClick={() => goTo(3)}
            disabled={!dob}
            withArrow
          />
        </section>

        {dobSheet && (
          <BirthDateSheet
            title={steps.dobSheetTitle}
            confirmLabel={steps.dobConfirm}
            labels={{
              year: steps.dobYearLabel,
              month: steps.dobMonthLabel,
              day: steps.dobDayLabel,
            }}
            initial={dob ?? { year: 2000, month: 1, day: 1 }}
            onConfirm={(parts) => setDob(parts)}
            onClose={() => setDobSheet(false)}
          />
        )}
      </main>
    );
  }

  // ── Step 1 · Name ────────────────────────────────────────────────────────────
  if (step === 3) {
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={3} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <p className="mb-[10px] mt-[14px] text-[13px] font-semibold t-eyebrow text-primary">
              {steps.basicsEyebrow}
            </p>
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {steps.genderTitle}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {steps.genderSubtitle}
            </p>

            <div className="mt-[22px]">
              <div className="mb-3 flex items-center gap-2 text-[12.5px] font-extrabold text-[#3a3746]">
                <span className="text-primary">
                  <SparkIcon />
                </span>
                {steps.genderLabel}
              </div>
              <div className="grid gap-3">
                {GENDER_ORDER.map((option) => (
                  <GenderChoice
                    key={option}
                    selected={gender === option}
                    active={gender === option}
                    label={steps.genderOptions[option]}
                    onClick={() => setGender(option)}
                  />
                ))}
              </div>
              <p className="mt-3 text-[11.5px] font-semibold leading-[1.5] text-[#9a97a6]">
                {steps.genderHint}
              </p>
            </div>
          </div>

          <StickyCta
            label={steps.continueCta}
            onClick={() => goTo(4)}
            disabled={!gender}
            withArrow
          />
        </section>
      </main>
    );
  }

  if (step === 1) {
    const isGood = name.trim().length > 0;
    return (
      <main
        lang={profile.locale}
        className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
        style={{ background: IVORY_BG }}
      >
        <ProgressHeader step={1} backLabel={steps.backCta} onBack={depth > 0 ? goBack : undefined} />
        {showExitLink ? (
          <div className="flex justify-end px-[26px] pb-1">{exitAction}</div>
        ) : null}
        <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
          <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
            <p className="mb-[10px] mt-[14px] text-[13px] font-semibold t-eyebrow text-primary">
              {steps.basicsEyebrow}
            </p>
            <h1 className="whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
              {steps.nameTitle}
            </h1>
            <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
              {steps.nameSubtitle}
            </p>

            <div className="mt-[22px]">
              <div className="mb-2 text-[12.5px] font-extrabold text-[#3a3746]">
                {steps.nameLabel}
              </div>
              <div className="relative">
                <input
                  autoFocus
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  // 단독 <input> 이라 폼 제출이 없다 — PC 에서 Enter 로 넘어가지 못하고 매번
                  // 하단 버튼을 마우스로 눌러야 했다(2026-09-09).
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !isGood) return;
                    e.preventDefault();
                    goTo(2);
                  }}
                  className={`h-[54px] w-full rounded-[14px] border bg-surface px-[15px] pr-[46px] text-[16px] font-semibold text-foreground outline-none transition-colors placeholder:font-medium placeholder:text-[#9a97a6] focus:ring-[3.5px] focus:ring-primary/15 ${
                    isGood ? "border-[hsl(146_50%_32%)]" : "border-border focus:border-primary"
                  }`}
                />
                {isGood && (
                  <span className="pointer-events-none absolute right-[15px] top-[18px] text-[hsl(146_50%_32%)]">
                    <CheckIcon />
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11.5px] font-semibold leading-[1.45] text-[#9a97a6]">
                {steps.nameHint}
              </p>
            </div>
          </div>

          <StickyCta
            label={steps.continueCta}
            onClick={() => goTo(2)}
            disabled={!isGood}
            withArrow
          />
        </section>
      </main>
    );
  }

  // ── Step 0 · Intro ───────────────────────────────────────────────────────────
  return (
    <main
      lang={profile.locale}
      className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] text-foreground"
      style={{ background: IVORY_BG }}
    >
      <header className="mx-auto flex h-[64px] w-full max-w-[460px] flex-none items-center px-[26px]">
        <FoldyMark size={36} />
      </header>
      <section className="mx-auto flex w-full max-w-[460px] flex-1 flex-col px-[26px]">
        <div className="flex-1 overflow-y-auto pt-2 px-1 -mx-1">
          <h1 className="mt-[18px] whitespace-pre-line text-[26px] font-bold leading-[1.3] tracking-[-0.03em] t-display">
            {intro.title}
          </h1>
          <p className="mt-[10px] text-[15px] leading-[1.6] text-muted-foreground">
            {intro.subtitle}
          </p>

          <div className="mt-6 py-[4px]">
            <ChecklistRow
              icon={<UserIcon />}
              title={intro.itemBasicsTitle}
              sub={intro.itemBasicsSub}
              divider={false}
            />
            <ChecklistRow
              icon={<GlobeIcon />}
              title={intro.itemLangTitle}
              sub={intro.itemLangSub}
              divider
            />
            <ChecklistRow
              icon={<TicketIcon />}
              title={intro.itemInviteTitle}
              sub={intro.itemInviteSub}
              divider
            />
          </div>
        </div>

        <StickyCta label={intro.startCta} onClick={() => goTo(1)} withArrow />
        {exitAction ? <div className="flex justify-center pb-[max(12px,env(safe-area-inset-bottom))]">{exitAction}</div> : null}
      </section>
    </main>
  );
}
