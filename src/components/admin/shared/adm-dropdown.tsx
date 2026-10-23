"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { dictionaries } from "@/lib/i18n";

export type AdmOption = {
  value: string;
  label: string;
  /** rich mode only: the mono permission_key shown on the left */
  key?: string;
  /** rich mode only: secondary description line */
  desc?: string;
};

type AdmDropdownProps = {
  options: AdmOption[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
  /**
   * 표시할 값이 없을 때 버튼에 남는 문구. 넘기지 않으면 로그인 사용자의 표시 언어로
   * `admin.shared.selectPlaceholder`("선택" / "選択" / "Select")를 쓴다 — 기본값을 한국어로
   * 하드코딩하면 ja/en 관리자에게 한국어가 노출되기 때문이다.
   */
  placeholder?: string;
  /** rich = permission-key picker (mono key + label + description) */
  rich?: boolean;
  wide?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  /**
   * 메뉴 안에 검색 입력을 넣는다. 등록자/담당자처럼 옵션이 수십 개로 늘어날 수 있는 필터용.
   * 첫 옵션(보통 "전체 …")은 검색어와 무관하게 항상 남겨 초기화 경로를 잃지 않는다.
   */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** 검색 결과가 없을 때 메뉴에 표시할 문구. */
  noResultLabel?: string;
  /**
   * 검색할 때 첫 옵션을 늘 남길지(기본 true — 「전체 …」 필터용). 방 · 사람처럼 첫 옵션이 그냥 한 항목인
   * 목록은 false 로 — 안 그러면 검색어와 무관한 첫 항목이 맨 위에 붙어 남는다(2026-10-23).
   */
  keepFirst?: boolean;
};

/**
 * The single shared admin dropdown that replaces the native <select> across every admin console
 * (users / attendance / cleaning / …). Matches the design-handoff `.dd` component; its CSS lives in
 * admin-console.css so all `.adm` pages pick it up. Self-manages open state with outside-click + Esc.
 * Do not add a second dropdown style — this is the one.
 */
export function AdmDropdown({
  options,
  value,
  onChange,
  size = "md",
  placeholder,
  rich = false,
  wide = false,
  ariaLabel,
  disabled = false,
  searchable = false,
  searchPlaceholder,
  noResultLabel,
  keepFirst = true,
}: AdmDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // 이 드롭다운은 19개 화면이 공유하는데 그중 절반 이상이 placeholder를 넘기지 않는다. 로케일을
  // prop으로 받으려면 호출부를 전부 고쳐야 하므로, 루트 레이아웃이 이미 제공하는 세션에서
  // 표시 언어를 읽어 사전 기본값을 고른다(SSR/CSR 모두 같은 값이라 하이드레이션도 안전하다).
  const { session } = useSession();
  const fallbackPlaceholder =
    dictionaries[session?.user.preferredLanguage ?? "ko"].admin.shared.selectPlaceholder;

  // 닫을 때는 검색어도 함께 비운다 — 다음에 열면 항상 전체 목록에서 시작한다.
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  useEffect(() => {
    if (open && searchable) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, searchable]);

  const current = options.find((option) => option.value === value);
  const label = current ? current.label : (placeholder ?? fallbackPlaceholder);

  const q = query.trim().toLowerCase();
  const head = keepFirst ? options[0] : undefined;
  const rest = keepFirst ? options.slice(1) : options;
  const filtered =
    searchable && q
      ? rest.filter((option) => option.label.toLowerCase().includes(q))
      : rest;
  const visible = searchable ? (head ? [head, ...filtered] : filtered) : options;

  return (
    <div className={`dd${open ? " open" : ""}${searchable ? " dd--search" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`dd__btn${size === "sm" ? " dd__btn--sm" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={`dd__val${current ? "" : " ph"}`}>{label}</span>
        <span className="ic dd__chev">
          <ChevronDown />
        </span>
      </button>
      {open ? (
        <div className={`dd__menu${wide ? " dd__menu--wide" : ""}`} role="listbox">
          {searchable ? (
            <div className="qsearch qsearch--dd">
              <span className="ic">
                <Search aria-hidden="true" />
              </span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                ref={searchRef}
                value={query}
              />
              {query ? (
                <button
                  aria-label={searchPlaceholder}
                  className="qsearch__clear"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  type="button"
                >
                  <span className="ic">
                    <X aria-hidden="true" />
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
          <div className={searchable ? "dd__scroll" : undefined}>
          {searchable && visible.length <= (keepFirst ? 1 : 0) && q ? <div className="ddnone">{noResultLabel}</div> : null}
          {visible.map((option) => {
            const on = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                className={`dd__opt${on ? " on" : ""}`}
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                {rich ? (
                  <span className="dd__opt__k">
                    <b>{option.label}</b>
                    {option.key ? <span className="dd__opt__key">{option.key}</span> : null}
                    {option.desc ? <small>{option.desc}</small> : null}
                  </span>
                ) : (
                  <span className="dd__opt__k">{option.label}</span>
                )}
                {on ? (
                  <span className="ic dd__chk">
                    <Check />
                  </span>
                ) : null}
              </button>
            );
          })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
