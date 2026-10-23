"use client";

/**
 * 국적 + 이름 세 가지(한국어 · 일본어 · 영문 · 가타카나) 입력 — 가입(모바일 · PC) · 내 정보가 같이 쓴다.
 * 규칙은 `src/lib/identity-names.ts`, 기획은 `docs/product/41-residence-card-workflow.md` §2.
 *
 * - 국적을 고르면 한국어 이름 ↔ 일본어 이름 칸이 바뀐다(일본 국적 = 일본어 이름).
 * - 가타카나 · 영문 정리는 칸을 떠날 때 한다 — 입력 중에 바꾸면 일본어 IME 조합이 깨진다.
 * - `variant="app"` = 모바일 · 계정 화면(나라는 하단 시트), `variant="desktop"` = PC 가입(나라는 드롭다운).
 * - `nationalityPopover` = `app` 모양 칸이지만 나라는 칸 아래 검색 드롭다운(PC 콘솔 계정 화면 — 모바일 하단 시트를 PC 에 띄우지 않는다, 2026-10-23).
 * - `formNames` 를 주면 숨은 input 으로 값을 같이 내보내 `<form action>` 에서도 쓸 수 있다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  FREQUENT_NATIONALITIES,
  NATIONALITY_CODES,
  localNameField,
  nationalityName,
  normalizeEnglishName,
  normalizeKatakana,
  type IdentityErrorKey,
  type IdentityField,
  type IdentityNames,
} from "@/lib/identity-names";

export type IdentityCopy = {
  title: string;
  subtitle: string;
  nationalityLabel: string;
  nationalityPick: string;
  nationalitySheetTitle: string;
  nationalitySearch: string;
  nationalityFrequent: string;
  nationalityAll: string;
  nationalityEmpty: string;
  nameKoLabel: string;
  nameJaLabel: string;
  nameEnLabel: string;
  nameKatakanaLabel: string;
  optional: string;
  nameKoPlaceholder: string;
  nameJaPlaceholder: string;
  nameEnPlaceholder: string;
  nameKatakanaPlaceholder: string;
  nameEnHint: string;
  nameKatakanaHint: string;
  fillTitle: string;
  fillBody: string;
  fillSave: string;
  fillLater: string;
  fillCta: string;
  fillSaved: string;
  errors: Record<IdentityErrorKey | "save_failed", string>;
};

export const EMPTY_IDENTITY: IdentityNames = {
  nationality: "",
  nameKo: "",
  nameJa: "",
  nameEn: "",
  nameKatakana: "",
};

type Variant = "app" | "desktop";

function useNationalityList(locale: string) {
  return useMemo(() => {
    const named = NATIONALITY_CODES.map((code) => ({ code, name: nationalityName(code, locale) }));
    const byCode = new Map(named.map((n) => [n.code as string, n]));
    const frequent = FREQUENT_NATIONALITIES.map((code) => byCode.get(code)!).filter(Boolean);
    const all = [...named].sort((a, b) => a.name.localeCompare(b.name, locale));
    return { frequent, all };
  }, [locale]);
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

/** 모바일 — 하단 시트 안 검색 + 자주 고르는 나라 + 모든 나라. */
function NationalitySheet({
  copy,
  locale,
  value,
  onPick,
  onClose,
}: {
  copy: IdentityCopy;
  locale: string;
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const { frequent, all } = useNationalityList(locale);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? all.filter((n) => n.name.toLowerCase().includes(q) || n.code.toLowerCase() === q)
    : null;

  const row = (n: { code: string; name: string }, close: () => void) => {
    const on = n.code === value;
    return (
      <button
        aria-pressed={on}
        className={`flex w-full items-center gap-3 rounded-[13px] px-3 py-[13px] text-left ${on ? "bg-primary/[0.08]" : ""}`}
        key={n.code}
        onClick={() => {
          onPick(n.code);
          close();
        }}
        type="button"
      >
        <span className="flex-1 text-[15px] font-bold text-foreground">{n.name}</span>
        {on ? <CheckIcon className="size-5 text-primary" /> : null}
      </button>
    );
  };

  return (
    <BottomSheet
      className="max-h-[80dvh]"
      header={
        <div className="pb-[10px] pt-1">
          <p className="text-center text-[15px] font-extrabold text-foreground">{copy.nationalitySheetTitle}</p>
          <input
            aria-label={copy.nationalitySearch}
            autoComplete="off"
            className="mt-3 h-[44px] w-full rounded-[12px] border-0 bg-[#f4f4f7] px-[14px] text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-primary/15"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.nationalitySearch}
            type="search"
            value={query}
          />
        </div>
      }
      onClose={onClose}
    >
      {({ close }) => (
        <div className="-mx-1 max-h-[60dvh] overflow-y-auto px-1 pb-2">
          {matches ? (
            matches.length ? (
              matches.map((n) => row(n, close))
            ) : (
              <p className="py-6 text-center text-[14px] font-semibold text-muted-foreground">{copy.nationalityEmpty}</p>
            )
          ) : (
            <>
              <p className="px-3 pb-1 pt-1 text-[12px] font-bold text-muted-foreground">{copy.nationalityFrequent}</p>
              {frequent.map((n) => row(n, close))}
              <p className="px-3 pb-1 pt-4 text-[12px] font-bold text-muted-foreground">{copy.nationalityAll}</p>
              {all.map((n) => row(n, close))}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * 시트 안 — 칸 바로 아래에 펼치는 목록. 하단 시트 위에 시트를 또 띄우지 않는다(한 번에 시트 하나).
 */
function NationalityInline({
  copy,
  locale,
  value,
  onPick,
}: {
  copy: IdentityCopy;
  locale: string;
  value: string;
  onPick: (code: string) => void;
}) {
  const { frequent, all } = useNationalityList(locale);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // 펼칠 때 검색칸에 바로 포커스하지 않는다 — 폰에서 키보드가 올라오며 시트 · 화면이 위로 밀려 깨졌다(2026-10-23 사용자 제보).
  // 대신 펼친 목록이 시트 안에서 보이게만 굴린다. 검색은 칸을 누르면 그때.
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter((n) => n.name.toLowerCase().includes(q) || n.code.toLowerCase() === q)
    : [...frequent, ...all.filter((n) => !(FREQUENT_NATIONALITIES as readonly string[]).includes(n.code))];
  return (
    <div className="mt-2 scroll-mb-4 rounded-[14px] bg-[#f7f7f9] p-2" ref={boxRef}>
      <input
        aria-label={copy.nationalitySearch}
        autoComplete="off"
        className="h-[42px] w-full rounded-[10px] border-0 bg-surface px-3 text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-primary/15"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.nationalitySearch}
        type="search"
        value={query}
      />
      <div className="mt-1 max-h-[240px] overflow-y-auto">
        {list.length === 0 ? (
          <p className="py-4 text-center text-[13.5px] font-semibold text-muted-foreground">{copy.nationalityEmpty}</p>
        ) : (
          list.map((n, index) => {
            const on = n.code === value;
            return (
              <button
                aria-pressed={on}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-left ${on ? "bg-primary/[0.08]" : ""}`}
                key={`${n.code}-${index}`}
                onClick={() => onPick(n.code)}
                type="button"
              >
                <span className="flex-1 text-[15px] font-semibold text-foreground">{n.name}</span>
                {on ? <CheckIcon className="size-5 text-primary" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** PC 드롭다운 모양 두 벌 — 가입 화면(`obd__pop*`) · 계정 화면(앱 칸과 같은 52px 칸 + 칸 폭 메뉴). */
const POPOVER_SKIN = {
  obd: {
    root: "obd__cc",
    button: (invalid: boolean) => `obd__in obd__ccbtn${invalid ? " bad" : ""}`,
    placeholder: "obd__ph",
    pop: "obd__pop",
    search: "obd__popq",
    list: "obd__poplist",
    none: "obd__popnone",
    option: (active: boolean, selected: boolean) => `obd__popopt${active ? " on" : ""}${selected ? " sel" : ""}`,
    name: "obd__popname",
  },
  app: {
    root: "relative",
    button: (invalid: boolean) =>
      `flex h-[52px] w-full items-center gap-2 rounded-[14px] border bg-surface px-[15px] text-left text-[16px] font-semibold text-foreground outline-none transition-colors focus:border-primary focus:ring-[3.5px] focus:ring-primary/15 ${invalid ? "border-destructive" : "border-border"}`,
    placeholder: "font-medium text-muted-foreground",
    pop: "absolute inset-x-0 top-[calc(100%+6px)] z-40 rounded-[14px] bg-surface p-1.5 shadow-[0_12px_32px_-8px_rgba(22,20,31,0.22),0_0_0_0.5px_rgba(22,20,31,0.08)]",
    search:
      "mb-1 h-[38px] w-full rounded-[10px] border-0 bg-[#f4f4f7] px-3 text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-primary/15",
    list: "max-h-[300px] overflow-y-auto",
    none: "px-3 py-4 text-center text-[13.5px] font-semibold text-muted-foreground",
    option: (active: boolean, selected: boolean) =>
      `flex min-h-[40px] w-full items-center gap-2 rounded-[9px] px-3 text-left text-[14.5px] font-semibold ${selected ? "bg-primary/[0.08] text-primary" : active ? "bg-[#f4f4f7] text-foreground" : "text-foreground"}`,
    name: "min-w-0 flex-1",
  },
} as const;

/** PC — 칸 아래로 펼치는 검색 드롭다운(가입 화면 국가번호 고르기와 같은 모양 · `obd__pop*`, 계정 화면은 `skin="app"`). */
function NationalityPopover({
  copy,
  locale,
  value,
  onPick,
  invalid,
  skin = "obd",
  labelledBy,
}: {
  copy: IdentityCopy;
  locale: string;
  value: string;
  onPick: (code: string) => void;
  invalid: boolean;
  skin?: keyof typeof POPOVER_SKIN;
  labelledBy?: string;
}) {
  const k = POPOVER_SKIN[skin];
  const { frequent, all } = useNationalityList(locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter((n) => n.name.toLowerCase().includes(q) || n.code.toLowerCase() === q)
    : [...frequent, ...all.filter((n) => !(FREQUENT_NATIONALITIES as readonly string[]).includes(n.code))];

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
    function onDoc(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(code: string) {
    setOpen(false);
    setQuery("");
    onPick(code);
  }

  return (
    <div className={k.root} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelledBy}
        className={k.button(invalid)}
        onClick={() => {
          setActive(0);
          setOpen((v) => !v);
        }}
        type="button"
      >
        <span className={`${skin === "app" ? "flex-1 " : ""}${value ? "" : k.placeholder}`}>{value ? nationalityName(value, locale) : copy.nationalityPick}</span>
        <ChevronIcon className={skin === "app" ? "size-4 text-muted-foreground" : undefined} />
      </button>
      {open ? (
        <div className={k.pop}>
          <input
            aria-label={copy.nationalitySearch}
            className={k.search}
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
                event.preventDefault();
                if (list[active]) pick(list[active].code);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={copy.nationalitySearch}
            ref={searchRef}
            value={query}
          />
          <div className={k.list} role="listbox">
            {list.length === 0 ? <div className={k.none}>{copy.nationalityEmpty}</div> : null}
            {list.map((n, index) => (
              <button
                aria-selected={n.code === value}
                className={k.option(index === active, n.code === value)}
                key={`${n.code}-${index}`}
                onClick={() => pick(n.code)}
                onMouseEnter={() => setActive(index)}
                role="option"
                type="button"
              >
                <span className={k.name}>{n.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function IdentityNamesFields({
  copy,
  locale,
  value,
  onChange,
  errors,
  showErrors,
  variant = "app",
  formNames = false,
  autoFocus = false,
  inlineNationality = false,
  nationalityPopover = false,
}: {
  copy: IdentityCopy;
  locale: string;
  value: IdentityNames;
  onChange: (next: IdentityNames) => void;
  errors: Partial<Record<IdentityField, IdentityErrorKey>>;
  /** false 면 손대지 않은 칸의 오류는 숨긴다(처음부터 빨갛게 칠하지 않음). */
  showErrors: boolean;
  variant?: Variant;
  formNames?: boolean;
  autoFocus?: boolean;
  /** 하단 시트 안에서 쓸 때 — 나라 목록을 시트 대신 칸 아래에 펼친다. */
  inlineNationality?: boolean;
  /** PC 콘솔(계정 화면) — 나라를 하단 시트 대신 칸 아래 검색 드롭다운으로. */
  nationalityPopover?: boolean;
}) {
  const [sheet, setSheet] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<IdentityField, boolean>>>({});
  const localField = localNameField(value.nationality);
  const localRequired = value.nationality === "KR" || value.nationality === "JP";

  const errorOf = (field: IdentityField) => {
    const key = errors[field];
    if (!key || !(showErrors || touched[field])) return null;
    return copy.errors[key] ?? key;
  };
  const set = (patch: Partial<IdentityNames>) => onChange({ ...value, ...patch });
  const touch = (field: IdentityField) => setTouched((t) => ({ ...t, [field]: true }));
  const setField = (field: Exclude<IdentityField, "nationality">, v: string) =>
    onChange({ ...value, [field]: v } as IdentityNames);

  const fields: Array<{
    field: Exclude<IdentityField, "nationality">;
    label: string;
    placeholder: string;
    hint?: string;
    optional?: boolean;
    lang?: string;
    autoComplete: string;
    normalize?: (v: string) => string;
    upper?: boolean;
  }> = [
    localField === "nameJa"
      ? { field: "nameJa", label: copy.nameJaLabel, placeholder: copy.nameJaPlaceholder, lang: "ja", autoComplete: "name" }
      : {
          field: "nameKo",
          label: copy.nameKoLabel,
          placeholder: copy.nameKoPlaceholder,
          optional: !localRequired,
          lang: "ko",
          autoComplete: "name",
        },
    {
      field: "nameKatakana",
      label: copy.nameKatakanaLabel,
      placeholder: copy.nameKatakanaPlaceholder,
      hint: copy.nameKatakanaHint,
      lang: "ja",
      autoComplete: "off",
      normalize: normalizeKatakana,
    },
  ];

  const hidden = formNames ? (
    <>
      <input name="nationality" type="hidden" value={value.nationality} />
      <input name="nameKo" type="hidden" value={localField === "nameKo" ? value.nameKo : ""} />
      <input name="nameJa" type="hidden" value={localField === "nameJa" ? value.nameJa : ""} />
      <input name="nameEn" type="hidden" value={value.nameEn} />
      <input name="nameKatakana" type="hidden" value={value.nameKatakana} />
    </>
  ) : null;

  if (variant === "desktop") {
    const natErr = errorOf("nationality");
    return (
      <>
        {hidden}
        <div className={`obd__fld${natErr ? " bad" : ""}`}>
          <label className="obd__lbl">
            {copy.nationalityLabel}
            <em>*</em>
          </label>
          <NationalityPopover
            copy={copy}
            invalid={Boolean(natErr)}
            locale={locale}
            onPick={(code) => {
              set({ nationality: code });
              touch("nationality");
            }}
            value={value.nationality}
          />
          {natErr ? <p className="obd__err">{natErr}</p> : null}
        </div>
        {fields.map((f, index) => {
          const err = errorOf(f.field);
          return (
            <div className={`obd__fld${err ? " bad" : ""}`} key={f.field}>
              <label className="obd__lbl" htmlFor={`identity-${f.field}`}>
                {f.label}
                {f.optional ? <span className="obd__opt"> ({copy.optional})</span> : <em>*</em>}
              </label>
              <input
                aria-invalid={err ? true : undefined}
                autoCapitalize={f.upper ? "characters" : undefined}
                autoComplete={f.autoComplete}
                autoFocus={autoFocus && index === 0 && Boolean(value.nationality)}
                className="obd__in"
                id={`identity-${f.field}`}
                lang={f.lang}
                onBlur={(event) => {
                  touch(f.field);
                  if (f.normalize) setField(f.field, f.normalize(event.target.value));
                }}
                onChange={(event) => setField(f.field, event.target.value)}
                placeholder={f.placeholder}
                spellCheck={false}
                value={value[f.field]}
              />
              {err ? <p className="obd__err">{err}</p> : f.hint ? <p className="obd__hint">{f.hint}</p> : null}
            </div>
          );
        })}
      </>
    );
  }

  const natErr = errorOf("nationality");
  const inputCls = (bad: boolean) =>
    `h-[52px] w-full rounded-[14px] border bg-surface px-[15px] text-[16px] font-semibold text-foreground outline-none transition-colors placeholder:font-medium placeholder:text-muted-foreground focus:border-primary focus:ring-[3.5px] focus:ring-primary/15 ${
      bad ? "border-destructive" : "border-border"
    }`;

  return (
    <div className="grid gap-[14px]">
      {hidden}
      <div>
        <span className="mb-2 block text-[12.5px] font-extrabold text-[#3a3746]" id="identity-nationality-label">
          {copy.nationalityLabel}
        </span>
        {nationalityPopover ? (
          <NationalityPopover
            copy={copy}
            invalid={Boolean(natErr)}
            labelledBy="identity-nationality-label"
            locale={locale}
            onPick={(code) => {
              set({ nationality: code });
              touch("nationality");
            }}
            skin="app"
            value={value.nationality}
          />
        ) : (
          <button
            aria-describedby={natErr ? "identity-nationality-err" : undefined}
            aria-haspopup="dialog"
            aria-expanded={inlineNationality ? sheet : undefined}
            aria-labelledby="identity-nationality-label"
            className={`${inputCls(Boolean(natErr))} flex items-center text-left`}
            onClick={() => setSheet((open) => (inlineNationality ? !open : true))}
            type="button"
          >
            <span className={`flex-1 ${value.nationality ? "" : "font-medium text-muted-foreground"}`}>
              {value.nationality ? nationalityName(value.nationality, locale) : copy.nationalityPick}
            </span>
            <ChevronIcon className="size-4 text-muted-foreground" />
          </button>
        )}
        {inlineNationality && sheet ? (
          <NationalityInline
            copy={copy}
            locale={locale}
            onPick={(code) => {
              set({ nationality: code });
              touch("nationality");
              setSheet(false);
            }}
            value={value.nationality}
          />
        ) : null}
        {natErr ? (
          <p className="mt-2 text-[12px] font-bold text-destructive" id="identity-nationality-err" role="alert">
            {natErr}
          </p>
        ) : null}
      </div>
      {fields.map((f, index) => {
        const err = errorOf(f.field);
        const hintId = `identity-${f.field}-hint`;
        return (
          <label className="block" key={f.field}>
            <span className="mb-2 block text-[12.5px] font-extrabold text-[#3a3746]">
              {f.label}
              {f.optional ? <span className="font-semibold text-muted-foreground"> ({copy.optional})</span> : null}
            </span>
            <input
              aria-describedby={err || f.hint ? hintId : undefined}
              aria-invalid={err ? true : undefined}
              autoCapitalize={f.upper ? "characters" : undefined}
              autoComplete={f.autoComplete}
              autoFocus={autoFocus && index === 0 && Boolean(value.nationality)}
              className={inputCls(Boolean(err))}
              lang={f.lang}
              onBlur={(event) => {
                touch(f.field);
                if (f.normalize) setField(f.field, f.normalize(event.target.value));
              }}
              onChange={(event) => setField(f.field, event.target.value)}
              placeholder={f.placeholder}
              spellCheck={false}
              value={value[f.field]}
            />
            {err ? (
              <span className="mt-2 block text-[12px] font-bold text-destructive" id={hintId} role="alert">
                {err}
              </span>
            ) : f.hint ? (
              <span className="mt-2 block text-[12px] font-semibold leading-[1.5] text-muted-foreground" id={hintId}>
                {f.hint}
              </span>
            ) : null}
          </label>
        );
      })}
      {sheet && !inlineNationality && !nationalityPopover ? (
        <NationalitySheet
          copy={copy}
          locale={locale}
          onClose={() => setSheet(false)}
          onPick={(code) => {
            set({ nationality: code });
            touch("nationality");
          }}
          value={value.nationality}
        />
      ) : null}
    </div>
  );
}
