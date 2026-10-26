"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import { searchOpsReservations } from "@/actions/ops-calendar-search";
import type { OpsReservationPlacement } from "@/lib/ops-calendar";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";

/**
 * 어드민 상단 검색 — 고객명 · 예약번호 · 전화번호 → 판매 캘린더의 예약 상세 패널(2026-09-30).
 *
 * - 결과가 하나면 Enter 로 바로 연다. 동명이인 등 여럿이면 아래로 목록을 펼쳐 고르게 한다.
 * - 판매 캘린더 위에서는 이벤트로 그 자리에서 패널을 연다(`OPS_OPEN_RESERVATION_EVENT`).
 *   다른 화면에서는 `/admin/ops/calendar?resv=<id>` 로 넘어가 거기서 연다.
 * - 이름 매칭 규칙(띄어쓰기 · 성 순서 무관)은 `src/lib/guest-search.ts`.
 */

export const OPS_OPEN_RESERVATION_EVENT = "stayops:ops-open-reservation";
export const OPS_CALENDAR_PATH = "/admin/ops/calendar";

const DEBOUNCE_MS = 250;

export type AdminGuestSearchCopy = {
  placeholder: string;
  submit: string;
  clear: string;
  searching: string;
  empty: string;
  error: string;
  cancelled: string;
  nights: string;
  resultCount: string;
};

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function nightCount(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000));
}

/** 검색을 보낼 만한가 — 이름 두 글자 또는 번호 네 자리부터. */
function isSearchable(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.replace(/\s+/g, "").length >= 2;
}

export function AdminGuestSearch({ copy }: { copy: AdminGuestSearchCopy }) {
  const router = useRouter();
  const pathname = usePathname();
  // 건물 이름은 데이터(한국어 기준 이름) — 그릴 때만 지금 언어로(CLAUDE.md 다국어 규칙). 독채는 객실 라벨이 건물 이름이다.
  const buildingName = useBuildingName();
  const roomPlaceLabel = useRoomPlaceLabel();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpsReservationPlacement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 늦게 온 응답이 새 검색어의 결과를 덮지 않게. */
  const requestRef = useRef(0);

  function runSearch(value: string) {
    const requestId = ++requestRef.current;
    startTransition(async () => {
      const response = await searchOpsReservations(value).catch(() => null);
      if (requestId !== requestRef.current) return;
      if (!response || !response.ok) {
        setFailed(true);
        setResults([]);
        return;
      }
      setFailed(false);
      setResults(response.results);
      setActive(0);
    });
  }

  useEffect(() => {
    if (!isSearchable(query)) {
      requestRef.current += 1;
      return;
    }
    const timer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // ⌘K / Ctrl+K — 어디서든 검색창으로.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function openReservation(placement: OpsReservationPlacement) {
    setOpen(false);
    inputRef.current?.blur();
    if (pathname?.startsWith(OPS_CALENDAR_PATH)) {
      window.dispatchEvent(new CustomEvent(OPS_OPEN_RESERVATION_EVENT, { detail: placement }));
      return;
    }
    router.push(`${OPS_CALENDAR_PATH}?resv=${encodeURIComponent(placement.bar.id)}`);
  }

  function submit() {
    if (!isSearchable(query)) return;
    setOpen(true);
    const list = results ?? [];
    // 결과가 하나뿐이면 목록을 거치지 않고 바로 연다.
    if (!pending && list.length === 1) openReservation(list[0]);
    else if (!pending && list.length > 1) openReservation(list[active] ?? list[0]);
    else if (results === null) runSearch(query);
  }

  function clear() {
    requestRef.current += 1;
    setQuery("");
    setResults(null);
    setFailed(false);
    setOpen(false);
    inputRef.current?.focus();
  }

  const searchable = isSearchable(query);
  const list = searchable ? (results ?? []) : [];
  const showMenu = open && searchable && (pending || results !== null);

  return (
    <div className={`search gsearch${showMenu ? " open" : ""}`} ref={rootRef}>
      <span className="ic"><Search /></span>
      <input
        ref={inputRef}
        aria-autocomplete="list"
        aria-controls="adm-guest-search-list"
        aria-expanded={showMenu}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!isSearchable(event.target.value)) setResults(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            setOpen(false);
          } else if (event.key === "ArrowDown" && list.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(list.length - 1, index + 1));
          } else if (event.key === "ArrowUp" && list.length > 0) {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          }
        }}
        placeholder={copy.placeholder}
        role="combobox"
        type="text"
        value={query}
      />
      <span className="gsearch__tail">
        {query ? (
          <button aria-label={copy.clear} className="gsearch__clear" onClick={clear} type="button">
            <X aria-hidden="true" />
          </button>
        ) : null}
        <button
          aria-label={copy.submit}
          className="gsearch__go"
          disabled={!searchable}
          onClick={submit}
          type="button"
        >
          <CornerDownLeft aria-hidden="true" />
        </button>
      </span>

      {showMenu ? (
        <div className="gsearch__menu" id="adm-guest-search-list" role="listbox">
          {pending && results === null ? (
            <div className="gsearch__note">{copy.searching}</div>
          ) : failed ? (
            <div className="gsearch__note">{copy.error}</div>
          ) : list.length === 0 ? (
            <div className="gsearch__note">{pending ? copy.searching : copy.empty}</div>
          ) : (
            <>
              <div className="gsearch__head">
                {copy.resultCount.replace("{count}", String(list.length))}
                {pending ? <span className="gsearch__spin">{copy.searching}</span> : null}
              </div>
              <div className="gsearch__scroll">
                {list.map((item, index) => (
                  <button
                    aria-selected={index === active}
                    className={`gsearch__opt${index === active ? " on" : ""}${item.bar.isCancelled ? " is-cancelled" : ""}`}
                    key={item.bar.id}
                    onClick={() => openReservation(item)}
                    onMouseEnter={() => setActive(index)}
                    role="option"
                    type="button"
                  >
                    <span className={`gsearch__dot gsearch__dot--${item.bar.channel}`} aria-hidden="true" />
                    <span className="gsearch__main">
                      <b>{item.bar.guestName || "—"}</b>
                      <small>
                        {buildingName(item.propertyName)} · {roomPlaceLabel(item.roomLabel)}
                      </small>
                    </span>
                    <span className="gsearch__when">
                      <b>
                        {shortDate(item.bar.checkIn)} → {shortDate(item.bar.checkOut)}
                      </b>
                      <small>
                        {item.bar.isCancelled
                          ? copy.cancelled
                          : copy.nights.replace("{count}", String(nightCount(item.bar.checkIn, item.bar.checkOut)))}{" "}
                        · {item.bar.checkIn.slice(0, 4)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
