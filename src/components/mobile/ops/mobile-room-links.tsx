"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink, Search } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";
import type { RoomLinkBuildingView, RoomLinkRowView, RoomLinksPageData, RoomLinkUnitView } from "@/lib/room-links";
import "./mobile-room-links.css";

/**
 * 모바일 룸 링크 — 화이트 리디자인(2026-10-15, 시안 Links-Phone · LinksSheet-Phone · Links-Fold · Links-Tablet).
 *
 * 도메인 계약: docs/product/35-room-links.md → 「모바일」
 *
 * 흰 바탕 · 상자 없음. 위에서 건물 글자 탭을 고르면 건물 머리(주소 · 지도 · Booking.com — 건물 단위)가 한 번, 아래는 객실
 * 줄. 줄 오른쪽 「복사」는 **판매 중 계정의 게스트 링크**를 바로 복사하고, 줄을 누르면 표준 바텀시트에 계정별 상세(판매 중
 * 계정이 맨 위 · 큰 「게스트 링크 복사」 · 「게스트 페이지 ↗」 「호스트 편집 ↗」). 고치기는 대시보드에서 한다(여기엔 편집이 없다).
 *
 * **넓은 화면**(셸의 폭 구간과 같다 — `globals.css` `fold:` · `tablet:`):
 * - 펼친 폴드 · 태블릿 세로(≥ 600): 폰과 같은 한 줄, 가운데 540px. 상세는 바텀시트(셸이 가운데 카드로 띄운다).
 * - 태블릿 가로(≥ 1000 · 높이 ≥ 600): **왼쪽 건물 목록 · 가운데 건물 머리 + 객실 · 오른쪽 상세 칸** — 시트를 쓰지 않는다.
 */
type Copy = Dictionary["roomLinks"];

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);

/** 마지막 수정 날짜 — 도쿄 기준 「10/2」(세 언어 모두 같은 모양). */
const shortDate = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "numeric", timeZone: "Asia/Tokyo" });

const COPIED_MS = 1600;

type Selected = { building: RoomLinkBuildingView; row: RoomLinkRowView };

/** 줄의 「복사」가 가리키는 계정 — 지금 판매 중인 유닛. 유닛이 하나뿐이면 그 유닛. */
function copyTarget(row: RoomLinkRowView): RoomLinkUnitView | null {
  return row.units.find((unit) => unit.selling) ?? (row.units.length === 1 ? row.units[0] : null);
}

const unitKey = (unit: RoomLinkUnitView) => `unit:${unit.roomId}`;

export function MobileRoomLinks({ data, copy }: { data: RoomLinksPageData; copy: Copy }) {
  const m = copy.mWhite;
  const isTablet = useIsTablet();
  const [buildingIndex, setBuildingIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const duplicates = useMemo(() => new Set(data.duplicateListingIds), [data.duplicateListingIds]);

  const copyLink = async (key: string, url: string | null | undefined) => {
    if (!url) return;
    haptic("light");
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // 복사가 막힌 브라우저 — 「게스트 페이지 ↗」로 열어서 쓴다.
    }
    setCopiedKey(key);
    setLive(copy.copied);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopiedKey(null);
      setLive("");
    }, COPIED_MS);
  };

  const totals = useMemo(() => {
    const rows = data.buildings.flatMap((building) => building.rows);
    const noGuest = rows.filter((row) => {
      const target = copyTarget(row);
      return target && !target.airbnb?.guestUrl;
    }).length;
    return { noGuest, rooms: rows.length };
  }, [data.buildings]);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return [];
    return data.buildings.flatMap((building) =>
      building.rows
        .filter((row) =>
          [
            building.name,
            row.label,
            ...row.units.flatMap((unit) => [unit.unitLabel, unit.airbnb?.listingId, unit.airbnb?.guestUrl]),
          ].some((value) => value && value.toLowerCase().includes(needle)),
        )
        .map((row) => ({ building, row })),
    );
  }, [data.buildings, needle]);

  const head = (
    <header className="mrl-h">
      <div className="mrl-h__t">
        <h1>{copy.title}</h1>
        <p>
          {fill(m.sumRooms, { n: totals.rooms })}
          {totals.noGuest > 0 && (
            <>
              {" · "}
              {m.sumNoGuest} <b className="is-bad">{totals.noGuest}</b>
            </>
          )}
        </p>
      </div>
      <label className="mrl-search">
        <Search aria-hidden="true" />
        <input
          aria-label={copy.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          type="search"
          value={query}
        />
      </label>
    </header>
  );

  if (data.buildings.length === 0) {
    return (
      <div className="mrl mrl-v">
        {head}
        <div className="mrl-empty">{copy.noRooms}</div>
      </div>
    );
  }

  const building = data.buildings[Math.min(buildingIndex, data.buildings.length - 1)];
  // 태블릿 가로는 오른쪽 칸이 늘 무언가를 보인다 — 고른 객실, 없으면 지금 건물의 첫 객실.
  const paneSelection: Selected | null =
    selected ?? (building.rows[0] ? { building, row: building.rows[0] } : null);
  const isOn = (row: RoomLinkRowView) => isTablet && paneSelection?.row.key === row.key;
  const pickBuilding = (index: number) => {
    setQuery("");
    setBuildingIndex(index);
    setSelected(null);
  };

  const row = (owner: RoomLinkBuildingView, item: RoomLinkRowView, index: number, showBuilding: boolean) => (
    <RoomRow
      building={showBuilding ? owner.name : undefined}
      copiedKey={copiedKey}
      duplicates={duplicates}
      index={index}
      key={item.key}
      m={m}
      noGuest={copy.guestMissing}
      on={isOn(item)}
      onCopy={copyLink}
      onOpen={() => setSelected({ building: owner, row: item })}
      row={item}
    />
  );

  const detail = (target: Selected) => (
    <RoomDetail
      copiedKey={copiedKey}
      copy={copy}
      duplicates={duplicates}
      key={target.row.key}
      onCopy={copyLink}
      selection={target}
    />
  );

  return (
    <div className="mrl mrl-v">
      {head}

      <div className="mrl-body">
        <div aria-label={copy.buildings} className="mrl-tabs" data-swipe-back="off" role="tablist">
          {data.buildings.map((item, index) => {
            const on = !needle && index === buildingIndex;
            return (
              <button
                aria-selected={on}
                className={`mrl-tab${on ? " is-on" : ""}`}
                key={item.name}
                onClick={() => pickBuilding(index)}
                role="tab"
                type="button"
              >
                <span className="mrl-tab__n">{item.name}</span>
                <b>{item.rows.reduce((sum, r) => sum + r.units.length, 0)}</b>
              </button>
            );
          })}
        </div>

        <div className="mrl-main">
          {needle ? (
            <>
              <div className="mrl-sec">
                {copy.searchResults} · {fill(copy.resultCount, { n: results.length })}
              </div>
              <div className="mrl-list" key={`q:${needle}`}>
                {results.map(({ building: owner, row: item }, index) => row(owner, item, index, true))}
                {results.length === 0 && <div className="mrl-empty">{copy.noResults}</div>}
              </div>
            </>
          ) : (
            <>
              <BuildingHead building={building} copiedKey={copiedKey} copy={copy} key={`h:${building.name}`} onCopy={copyLink} />
              <div className="mrl-list" key={`b:${building.name}`}>
                {building.rows.map((item, index) => row(building, item, index, false))}
                {building.rows.length === 0 && <div className="mrl-empty">{copy.noRooms}</div>}
              </div>
            </>
          )}
        </div>

        {/* 태블릿 가로 — 시트 대신 오른쪽 칸. 객실이 바뀌면 살짝 바뀌어 들어온다(key). */}
        {isTablet && paneSelection && <aside className="mrl-pane">{detail(paneSelection)}</aside>}
      </div>

      {!isTablet && selected && (
        <BottomSheet
          ariaLabel={`${selected.building.name} ${selected.row.label}`}
          className="flex max-h-[86dvh] flex-col"
          onClose={() => setSelected(null)}
        >
          {detail(selected)}
        </BottomSheet>
      )}

      {/* 복사 결과는 버튼이 「✓ 복사됨」으로 직접 보인다 — 화면 읽기 프로그램에만 한 줄. */}
      <div aria-live="polite" className="sr-only" role="status">
        {live}
      </div>
    </div>
  );
}

/** 「숙소 ID {id}」 같은 문구에서 값만 고정폭 글꼴로 — 값의 자리는 언어마다 문구가 정한다. */
function WithMono({ template, value }: { template: string; value: string }) {
  const [before, after = ""] = template.split("{id}");
  return (
    <>
      {before}
      <span className="mrl-mono">{value}</span>
      {after}
    </>
  );
}

function CopiedLabel({ label }: { label: string }) {
  return (
    <>
      <svg aria-hidden="true" className="mrl-check" fill="none" height="14" viewBox="0 0 24 24" width="14">
        <path d="M5 12l5 5 9-10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
      </svg>
      {label}
    </>
  );
}

function RoomRow({
  row,
  building,
  index,
  on,
  m,
  noGuest,
  duplicates,
  copiedKey,
  onCopy,
  onOpen,
}: {
  row: RoomLinkRowView;
  building?: string;
  index: number;
  on: boolean;
  m: Copy["mWhite"];
  noGuest: string;
  duplicates: Set<string>;
  copiedKey: string | null;
  onCopy: (key: string, url: string | null | undefined) => void;
  onOpen: () => void;
}) {
  const target = copyTarget(row);
  const guest = target?.airbnb?.guestUrl ?? null;
  const dup = row.units.some((unit) => unit.airbnb?.listingId && duplicates.has(unit.airbnb.listingId));
  const copied = target ? copiedKey === unitKey(target) : false;
  return (
    <div className={`mrl-row${on ? " is-on" : ""}`} style={{ ["--i" as string]: Math.min(index, 12) }}>
      <button aria-pressed={on} className="mrl-row__open" onClick={onOpen} type="button">
        <span className="mrl-row__n">{row.label}</span>
        <span className="mrl-row__sub">
          {building && <span className="mrl-row__b">{building} · </span>}
          {!target ? (
            <span className="mrl-row__idle">{row.units.map((unit) => unit.unitLabel).join(" · ")}</span>
          ) : guest ? (
            <span className="is-ok">{fill(m.unitSelling, { u: target.unitLabel })}</span>
          ) : (
            <span className="is-bad">{noGuest}</span>
          )}
          {dup && <span className="mrl-row__dup">{m.idDuplicate}</span>}
        </span>
      </button>
      {guest && target && (
        <button
          aria-label={fill(m.copyRoomAria, { room: row.label })}
          className={`mrl-copy${copied ? " is-done" : ""}`}
          onClick={() => onCopy(unitKey(target), guest)}
          type="button"
        >
          {copied ? <CopiedLabel label={m.copied} /> : m.copyShort}
        </button>
      )}
      <ChevronRight aria-hidden="true" className="mrl-chev" />
    </div>
  );
}

function BuildingHead({
  building,
  copy,
  copiedKey,
  onCopy,
}: {
  building: RoomLinkBuildingView;
  copy: Copy;
  copiedKey: string | null;
  onCopy: (key: string, url: string | null | undefined) => void;
}) {
  const m = copy.mWhite;
  const booking = building.booking;
  const key = `booking:${building.name}`;
  const listings = building.rows.reduce((sum, row) => sum + row.units.length, 0);
  return (
    <section className="mrl-bh">
      <div className="mrl-bh__t">
        <h2>{building.name}</h2>
        <span>{fill(m.buildingCounts, { listings, rooms: building.rows.length })}</span>
      </div>
      {building.address && (
        <p className="mrl-bh__addr">
          {building.address}
          {building.mapUrl && (
            <>
              {" · "}
              <a href={building.mapUrl} rel="noopener noreferrer" target="_blank">
                {m.map}
              </a>
            </>
          )}
        </p>
      )}
      <div className="mrl-bk">
        <span className="mrl-ch is-b">
          <i aria-hidden="true" />
          Booking.com
        </span>
        {booking ? (
          <>
            {booking.listingId && (
              <span className="mrl-bk__id">
                <WithMono template={copy.hotelId} value={booking.listingId} />
              </span>
            )}
            <span className="mrl-bk__wide">{copy.buildingWide}</span>
          </>
        ) : (
          <span className="mrl-bk__wide">{m.bookingNone}</span>
        )}
      </div>
      {booking && (
        <div className="mrl-bk__acts">
          {booking.hostUrl && (
            <a className="mrl-tl" href={booking.hostUrl} rel="noopener noreferrer" target="_blank">
              {copy.extranet}
              <ExternalLink aria-hidden="true" />
            </a>
          )}
          {booking.guestUrl ? (
            <>
              <a className="mrl-tl" href={booking.guestUrl} rel="noopener noreferrer" target="_blank">
                {m.guestPage}
                <ExternalLink aria-hidden="true" />
              </a>
              <button
                className={`mrl-copy is-sm${copiedKey === key ? " is-done" : ""}`}
                onClick={() => onCopy(key, booking.guestUrl)}
                type="button"
              >
                {copiedKey === key ? <CopiedLabel label={m.copied} /> : m.copyShort}
              </button>
            </>
          ) : (
            <span className="mrl-bk__miss">{m.guestPageMissing}</span>
          )}
        </div>
      )}
    </section>
  );
}

/** 객실 상세 — 폰 · 폴드는 바텀시트 안, 태블릿 가로는 오른쪽 칸. 판매 중 계정이 맨 위. */
function RoomDetail({
  selection,
  copy,
  copiedKey,
  duplicates,
  onCopy,
}: {
  selection: Selected;
  copy: Copy;
  copiedKey: string | null;
  duplicates: Set<string>;
  onCopy: (key: string, url: string | null | undefined) => void;
}) {
  const m = copy.mWhite;
  const units = [...selection.row.units].sort((a, b) => Number(b.selling) - Number(a.selling));
  const lastEdited = units
    .map((unit) => unit.airbnb?.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return (
    <div className="mrl-v mrl-d">
      <div className="mrl-d__head">
        <span className="mrl-d__b">{selection.building.name}</span>
        <b className="mrl-mono">{selection.row.label}</b>
        <span className="mrl-d__sub">{fill(m.sheetSub, { n: units.length })}</span>
      </div>
      <div className="mrl-d__body">
        {units.map((unit) => {
          const link = unit.airbnb;
          const guest = link?.guestUrl ?? null;
          const key = unitKey(unit);
          const copied = copiedKey === key;
          const dup = Boolean(link?.listingId && duplicates.has(link.listingId));
          return (
            <section className="mrl-u" key={unit.roomId}>
              <div className="mrl-u__t">
                <b className="mrl-mono">{unit.unitLabel}</b>
                {unit.selling ? (
                  <span className="mrl-u__on">
                    <i aria-hidden="true" />
                    {m.sellingNow}
                  </span>
                ) : (
                  <span className="mrl-u__off">{m.resting}</span>
                )}
              </div>
              <div className="mrl-u__l">
                <span className="mrl-ch is-a">
                  <i aria-hidden="true" />
                  Airbnb
                </span>
                {link?.listingId && (
                  <span className="mrl-u__id">
                    <WithMono template={copy.listingId} value={link.listingId} />
                  </span>
                )}
                {dup && <span className="mrl-row__dup">{m.idDuplicate}</span>}
              </div>
              {guest ? <div className="mrl-u__url">{guest}</div> : <div className="mrl-u__url is-bad">{copy.guestMissing}</div>}
              {guest && (
                <button
                  className={`mrl-big${unit.selling ? " is-pri" : ""}${copied ? " is-done" : ""}`}
                  onClick={() => onCopy(key, guest)}
                  type="button"
                >
                  {copied ? <CopiedLabel label={m.copied} /> : m.copyGuest}
                </button>
              )}
              {(guest || link?.hostUrl) && (
                <div className="mrl-u__links">
                  {guest && (
                    <a className="mrl-tl" href={guest} rel="noopener noreferrer" target="_blank">
                      {m.guestPage}
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                  {link?.hostUrl && (
                    <a className="mrl-tl is-ink" href={link.hostUrl} rel="noopener noreferrer" target="_blank">
                      {m.hostEdit}
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                </div>
              )}
              {link?.memo && <p className="mrl-u__memo">{link.memo}</p>}
            </section>
          );
        })}
        {lastEdited && <p className="mrl-d__foot">{fill(m.lastEdited, { d: shortDate.format(new Date(lastEdited)) })}</p>}
      </div>
    </div>
  );
}
