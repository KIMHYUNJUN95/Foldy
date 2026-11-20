"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { dictionaries } from "@/lib/i18n";
import "./adm-dropdown.css";

export type AdmOption = {
  value: string;
  label: string;
  /** rich 모드 전용: 왼쪽에 표시되는 고정폭 permission_key */
  key?: string;
  /** rich 모드 전용: 보조 설명 줄 */
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
  /** rich = 권한 키 선택기(고정폭 키 + 라벨 + 설명) */
  rich?: boolean;
  wide?: boolean;
  ariaLabel?: string;
  /** 칸 아래 오류 · 안내 줄의 id — 단추에 `aria-describedby` 로 붙는다(설정 › 급여, 2026-11-20). 단추 역할은 aria-invalid 를 받지 않아 오류 표시는 그 줄(role="alert")이 한다. */
  ariaDescribedBy?: string;
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
  /** 메뉴가 열리는 방향. 화면 아래에 붙은 입력줄(답장 작성기 등)은 "up". */
  placement?: "down" | "up";
};

/** 내용 폭 메뉴가 뷰포트 오른쪽 여백(8px)을 넘으면 오른쪽 맞춤으로 뒤집어야 한다. */
export function menuOverflowsRight(menuRight: number, viewportWidth: number): boolean {
  return menuRight > viewportWidth - 8;
}

/** 모바일(`.dd-scope`) 메뉴를 뷰포트 좌우 8px 안에 두는 가로 이동(px, 왼쪽으로 음수). 좁은 폰에서 오른쪽 맞춤만으로는 왼쪽이 잘릴 수 있다. */
export function menuShiftX(menuLeft: number, menuWidth: number, viewportWidth: number): number {
  const overflow = menuLeft + menuWidth - (viewportWidth - 8);
  if (overflow <= 0) return 0;
  return -Math.min(overflow, Math.max(0, menuLeft - 8));
}

/**
 * 모바일(`.dd-scope`) 메뉴의 세로 자리 — 아래 자리(탭바 위까지)가 모자라고 위가 더 넓으면 위로 열고,
 * 고른 쪽 자리만큼 높이를 묶는다(넘치면 메뉴 안에서 스크롤). 양쪽 다 좁아도 120px(메뉴가 더 작으면 그 높이) 밑으로는 줄이지 않는다.
 */
const MENU_MIN_HEIGHT = 120;

export function menuVerticalPlan(opts: {
  menuHeight: number;
  triggerTop: number;
  triggerBottom: number;
  viewportTop: number;
  viewportBottom: number;
}): { up: boolean; maxHeight: number } {
  const gap = 6 + 8;
  const below = opts.viewportBottom - opts.triggerBottom - gap;
  const above = opts.triggerTop - opts.viewportTop - gap;
  const up = opts.menuHeight > below && above > below;
  const floor = Math.min(MENU_MIN_HEIGHT, opts.menuHeight);
  return { up, maxHeight: Math.max(floor, Math.floor(up ? above : below)) };
}

/** 열 때 한 번 재서 `.dd__menu--end` 를 붙인다 — 그리기 전에 클래스만 붙여 깜빡임 · 재렌더 없음. `.dd__menu` 를 직접 그리는 곳도 같이 쓴다. */
export function useDdMenuEdgeFlip(menuRef: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    // 모바일(`.dd-scope`)은 탭바 · 화면 끝을 피해 위로 뒤집고 가로로 밀어 넣는다. 관리자 콘솔은 예전 그대로(오른쪽 맞춤만).
    if (menu.closest(".dd-scope")) {
      const trigger = menu.parentElement?.getBoundingClientRect();
      const tabbar = document.querySelector("nav.tabbar")?.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewportTop = vv?.offsetTop ?? 0;
      let viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      if (tabbar && tabbar.height > 0 && tabbar.top < viewportBottom) viewportBottom = tabbar.top;
      if (trigger) {
        const plan = menuVerticalPlan({ menuHeight: menu.scrollHeight, triggerTop: trigger.top, triggerBottom: trigger.bottom, viewportTop, viewportBottom });
        if (plan.up) menu.classList.add("dd__menu--up");
        menu.style.maxHeight = `${plan.maxHeight}px`;
      }
      const rect = menu.getBoundingClientRect();
      const shift = menuShiftX(rect.left, rect.width, window.innerWidth);
      if (shift) menu.style.left = `${shift}px`;
      return;
    }
    if (menuOverflowsRight(menu.getBoundingClientRect().right, window.innerWidth)) menu.classList.add("dd__menu--end");
  }, [menuRef, open]);
}

/** 열린 메뉴에서 화살표 · Home · End 로 옮길 다음 옵션 위치(끝에서 멈춤). current -1 = 목록 밖(검색 입력). */
export function nextOptionIndex(key: string, current: number, count: number): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return current <= 0 ? 0 : current - 1;
  return current;
}

/** 검색형에서 첫 옵션 위로 ↑ 하면 검색 입력으로 돌아간다. */
export function returnsToSearch(key: string, current: number, searchable: boolean): boolean {
  return searchable && key === "ArrowUp" && current === 0;
}

export function ddMenuClassName(opts: { wide: boolean; placement: "down" | "up"; instant: boolean; end?: boolean }): string {
  return `dd__menu${opts.wide ? " dd__menu--wide" : ""}${opts.end ? " dd__menu--end" : ""}${opts.placement === "up" ? " dd__menu--up" : ""}${opts.instant ? " dd__menu--instant" : ""}`;
}

/**
 * 모든 관리자 콘솔(사용자 / 근태 / 청소 / …)에서 네이티브 <select> 를 대체하는
 * 단일 공용 관리자 드롭다운. 디자인 핸드오프의 `.dd` 컴포넌트와 같으며, CSS 는
 * admin-console.css 에 있어 모든 `.adm` 페이지가 가져다 쓴다. `/mobile` 화면은 감싸는 칸에 `.dd-scope` 를 붙여
 * 같은 것을 쓴다(2026-11-16 — 네이티브 <select> 대신). 바깥 클릭 + Esc 로 열림 상태를 스스로 관리한다.
 * 두 번째 드롭다운 스타일을 추가하지 말 것 — 이것이 유일한 것이다.
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
  ariaDescribedBy,
  disabled = false,
  searchable = false,
  searchPlaceholder,
  noResultLabel,
  keepFirst = true,
  placement = "down",
}: AdmDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 키보드로 연 메뉴는 등장 애니메이션을 건너뛴다(반복 동작에 움직임을 붙이지 않는다).
  const [instant, setInstant] = useState(false);
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
    function onDocClick(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    }
    // 캡처 단계에서 가로채 바깥 패널 · 모달의 document Esc 가 같이 닫히지 않게 한다.
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return; // IME 변환 취소 Esc 는 건드리지 않는다
      event.preventDefault();
      event.stopPropagation();
      close();
      btnRef.current?.focus();
    }
    // pointerdown — iOS 는 누를 수 없는 자리를 탭하면 mousedown 을 보내지 않아 바깥 탭으로 안 닫혔다.
    document.addEventListener("pointerdown", onDocClick);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDocClick);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [close, open]);

  useDdMenuEdgeFlip(menuRef, open);

  function optionEls(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
  }

  useEffect(() => {
    if (!open) return;
    if (searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    const els = optionEls();
    // 마우스로 열 땐 포커스가 스크롤 영역을 끌고 가지 않게 한다.
    (els.find((el) => el.getAttribute("aria-selected") === "true") ?? els[0])?.focus({ preventScroll: !instant });
  }, [open, searchable, instant]);

  function onRootKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const { key } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        setInstant(true);
        setOpen(true);
      }
      return;
    }
    if (key === "Tab") {
      // 포커스를 먼저 버튼으로 돌려 두면 Tab 이 그 자리에서 자연스럽게 다음 칸으로 간다.
      btnRef.current?.focus();
      close();
      return;
    }
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    if (event.target instanceof HTMLInputElement && (key === "Home" || key === "End" || key === "ArrowUp")) return;
    event.preventDefault();
    const els = optionEls();
    const index = els.indexOf(document.activeElement as HTMLButtonElement);
    if (returnsToSearch(key, index, searchable)) {
      searchRef.current?.focus();
      return;
    }
    els[nextOptionIndex(key, index, els.length)]?.focus();
  }

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
    <div
      className={`dd${open ? " open" : ""}${searchable ? " dd--search" : ""}`}
      ref={rootRef}
      onKeyDown={onRootKeyDown}
    >
      <button
        type="button"
        ref={btnRef}
        className={`dd__btn${size === "sm" ? " dd__btn--sm" : ""}`}
        onClick={(event) => {
          if (open) {
            close();
            return;
          }
          // detail 0 = Enter/Space 로 일으킨 클릭
          setInstant(event.detail === 0);
          setOpen(true);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
      >
        <span className={`dd__val${current ? "" : " ph"}`}>{label}</span>
        <span className="ic dd__chev">
          <ChevronDown />
        </span>
      </button>
      {open ? (
        <div className={ddMenuClassName({ wide, placement, instant })} role="listbox" ref={menuRef}>
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
                tabIndex={-1}
                aria-selected={on}
                onClick={() => {
                  onChange(option.value);
                  close();
                  btnRef.current?.focus();
                }}
              >
                {rich ? (
                  <span className="dd__opt__k">
                    <b>{option.label}</b>
                    {option.key ? <span className="dd__opt__key">{option.key}</span> : null}
                    {option.desc ? <small>{option.desc}</small> : null}
                  </span>
                ) : (
                  <span className="dd__opt__k" title={typeof option.label === "string" ? option.label : undefined}>{option.label}</span>
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
