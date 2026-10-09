"use client";

import "@/app/auth/login/auth-white.css";
import { FoldyMark } from "@/components/brand/foldy-mark";
import "./desktop-onboarding.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import {
  joinWithInviteCode,
  previewInviteCode,
  submitOnboardingProfile,
} from "@/app/onboarding/actions";
import type { Locale } from "@/lib/i18n";
import type { ProfileGender } from "@/lib/onboarding";

/**
 * 대시보드(PC) 전용 가입 화면 — 한 화면 폼(2026-10-01, Claude Design 「PC 회원가입 전후 비교」 2a).
 *
 * **모바일 마법사(`onboarding-wizard.tsx`)와 화면을 공유하지 않는다.** `/onboarding` 이 기기 표면이
 * `desktop` 일 때만 이것을 그리고, 모바일 · 판별 불가는 지금 마법사 그대로다. 서버 액션
 * (`submitOnboardingProfile` · `joinWithInviteCode` · `previewInviteCode`)만 같이 써서 저장 규칙이 갈리지 않는다.
 *
 * PC 에서 불편했던 것을 바꿨다:
 * - 한 화면에 한 질문(5단계 + 확인) → 기본 정보 4개 + 초대코드를 한 화면에, Tab 이동 · Enter 제출.
 * - 생년월일 휠(하단 시트 · 드래그) → YYYY / MM / DD 를 키보드로, 다 차면 다음 칸으로.
 * - 국가번호 하단 시트 → 입력칸 아래로 펼치는 검색 드롭다운(↑↓ · Enter · Esc).
 * - 화면 맨 아래 고정 버튼 → 폼 바로 아래 버튼.
 */

type Country = { iso: string; flag: string; dial: string };

// 모바일 마법사와 같은 목록 · 같은 순서(국가 이름은 사전 `onboarding.countries`).
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

const MIN_AGE = 14;

export type DesktopOnboardingCopy = {
  brandRole: string;
  brandHead: string;
  brandLede: string;
  brandFoot: string[];
  railAccount: string;
  railProfile: string;
  railProfileSub: string;
  railJoin: string;
  railJoinSub: string;
  railStart: string;
  railStartSub: string;
  eyebrow: string;
  title: string;
  lede: string;
  joinTitle: string;
  joinLede: string;
  basicsTitle: string;
  inviteTitle: string;
  inviteHint: string;
  nameLabel: string;
  nameHint: string;
  dobLabel: string;
  dobYear: string;
  dobMonth: string;
  dobDay: string;
  dobHint: string;
  dobInvalid: string;
  genderLabel: string;
  genderOptions: Record<ProfileGender, string>;
  phoneLabel: string;
  phonePlaceholder: string;
  phoneHint: string;
  phoneDuplicateHelp: string;
  countrySearch: string;
  countryEmpty: string;
  countries: Record<string, string>;
  codePlaceholder: string;
  caseHint: string;
  verifyCta: string;
  checking: string;
  verified: string;
  orgLabel: string;
  roleLabel: string;
  roleCategories: Record<string, string>;
  skip: string;
  submit: string;
  exit: string;
  nameRequired: string;
  genderRequired: string;
  phoneRequired: string;
  inviteVerifyFirst: string;
  errors: Record<string, string>;
  successEyebrow: string;
  welcomePrefix: string;
  welcomeSuffix: string;
  bodyJoined: string;
  bodyNoTeam: string;
  startCta: string;
};

type Props = {
  /** `profile` = 기본 정보 + 초대코드, `membership` = 프로필은 있고 초대코드만(재가입 포함). */
  mode: "profile" | "membership";
  copy: DesktopOnboardingCopy;
  locale: Locale;
  safeNext: string;
  /** `?error=` 로 넘어온 문구(이미 번역됨). */
  initialError: string | null;
  initialName?: string;
  initialBirthDate?: string;
  initialGender?: ProfileGender | "";
  initialPhone?: string;
  /** 코드 없이 나중에 입력 — 프로필 단계에서만. 재가입은 코드가 있어야 들어간다. */
  allowInviteSkip: boolean;
};

function splitInitialPhone(phone: string | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const country =
    COUNTRIES.find((c) => {
      const dial = c.dial.replace(/\D/g, "");
      return digits.startsWith(dial) && digits.length > dial.length;
    }) ?? COUNTRIES[0];
  return {
    iso: country.iso,
    national: phone ? digits.slice(country.dial.replace(/\D/g, "").length) : "",
  };
}

/** 오늘(로컬) 기준 만 나이 판정 + 실제 있는 날짜인가. */
function birthDateOf(year: string, month: string, day: string): string | null {
  if (year.length !== 4 || !month || !day) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const now = new Date();
  const limit = Date.UTC(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate());
  if (date.getTime() > limit || y < 1900) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function DesktopOnboarding({
  mode,
  copy,
  locale,
  safeNext,
  initialError,
  initialName = "",
  initialBirthDate = "",
  initialGender = "",
  initialPhone,
  allowInviteSkip,
}: Props) {
  const initialPhoneParts = useMemo(() => splitInitialPhone(initialPhone), [initialPhone]);
  const [initY, initM, initD] = /^\d{4}-\d{2}-\d{2}$/.test(initialBirthDate)
    ? initialBirthDate.split("-")
    : ["", "", ""];

  const [name, setName] = useState(initialName);
  const [year, setYear] = useState(initY);
  const [month, setMonth] = useState(initM);
  const [day, setDay] = useState(initD);
  const [gender, setGender] = useState<ProfileGender | "">(initialGender);
  const [countryIso, setCountryIso] = useState(initialPhoneParts.iso);
  const [phone, setPhone] = useState(initialPhoneParts.national);

  const [inviteCode, setInviteCode] = useState("");
  const [inviteState, setInviteState] = useState<"idle" | "verifying">("idle");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ organizationName: string; roleCategory: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  /** 제출을 한 번 눌렀으면 빈 필수 칸을 표시한다 — 처음부터 빨갛게 칠하지 않는다. */
  const [tried, setTried] = useState(false);
  const [formError, setFormError] = useState<string | null>(initialError);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [done, setDone] = useState<{ dest: string } | null>(null);

  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const country = COUNTRIES.find((c) => c.iso === countryIso) ?? COUNTRIES[0];
  const nationalDigits = phone.replace(/\D/g, "").replace(/^0+/, "");
  const phoneE164 = nationalDigits ? `${country.dial}${nationalDigits}` : "";
  const birthDate = birthDateOf(year, month, day);
  const dobFilled = year.length === 4 && Boolean(month) && Boolean(day);

  const nameMissing = mode === "profile" && !name.trim();
  const dobBad = mode === "profile" && !birthDate;
  const genderMissing = mode === "profile" && !gender;
  const phoneMissing = mode === "profile" && nationalDigits.length < 6;

  async function verifyInvite() {
    const code = inviteCode.trim();
    if (!code || inviteState === "verifying") return;
    setInviteState("verifying");
    setInviteError(null);
    try {
      const result = await previewInviteCode(code);
      if (result.ok) {
        setPreview({ organizationName: result.organizationName, roleCategory: result.roleCategory });
      } else {
        setPreview(null);
        setInviteError(copy.errors[result.errorKey] ?? copy.errors.invite_invalid ?? result.errorKey);
      }
    } catch {
      setPreview(null);
      setInviteError(copy.errors.network_error ?? "network_error");
    }
    setInviteState("idle");
  }

  async function submit(skipInvite: boolean) {
    if (submitting) return;
    setTried(true);
    setFormError(null);
    if (mode === "profile" && (nameMissing || dobBad || genderMissing || phoneMissing)) return;
    if (!skipInvite && !preview) {
      // 코드를 적어 놓고 확인을 안 눌렀으면 여기서 확인까지 해 준다 — Enter 한 번으로 끝나게.
      if (inviteCode.trim()) {
        await verifyInvite();
        return;
      }
      setFormError(copy.inviteVerifyFirst);
      return;
    }
    setSubmitting(true);
    try {
      const result =
        mode === "profile"
          ? await submitOnboardingProfile({
              name: name.trim(),
              birthDate: birthDate ?? "",
              gender,
              phoneNumber: phoneE164,
              preferredLanguage: locale,
              inviteCode: skipInvite ? "" : inviteCode.trim(),
              next: safeNext,
            })
          : await joinWithInviteCode({ inviteCode: inviteCode.trim(), next: safeNext });
      if (result.ok) {
        // 코드 없이 저장했으면 서버가 `/onboarding` 으로 돌려보낸다 — 거기서 초대코드 화면이 뜬다.
        if (result.redirectTo === "/onboarding") {
          window.location.assign(`/onboarding?lang=${locale}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`);
          return;
        }
        setDone({ dest: result.redirectTo });
      } else if (result.errorKey === "phone_duplicate" || result.errorKey === "phone_invalid") {
        setPhoneError(result.errorKey === "phone_duplicate" ? copy.phoneDuplicateHelp : copy.errors.phone_invalid ?? result.errorKey);
        phoneRef.current?.focus();
      } else {
        setFormError(copy.errors[result.errorKey] ?? result.errorKey);
      }
    } catch {
      setFormError(copy.errors.network_error ?? "network_error");
    }
    setSubmitting(false);
  }

  if (done) {
    const displayName = name.trim() || initialName;
    const body = preview
      ? copy.bodyJoined
          .replace("{org}", preview.organizationName)
          .replace("{role}", copy.roleCategories[preview.roleCategory] ?? preview.roleCategory)
      : copy.bodyNoTeam;
    return (
      <Frame copy={copy} locale={locale} step="done">
        <div className="obd__done">
          <span className="obd__doneic" aria-hidden="true">
            <CheckIcon />
          </span>
          <p className="obd__eye">{copy.successEyebrow}</p>
          <h1 className="obd__title obd__title--center">
            {copy.welcomePrefix.replace(/\n/g, " ")}
            {displayName}
            {copy.welcomeSuffix}
          </h1>
          <p className="obd__lede obd__lede--center">{body}</p>
          <button className="obd__btn obd__btn--pri obd__btn--lg" onClick={() => window.location.assign(done.dest)} type="button">
            {copy.startCta}
            <ArrowIcon />
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame copy={copy} locale={locale} step={mode === "profile" ? "profile" : "join"}>
      <form
        className="obd__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
      >
        <p className="obd__eye">{copy.eyebrow}</p>
        <h1 className="obd__title">{mode === "profile" ? copy.title : copy.joinTitle}</h1>
        <p className="obd__lede">{mode === "profile" ? copy.lede : copy.joinLede}</p>

        {mode === "profile" ? (
          <section className="obd__sec">
            <div className="obd__sech">
              <b>{copy.basicsTitle}</b>
            </div>
            <div className="obd__grid">
              <Field error={tried && nameMissing ? copy.nameRequired : null} hint={copy.nameHint} label={copy.nameLabel}>
                <input
                  autoComplete="name"
                  autoFocus
                  className="obd__in"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </Field>

              <Field
                // 세 칸을 다 채웠는데 틀렸거나, 제출을 눌렀는데 비었거나 틀렸을 때만 빨갛게.
                error={dobBad && (tried || dobFilled) ? copy.dobInvalid : null}
                hint={copy.dobHint}
                label={copy.dobLabel}
              >
                <div className="obd__dob" role="group" aria-label={copy.dobLabel}>
                  <input
                    aria-label={copy.dobYear}
                    autoComplete="bday-year"
                    className="obd__in"
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => {
                      const v = event.target.value.replace(/\D/g, "").slice(0, 4);
                      setYear(v);
                      if (v.length === 4) monthRef.current?.focus();
                    }}
                    placeholder="YYYY"
                    ref={yearRef}
                    value={year}
                  />
                  <input
                    aria-label={copy.dobMonth}
                    autoComplete="bday-month"
                    className="obd__in"
                    inputMode="numeric"
                    maxLength={2}
                    onChange={(event) => {
                      const v = event.target.value.replace(/\D/g, "").slice(0, 2);
                      setMonth(v);
                      // 2~9 로 시작하면 한 자리로 끝난다(「4」 = 4월) — 바로 다음 칸.
                      if (v.length === 2 || (v.length === 1 && Number(v) > 1)) dayRef.current?.focus();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Backspace" && !month) yearRef.current?.focus();
                    }}
                    placeholder="MM"
                    ref={monthRef}
                    value={month}
                  />
                  <input
                    aria-label={copy.dobDay}
                    autoComplete="bday-day"
                    className="obd__in"
                    inputMode="numeric"
                    maxLength={2}
                    onChange={(event) => setDay(event.target.value.replace(/\D/g, "").slice(0, 2))}
                    onKeyDown={(event) => {
                      if (event.key === "Backspace" && !day) monthRef.current?.focus();
                    }}
                    placeholder="DD"
                    ref={dayRef}
                    value={day}
                  />
                </div>
              </Field>

              <Field error={tried && genderMissing ? copy.genderRequired : null} label={copy.genderLabel}>
                <div className="obd__seg" role="radiogroup" aria-label={copy.genderLabel}>
                  {(["female", "male"] as const).map((value) => (
                    <button
                      aria-checked={gender === value}
                      className={gender === value ? "on" : ""}
                      key={value}
                      onClick={() => setGender(value)}
                      role="radio"
                      type="button"
                    >
                      {copy.genderOptions[value]}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                error={phoneError ?? (tried && phoneMissing ? copy.phoneRequired : null)}
                hint={copy.phoneHint}
                label={copy.phoneLabel}
              >
                <div className="obd__phone">
                  <CountryPicker
                    copy={copy}
                    onPick={(iso) => {
                      setCountryIso(iso);
                      phoneRef.current?.focus();
                    }}
                    value={countryIso}
                  />
                  <input
                    autoComplete="tel-national"
                    className="obd__in"
                    inputMode="tel"
                    onChange={(event) => {
                      setPhone(event.target.value.replace(/[^\d\s-]/g, ""));
                      setPhoneError(null);
                    }}
                    placeholder={copy.phonePlaceholder}
                    ref={phoneRef}
                    value={phone}
                  />
                </div>
              </Field>
            </div>
          </section>
        ) : null}

        <section className="obd__sec">
          <div className="obd__sech">
            <b>{copy.inviteTitle}</b>
            <span>{copy.inviteHint}</span>
          </div>
          <div className="obd__inv">
            <input
              aria-label={copy.codePlaceholder}
              autoComplete="off"
              autoFocus={mode === "membership"}
              className="obd__in obd__in--code"
              onChange={(event) => {
                setInviteCode(event.target.value.toUpperCase());
                setPreview(null);
                setInviteError(null);
              }}
              placeholder={copy.codePlaceholder}
              spellCheck={false}
              value={inviteCode}
            />
            <button
              className={`obd__btn${preview ? " obd__btn--ok" : ""}`}
              disabled={!inviteCode.trim() || inviteState === "verifying" || Boolean(preview)}
              onClick={() => void verifyInvite()}
              type="button"
            >
              {inviteState === "verifying" ? copy.checking : preview ? copy.verified : copy.verifyCta}
              {preview ? <CheckIcon /> : null}
            </button>
          </div>
          {inviteError ? <p className="obd__err">{inviteError}</p> : <p className="obd__hint">{copy.caseHint}</p>}
          {preview ? (
            <div className="obd__org">
              <span className="obd__orgav" aria-hidden="true">
                {preview.organizationName.slice(0, 1)}
              </span>
              <div>
                <b>{preview.organizationName}</b>
                <small>
                  {copy.roleLabel} · {copy.roleCategories[preview.roleCategory] ?? preview.roleCategory}
                </small>
              </div>
              <span className="obd__orgok">{copy.verified}</span>
            </div>
          ) : null}
        </section>

        {formError ? (
          <p className="obd__banner" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="obd__foot">
          {allowInviteSkip ? (
            <button className="obd__link obd__link--skip" disabled={submitting} onClick={() => void submit(true)} type="button">
              {copy.skip}
            </button>
          ) : null}
          <span className="obd__sp" />
          <button className="obd__btn obd__btn--pri obd__btn--lg" disabled={submitting} type="submit">
            {submitting ? copy.checking : copy.submit}
            {submitting ? null : <ArrowIcon />}
          </button>
        </div>
      </form>
    </Frame>
  );
}

function Frame({
  copy,
  locale,
  step,
  children,
}: {
  copy: DesktopOnboardingCopy;
  locale: Locale;
  step: "profile" | "join" | "done";
  children: React.ReactNode;
}) {
  const rail = [
    { key: "account", title: copy.railAccount, sub: "", state: "done" as const },
    step === "profile"
      ? { key: "profile", title: copy.railProfile, sub: copy.railProfileSub, state: "on" as const }
      : { key: "join", title: copy.railJoin, sub: copy.railJoinSub, state: step === "done" ? ("done" as const) : ("on" as const) },
    { key: "start", title: copy.railStart, sub: copy.railStartSub, state: step === "done" ? ("on" as const) : ("todo" as const) },
  ];
  return (
    <div className="authw obd" lang={locale}>
      <header className="authw__top">
        <div className="authw__brand">
          <FoldyMark />
          <span className="authw__wm">Foldy</span>
          <span className="authw__role">{copy.brandRole}</span>
        </div>
        <span className="authw__backicon is-empty" aria-hidden="true" />
        <div className="authw__tools">
          {step === "done" ? null : (
            <form action={signOut}>
              <input name="next" type="hidden" value={`/auth/login?lang=${locale}`} />
              <button className="obd__link" type="submit">
                {copy.exit}
              </button>
            </form>
          )}
        </div>
      </header>
      <main className="obd__body">
        <ol className="obd__rail" aria-label={copy.brandHead}>
          {rail.map((item, index) => (
            <li className={`obd__rs ${item.state}`} key={item.key}>
              <span className="obd__rn">{item.state === "done" ? <CheckIcon /> : index + 1}</span>
              <div>
                <div className="obd__rt">{item.title}</div>
                {item.sub ? <div className="obd__rsub">{item.sub}</div> : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="obd__stage">{children}</div>
      </main>
      <footer className="authw__foot">
        <span className="authw__staff">{copy.brandFoot[copy.brandFoot.length - 1]}</span>
        <span />
      </footer>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={`obd__fld${error ? " bad" : ""}`}>
      <label className="obd__lbl">
        {label}
        <em>*</em>
      </label>
      {children}
      {error ? <p className="obd__err">{error}</p> : hint ? <p className="obd__hint">{hint}</p> : null}
    </div>
  );
}

/**
 * 국가번호 — 입력칸 아래로 펼치는 검색 드롭다운. 하단 시트를 쓰지 않는다(PC).
 * ↑↓ 로 고르고 Enter 로 확정, Esc · 바깥 클릭으로 닫는다.
 */
function CountryPicker({
  copy,
  value,
  onPick,
}: {
  copy: DesktopOnboardingCopy;
  value: string;
  onPick: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = COUNTRIES.find((c) => c.iso === value) ?? COUNTRIES[0];

  const q = query.trim().toLowerCase();
  const list = COUNTRIES.filter((c) => {
    if (!q) return true;
    const label = (copy.countries[c.iso] ?? c.iso).toLowerCase();
    return label.includes(q) || c.dial.includes(q.replace(/^\+?/, "+")) || c.iso.includes(q);
  });

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
    function onDoc(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(iso: string) {
    setOpen(false);
    setQuery("");
    onPick(iso);
  }

  return (
    <div className="obd__cc" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="obd__in obd__ccbtn"
        onClick={() => {
          setActive(Math.max(0, COUNTRIES.findIndex((c) => c.iso === value)));
          setOpen((v) => !v);
        }}
        type="button"
      >
        <span>
          {current.flag} {current.dial}
        </span>
        <ChevronIcon />
      </button>
      {open ? (
        <div className="obd__pop">
          <input
            className="obd__popq"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(list.length - 1, i + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (event.key === "Enter") {
                // 폼 제출로 새지 않게 — 여기서는 나라 고르기다.
                event.preventDefault();
                if (list[active]) pick(list[active].iso);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={copy.countrySearch}
            ref={searchRef}
            value={query}
          />
          <div className="obd__poplist" role="listbox">
            {list.length === 0 ? <div className="obd__popnone">{copy.countryEmpty}</div> : null}
            {list.map((c, index) => (
              <button
                aria-selected={c.iso === value}
                className={`obd__popopt${index === active ? " on" : ""}${c.iso === value ? " sel" : ""}`}
                key={c.iso}
                onClick={() => pick(c.iso)}
                onMouseEnter={() => setActive(index)}
                role="option"
                type="button"
              >
                <span className="obd__popflag">{c.flag}</span>
                <span className="obd__popname">{copy.countries[c.iso] ?? c.iso}</span>
                <span className="obd__popdial">{c.dial}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
