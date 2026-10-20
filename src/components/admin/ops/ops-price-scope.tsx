"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPriceScopePrices } from "@/app/admin/ops/calendar/actions";
import type { PanelCell, PanelScopeSummary } from "@/components/admin/ops/ops-price-panel";
import {
  AdminDateRangePicker,
  type AdminDateRangePickerLabels,
} from "@/components/admin/shared/admin-date-range-picker";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import { buildOpsScopeSummary } from "@/lib/ops-scope-summary";
import {
  ALL_WEEKDAYS,
  expandPriceScope,
  priceScopeBounds,
  scopeFromCells,
  toggleWeekday,
  type PriceScope,
  type Weekday,
} from "@/lib/ops-price-scope";
import "./ops-price-scope.css";

/**
 * 가격 수정 범위 — **기간 · 요일 · 객실을 패널 안에서 고친다**(2026-10-20 사용자 요청 「Beds24 처럼」).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「가격 수정 범위 — 기간 · 요일 · 객실」
 *
 * - 처음 범위는 격자에서 고른 칸이다. **고치기 전까지는 고른 칸을 그대로 쓴다**(듬성듬성 고른 칸도 그대로).
 * - 기간 · 요일 · 객실 중 하나를 고치면 그 셋을 곱한 칸이 대상이 된다(`expandPriceScope`). 격자에 안 보이는 날짜의
 *   지금 가격은 서버에서 읽는다(`loadPriceScopePrices`) — 보낼 때는 서버가 어차피 다시 읽어 계산한다.
 * - 격자 선택이 바뀌면 고친 범위는 버리고 새 선택을 따른다.
 * - 데스크톱 패널(`OpsPricePanel`)과 모바일 시트(`MobileOpsPriceSheet`)가 같은 훅 · 같은 편집기를 쓴다. 날짜 고르기만 다르다 —
 *   콘솔은 공용 범위 달력(`AdminDateRangePicker`), 모바일은 앱 공용 날짜 시트(`DatePickerSheet`) 두 칸.
 */

export type PriceScopeCopy = {
  pscTitle: string;
  pscPeriod: string;
  pscWeekdays: string;
  pscRooms: string;
  pscRoomsCount: string;
  pscChange: string;
  pscFold: string;
  pscAll: string;
  pscReset: string;
  pscLoading: string;
  pscLoadFailed: string;
  pscTooLong: string;
  pscStart: string;
  pscEnd: string;
  andMore: string;
};

/** 범위에 넣을 수 있는 객실 — 격자 행. `roomIds` 가 빈 행(Beds24 유닛 없음)은 넘기지 않는다. */
export type PriceScopeRoom = {
  key: string;
  propertyName: string;
  displayRoomLabel: string;
  roomIds: string[];
};

const cellKey = (roomKey: string, date: string) => `${roomKey}|${date}`;

export type PriceScopeState = {
  /** 고친 범위. `null` = 격자에서 고른 칸 그대로. */
  scope: PriceScope | null;
  /** 지금 보여 줄 범위(고치기 전이면 고른 칸에서 만든 것). 고른 칸이 없으면 `null`. */
  shown: PriceScope | null;
  bounds: { min: string; max: string };
  edit: (next: PriceScope) => void;
  reset: () => void;
  /** 패널이 계산 · 목록 · 보내기에 쓸 칸. */
  cells: PanelCell[];
  summary: PanelScopeSummary | null;
  loading: boolean;
  failed: boolean;
  /** 고친 기간이 경계(오늘 ~ 1년 뒤)를 넘어 잘렸다. */
  clipped: boolean;
};

export function usePriceScope({
  andMore,
  cells: selectedCells,
  exclude,
  priceAt,
  rooms,
  summary: selectionSummary,
  today,
}: {
  andMore: string;
  /** 격자에서 고른 칸(패널이 원래 받던 것). */
  cells: PanelCell[];
  /** 범위를 펼칠 때 뺄 칸 — 모바일은 팔린 밤을 뺀다(격자에 보이는 날만 안다). */
  exclude?: (roomKey: string, date: string) => boolean;
  /** 격자가 아는 지금 가격. **격자 창 밖이면 `undefined`** — 그 칸은 서버에서 읽는다. */
  priceAt: (roomKey: string, date: string) => number | null | undefined;
  rooms: readonly PriceScopeRoom[];
  summary: PanelScopeSummary | null;
  today: string;
}): PriceScopeState {
  const [scope, setScope] = useState<PriceScope | null>(null);
  const [fetched, setFetched] = useState<ReadonlyMap<string, number | null>>(() => new Map());
  const [failedFor, setFailedFor] = useState<string | null>(null);

  // 격자 선택이 바뀌면 고친 범위를 버린다 — 새로 고른 칸이 우선이다. (렌더 중 비교 — 이펙트로 하면 한 번 옛 범위로 그린다.)
  const selectionSignature = useMemo(
    () => selectedCells.map((cell) => cellKey(cell.roomKey, cell.date)).join(","),
    [selectedCells],
  );
  const [seenSignature, setSeenSignature] = useState(selectionSignature);
  if (seenSignature !== selectionSignature) {
    setSeenSignature(selectionSignature);
    setScope(null);
  }

  const bounds = useMemo(() => priceScopeBounds(today), [today]);
  const roomByKey = useMemo(() => new Map(rooms.map((room) => [room.key, room])), [rooms]);
  const initial = useMemo(() => scopeFromCells(selectedCells), [selectedCells]);

  const expanded = useMemo(() => {
    if (!scope) return null;
    return expandPriceScope(scope, rooms, bounds).filter((cell) => !exclude?.(cell.roomKey, cell.date));
  }, [bounds, exclude, rooms, scope]);

  /** 격자 창 밖이라 서버에서 읽어야 하는 칸 중 아직 안 읽은 것. */
  const missing = useMemo(() => {
    if (!expanded) return [];
    return expanded.filter(
      (cell) => priceAt(cell.roomKey, cell.date) === undefined && !fetched.has(cellKey(cell.roomKey, cell.date)),
    );
  }, [expanded, fetched, priceAt]);
  const missingSignature = useMemo(() => {
    if (missing.length === 0) return "";
    // 칸 키 전부를 짧게 접는다(djb2) — 개수 · 처음 · 끝만 보면 가운데 객실 하나 바꾼 것을 놓친다.
    let hash = 5381;
    for (const cell of missing) {
      const key = cellKey(cell.roomKey, cell.date);
      for (let index = 0; index < key.length; index += 1) hash = ((hash << 5) + hash + key.charCodeAt(index)) | 0;
    }
    return `${missing.length}:${hash}`;
  }, [missing]);

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    // 기간을 끌어 고치는 동안 매번 묻지 않게 잠깐 기다린다.
    const timer = window.setTimeout(() => {
      void loadPriceScopePrices({
        cells: missing.map((cell) => ({
          date: cell.date,
          roomIds: roomByKey.get(cell.roomKey)?.roomIds ?? [],
          roomKey: cell.roomKey,
        })),
      })
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setFailedFor(missingSignature);
            return;
          }
          setFetched((previous) => {
            const next = new Map(previous);
            for (const cell of missing) {
              const key = cellKey(cell.roomKey, cell.date);
              next.set(key, result.prices[key] ?? null);
            }
            return next;
          });
        })
        .catch(() => {
          if (!cancelled) setFailedFor(missingSignature);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `missing` 는 같은 내용이어도 매 렌더 새 배열이다 — 내용 서명으로만 다시 묻는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSignature]);

  const cells = useMemo<PanelCell[]>(() => {
    if (!expanded) return selectedCells;
    return expanded.flatMap((cell) => {
      const room = roomByKey.get(cell.roomKey);
      if (!room || room.roomIds.length === 0) return [];
      const known = priceAt(cell.roomKey, cell.date);
      const price = known !== undefined ? known : (fetched.get(cellKey(cell.roomKey, cell.date)) ?? null);
      return [
        {
          date: cell.date,
          isGap: false,
          price,
          roomIds: room.roomIds,
          roomKey: cell.roomKey,
          roomLabel: room.displayRoomLabel,
        },
      ];
    });
  }, [expanded, fetched, priceAt, roomByKey, selectedCells]);

  const summary = useMemo<PanelScopeSummary | null>(() => {
    if (!scope) return selectionSummary;
    const base = buildOpsScopeSummary({
      andMore,
      rooms,
      selection: scope.roomKeys.map((roomKey) => ({ date: scope.from, roomKey })),
    });
    const short = (date: string) => date.slice(5).replace("-", "/");
    return {
      dates: scope.from === scope.to ? short(scope.from) : `${short(scope.from)} → ${short(scope.to)}`,
      rooms: base?.rooms ?? "",
    };
  }, [andMore, rooms, scope, selectionSummary]);

  const failed = failedFor !== null && failedFor === missingSignature;
  return {
    bounds,
    cells,
    clipped: !!scope && (scope.from < bounds.min || scope.to > bounds.max),
    edit: (next) => {
      setFailedFor(null);
      setScope(next);
    },
    failed,
    loading: missing.length > 0 && !failed,
    reset: () => setScope(null),
    scope,
    shown: scope ?? initial,
    summary,
  };
}

/** 요일 짧은 이름(도쿄 달력) — 2026-10-18 이 일요일. */
function weekdayLabels(localeTag: string): string[] {
  const format = new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", weekday: "short" });
  return ALL_WEEKDAYS.map((day) => format.format(new Date(Date.UTC(2026, 9, 18 + day, 3))));
}

/** `2026-10-24` → 「10/24 (토)」 — 패널 목록(`spwDate`)과 같은 모양. */
const shortDate = (date: string, localeTag: string) => {
  const weekday = new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", weekday: "short" }).format(
    new Date(`${date}T12:00:00+09:00`),
  );
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${weekday})`;
};

/**
 * 범위 편집기 — 패널 · 시트 머리 바로 아래. 기간 한 줄 · 요일 7칸 · 객실 요약(「바꾸기」를 누르면 건물별 객실 칸이 펼쳐진다).
 * 고친 뒤에는 「고른 칸으로 되돌리기」가 생긴다.
 */
export function PriceScopeEditor({
  copy,
  localeTag,
  mobileDateLabels,
  pickerLabels,
  rooms,
  state,
  today,
  variant,
}: {
  copy: PriceScopeCopy;
  localeTag: string;
  /** 모바일 날짜 시트 문구(`DatePickerSheet`). */
  mobileDateLabels?: { prevMonth: string; nextMonth: string; today: string };
  /** 콘솔 범위 달력 문구(`dictionary.admin.shared`). */
  pickerLabels?: AdminDateRangePickerLabels;
  rooms: readonly PriceScopeRoom[];
  state: PriceScopeState;
  today: string;
  variant: "desktop" | "mobile";
}) {
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const shown = state.shown;
  const labels = useMemo(() => weekdayLabels(localeTag), [localeTag]);
  const buildings = useMemo(() => {
    const out: { name: string; rooms: PriceScopeRoom[] }[] = [];
    const byName = new Map<string, PriceScopeRoom[]>();
    for (const room of rooms) {
      if (room.roomIds.length === 0) continue;
      let list = byName.get(room.propertyName);
      if (!list) {
        list = [];
        byName.set(room.propertyName, list);
        out.push({ name: room.propertyName, rooms: list });
      }
      list.push(room);
    }
    return out;
  }, [rooms]);
  if (!shown) return null;

  const edit = (patch: Partial<PriceScope>) => state.edit({ ...shown, ...patch });
  const picked = new Set(shown.roomKeys);
  const setRooms = (keys: Set<string>) => {
    // 마지막 객실은 빼지 않는다 — 0칸이면 아무것도 못 한다.
    if (keys.size === 0) return;
    edit({ roomKeys: rooms.filter((room) => keys.has(room.key)).map((room) => room.key) });
  };
  const toggleRoom = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRooms(next);
  };
  const toggleBuilding = (list: PriceScopeRoom[]) => {
    const next = new Set(picked);
    const allOn = list.every((room) => next.has(room.key));
    for (const room of list) {
      if (allOn) next.delete(room.key);
      else next.add(room.key);
    }
    setRooms(next);
  };
  const clamp = (date: string) => (date < state.bounds.min ? state.bounds.min : date > state.bounds.max ? state.bounds.max : date);

  return (
    <section aria-label={copy.pscTitle} className={`psc psc--${variant}`}>
      <div className="psc__head">
        <span>{copy.pscTitle}</span>
        {state.scope && (
          <button className="psc__link" onClick={state.reset} type="button">
            {copy.pscReset}
          </button>
        )}
      </div>

      <div className="psc__row">
        <span className="psc__label">{copy.pscPeriod}</span>
        {variant === "desktop" && pickerLabels ? (
          <AdminDateRangePicker
            ariaLabel={copy.pscPeriod}
            from={shown.from}
            isDateDisabled={(date) => date < state.bounds.min || date > state.bounds.max}
            labels={pickerLabels}
            localeTag={localeTag}
            onChange={(from, to) => {
              if (from && to) edit({ from, to });
            }}
            to={shown.to}
          />
        ) : (
          <div className="psc__dates">
            <button className="psc__date" onClick={() => setPicking("from")} type="button">
              <small>{copy.pscStart}</small>
              {shortDate(shown.from, localeTag)}
            </button>
            <span aria-hidden="true">–</span>
            <button className="psc__date" onClick={() => setPicking("to")} type="button">
              <small>{copy.pscEnd}</small>
              {shortDate(shown.to, localeTag)}
            </button>
          </div>
        )}
      </div>

      <div className="psc__row">
        <span className="psc__label">{copy.pscWeekdays}</span>
        <div aria-label={copy.pscWeekdays} className="psc__days" role="group">
          {ALL_WEEKDAYS.map((day) => {
            const on = shown.weekdays.includes(day);
            return (
              <button
                aria-pressed={on}
                className={`psc__day${on ? " on" : ""}${day === 0 ? " is-sun" : day === 6 ? " is-sat" : ""}`}
                key={day}
                onClick={() => edit({ weekdays: toggleWeekday(shown.weekdays, day as Weekday) })}
                type="button"
              >
                {labels[day]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="psc__row">
        <span className="psc__label">{copy.pscRooms}</span>
        <span className="psc__rooms">{copy.pscRoomsCount.replace("{n}", String(shown.roomKeys.length))}</span>
        <button aria-expanded={roomsOpen} className="psc__link" onClick={() => setRoomsOpen((open) => !open)} type="button">
          {roomsOpen ? copy.pscFold : copy.pscChange}
        </button>
      </div>
      {roomsOpen && (
        <div className="psc__picker">
          {buildings.map((building) => {
            const allOn = building.rooms.every((room) => picked.has(room.key));
            return (
              <div className="psc__bld" key={building.name}>
                <button
                  aria-pressed={allOn}
                  className={`psc__bldname${allOn ? " on" : ""}`}
                  onClick={() => toggleBuilding(building.rooms)}
                  type="button"
                >
                  {building.name} · {copy.pscAll}
                </button>
                <div className="psc__chips">
                  {building.rooms.map((room) => {
                    const on = picked.has(room.key);
                    return (
                      <button
                        aria-pressed={on}
                        className={`psc__chip${on ? " on" : ""}`}
                        key={room.key}
                        onClick={() => toggleRoom(room.key)}
                        type="button"
                      >
                        {room.displayRoomLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {state.loading && (
        <p className="psc__note" role="status">
          {copy.pscLoading}
        </p>
      )}
      {state.failed && (
        <p className="psc__note is-warn" role="alert">
          {copy.pscLoadFailed}
        </p>
      )}
      {state.clipped && <p className="psc__note is-warn">{copy.pscTooLong}</p>}

      {variant === "mobile" && picking && mobileDateLabels && (
        <DatePickerSheet
          labels={{ ...mobileDateLabels, title: picking === "from" ? copy.pscStart : copy.pscEnd }}
          locale={localeTag}
          onClose={() => setPicking(null)}
          onSelect={(date) => {
            const value = clamp(date);
            if (picking === "from") edit({ from: value, to: shown.to < value ? value : shown.to });
            else edit({ from: shown.from > value ? value : shown.from, to: value });
          }}
          today={today}
          value={picking === "from" ? shown.from : shown.to}
        />
      )}
    </section>
  );
}
