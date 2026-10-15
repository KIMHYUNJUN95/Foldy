"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Search } from "lucide-react";
import {
  saveBuildingListingLink,
  saveRoomListingLink,
  type SaveRoomLinkResult,
} from "@/app/admin/ops/room-links/actions";
import type { Dictionary } from "@/lib/i18n";
import type {
  RoomLinkBuildingView,
  RoomLinksPageData,
  RoomLinkRowView,
  RoomLinkUnitView,
  RoomLinkView,
} from "@/lib/room-links";
import type { RoomLinkChannel } from "@/lib/room-links-model";
import "./room-links-white.css";

/**
 * 룸 링크 콘솔 — 화이트 리디자인(2026-10-15, 시안 Links-PC).
 *
 * 도메인 계약: docs/product/35-room-links.md 「화면」
 *
 * 건물 목록 → 가운데 객실 표(객실 · 유닛 · 게스트 링크 · 바로 하기) → 오른쪽 상세. 표에서 판매 중 계정의 게스트 링크를
 * 바로 복사하고, 상세에서 유닛마다 링크를 고친다. Booking.com 은 건물 단위라 가운데 건물 머리에 있다.
 * 저장은 서버 액션이 권한 · 조직 · 입력을 다시 본다 — 여기 검사는 편의다.
 */
type Copy = Dictionary["roomLinks"];
type White = Copy["white"];

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);

/** 주소에서 스킴 · www 를 떼어 짧게 보여 준다(원문은 링크가 쓴다). */
function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/** 판매 중 계정이 위 — 같으면 원래(캘린더) 순서. */
function orderUnits(row: RoomLinkRowView) {
  return [...row.units].sort((a, b) => Number(b.selling) - Number(a.selling));
}

/** 표의 복사 · 링크 넣기가 가리키는 유닛 — 지금 판매 중인 계정, 없으면 첫 유닛. */
function primaryUnit(row: RoomLinkRowView) {
  return row.units.find((unit) => unit.selling) ?? row.units[0];
}

/** 도쿄 기준 「월/일」 — 마지막 수정 표시. */
const tokyoMonthDay = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "numeric", timeZone: "Asia/Tokyo" });

const COPY_FEEDBACK_MS = 1600;

type Selection = { building: number; row: number };
/** 열려 있는 편집 폼 — 건물 Booking.com(`booking:<건물>`) 또는 유닛(roomId). */
type EditTarget = string | null;

export function RoomLinksConsole({ data, copy }: { data: RoomLinksPageData; copy: Copy }) {
  const w = copy.white;
  const [selection, setSelection] = useState<Selection>({ building: 0, row: 0 });
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EditTarget>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  const duplicates = useMemo(() => new Set(data.duplicateListingIds), [data.duplicateListingIds]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 1800);
  };

  /** 복사하면 그 버튼이 1.6초 동안 「✓ 복사됨」 — 토스트는 띄우지 않는다(버튼이 말한다). */
  const copyLink = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // 복사가 막힌 브라우저 — 「게스트 페이지 ↗」로 열어서 쓴다.
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    setCopiedKey(key);
    setLive(w.copiedLive);
    copyTimer.current = window.setTimeout(() => {
      setCopiedKey(null);
      setLive("");
    }, COPY_FEEDBACK_MS);
  };

  const all = useMemo(
    () =>
      data.buildings.flatMap((building, buildingIndex) =>
        building.rows.map((row, rowIndex) => ({ building, buildingIndex, row, rowIndex })),
      ),
    [data.buildings],
  );
  const totals = useMemo(() => {
    const units = all.flatMap((entry) => entry.row.units);
    return {
      // Airbnb 는 객실마다, Booking.com 은 건물마다 하나.
      listings: units.filter((unit) => unit.airbnb).length + data.buildings.filter((b) => b.booking).length,
      noGuest: units.filter((unit) => !unit.airbnb?.guestUrl).length,
      rooms: all.length,
    };
  }, [all, data.buildings]);

  const needle = query.trim().toLowerCase();
  const results = needle
    ? all.filter(({ building, row }) =>
        [
          building.name,
          building.booking?.listingId,
          building.booking?.guestUrl,
          row.label,
          ...row.units.flatMap((unit) => [unit.unitLabel, unit.airbnb?.listingId, unit.airbnb?.guestUrl]),
        ].some((value) => value && value.toLowerCase().includes(needle)),
      )
    : [];

  if (data.buildings.length === 0) {
    return (
      <div className="rlw">
        <div className="rlw-empty">{copy.noRooms}</div>
      </div>
    );
  }

  const buildingIndex = Math.min(selection.building, data.buildings.length - 1);
  const building = data.buildings[buildingIndex];
  const row: RoomLinkRowView | undefined = building.rows[Math.min(selection.row, building.rows.length - 1)];

  const select = (next: Selection) => {
    if (next.building !== selection.building || next.row !== selection.row) setEditing(null);
    setSelection(next);
    setQuery("");
  };

  const isDuplicate = (unit: RoomLinkUnitView) => !!unit.airbnb?.listingId && duplicates.has(unit.airbnb.listingId);

  const renderRow = (
    entry: { building: RoomLinkBuildingView; buildingIndex: number; row: RoomLinkRowView; rowIndex: number },
    index: number,
    showBuilding: boolean,
  ) => {
    const target = { building: entry.buildingIndex, row: entry.rowIndex };
    const on = !needle && entry.buildingIndex === buildingIndex && row?.key === entry.row.key;
    const primary = primaryUnit(entry.row);
    const guestUrl = primary?.airbnb?.guestUrl ?? null;
    const hostUrl = primary?.airbnb?.hostUrl ?? null;
    const listingId = primary?.airbnb?.listingId ?? null;
    const units = orderUnits(entry.row);
    const sellers = units.filter((unit) => unit.selling);
    const resting = units.filter((unit) => !unit.selling);
    return (
      <div
        className={`rlw-row${on ? " on" : ""}`}
        key={entry.row.key}
        onClick={() => select(target)}
        style={{ "--i": Math.min(index, 14) } as CSSProperties}
      >
        <span className="rlw-row__room">
          {showBuilding && <small>{entry.building.name}</small>}
          <button aria-pressed={on} className="rlw-row__sel" onClick={() => select(target)} type="button">
            {entry.row.label}
          </button>
        </span>
        <span className="rlw-row__units">
          {sellers.map((unit) => (
            <span className="rlw-sell" key={unit.roomId}>
              <i aria-hidden="true" />
              {fill(w.unitSelling, { u: unit.unitLabel })}
            </span>
          ))}
          {resting.map((unit, restIndex) => (
            <span className="rlw-rest" key={unit.roomId}>
              {sellers.length > 0 || restIndex > 0 ? " · " : ""}
              <span>{fill(w.unitResting, { u: unit.unitLabel })}</span>
            </span>
          ))}
        </span>
        <span className="rlw-row__guest">
          {guestUrl ? (
            <span className="rlw-row__url">{shortUrl(guestUrl)}</span>
          ) : (
            <span className="rlw-row__miss">{copy.guestMissing}</span>
          )}
          {listingId && (
            <span className="rlw-row__id">
              {fill(w.idTail, { id: listingId.slice(-8) })}
              {primary && isDuplicate(primary) && <em className="rlw-dup">{w.idDuplicate}</em>}
            </span>
          )}
        </span>
        <span className="rlw-row__acts" onClick={(event) => event.stopPropagation()}>
          {guestUrl ? (
            <CopyButton
              done={copiedKey === `row:${primary.roomId}`}
              label={w.copyShort}
              onCopy={() => copyLink(`row:${primary.roomId}`, guestUrl)}
              variant="soft"
              w={w}
            />
          ) : primary ? (
            <button
              className="rlw-btn is-add"
              onClick={() => {
                select(target);
                setEditing(primary.roomId);
              }}
              type="button"
            >
              {w.addLink}
            </button>
          ) : null}
          {hostUrl ? (
            <a className="rlw-tlink is-ink" href={hostUrl} rel="noopener noreferrer" target="_blank">
              {w.hostShort}
              <ExternalLink aria-hidden="true" />
            </a>
          ) : (
            <span aria-hidden="true" className="rlw-tlink is-ghost">
              {w.hostShort}
              <ExternalLink />
            </span>
          )}
        </span>
      </div>
    );
  };

  const tableHead = (
    <div aria-hidden="true" className="rlw-thead">
      <span>{w.colRoom}</span>
      <span>{w.colUnits}</span>
      <span>{w.colGuest}</span>
      <span>{w.colActions}</span>
    </div>
  );

  const unitTotal = (target: RoomLinkBuildingView) => target.rows.reduce((sum, r) => sum + r.units.length, 0);
  const lastEdited = row
    ? row.units
        .map((unit) => unit.airbnb?.updatedAt)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1)
    : undefined;

  return (
    <div className="rlw">
      <div className="rlw-body">
        <div className="rlw-main">
          <div className="rlw-top">
            <p className="rlw-sum">
              <span>
                {w.sumRooms} <b>{totals.rooms}</b>
              </span>
              <span>
                {w.sumListings} <b>{totals.listings}</b>
              </span>
              <span>
                {w.sumNoGuest} <b className={totals.noGuest > 0 ? "is-bad" : ""}>{totals.noGuest}</b>
              </span>
              <span>
                {w.sumDuplicate} <b className={duplicates.size > 0 ? "is-bad" : ""}>{duplicates.size}</b>
              </span>
            </p>
            <label className="rlw-search">
              <Search aria-hidden="true" />
              <input
                aria-label={w.searchAria}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                type="search"
                value={query}
              />
            </label>
          </div>
          <div className="rlw-cols">
            <nav aria-label={copy.buildings} className="rlw-blds">
              {data.buildings.map((item, index) => (
                <button
                  aria-current={index === buildingIndex && !needle ? "true" : undefined}
                  className={`rlw-bld${index === buildingIndex && !needle ? " on" : ""}`}
                  key={item.name}
                  onClick={() => select({ building: index, row: 0 })}
                  type="button"
                >
                  <span>{item.name}</span>
                  <span className="rlw-bld__n">{unitTotal(item)}</span>
                </button>
              ))}
            </nav>

            <section className="rlw-mid">
              {needle ? (
                <>
                  <header className="rlw-bh">
                    <div className="rlw-bh__t">
                      <h2>{copy.searchResults}</h2>
                      <span>{fill(copy.resultCount, { n: results.length })}</span>
                    </div>
                  </header>
                  {results.length === 0 ? (
                    <div className="rlw-empty">{copy.noResults}</div>
                  ) : (
                    <div className="rlw-table" key="search">
                      {tableHead}
                      {results.map((entry, index) => renderRow(entry, index, true))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <header className="rlw-bh">
                    <div className="rlw-bh__t">
                      <h2>{building.name}</h2>
                      <span>
                        {fill(copy.statRooms, { n: building.rows.length })} ·{" "}
                        {fill(copy.statListings, { n: unitTotal(building) })}
                      </span>
                    </div>
                    {building.address ? (
                      <p className="rlw-bh__addr">
                        {building.address}
                        {building.mapUrl && (
                          <>
                            {" · "}
                            <a href={building.mapUrl} rel="noopener noreferrer" target="_blank">
                              {copy.openMap}
                            </a>
                          </>
                        )}
                      </p>
                    ) : null /* 주소를 두지 않는 건물(사노 — 사용자 결정 2026-10-02)은 줄 자체를 감춘다. */}
                    <BookingLine
                      building={building}
                      copiedKey={copiedKey}
                      copy={copy}
                      editing={editing === `booking:${building.name}`}
                      onCopy={copyLink}
                      onEdit={(open) => setEditing(open ? `booking:${building.name}` : null)}
                      onSaved={flash}
                    />
                  </header>
                  {building.rows.length === 0 ? (
                    <div className="rlw-empty">{w.noRoomsInBuilding}</div>
                  ) : (
                    <div className="rlw-table" key={building.name}>
                      {tableHead}
                      {building.rows.map((item, index) =>
                        renderRow({ building, buildingIndex, row: item, rowIndex: index }, index, false),
                      )}
                    </div>
                  )}
                </>
              )}
              <p className="rlw-note">{w.note}</p>
            </section>
          </div>
        </div>

        {row && (
          <aside className="rlw-pane" key={row.key}>
            <div className="rlw-pane__h">
              <span>{building.name}</span>
              <b>{row.label}</b>
              <small>
                {fill(w.unitCount, { n: row.units.length })}
                {row.units.length > 1 ? ` · ${w.sellingFirst}` : ""}
              </small>
            </div>
            {orderUnits(row).map((unit) => (
              <UnitBlock
                copiedKey={copiedKey}
                copy={copy}
                duplicate={isDuplicate(unit)}
                editing={editing === unit.roomId}
                key={unit.roomId}
                onCopy={copyLink}
                onEdit={(open) => setEditing(open ? unit.roomId : null)}
                onSaved={flash}
                unit={unit}
              />
            ))}
            {lastEdited && (
              <span className="rlw-pane__foot">{fill(w.lastEdited, { d: tokyoMonthDay.format(new Date(lastEdited)) })}</span>
            )}
          </aside>
        )}
      </div>

      <span className="rlw-sr" role="status">
        {live}
      </span>
      {toast && (
        <div className="rlw-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** 복사 버튼 — 누르면 1.6초 동안 초록 「✓ 복사됨」(체크가 그려진다). */
function CopyButton({
  done,
  label,
  onCopy,
  variant,
  w,
}: {
  done: boolean;
  label: string;
  onCopy: () => void;
  variant: "soft" | "fill" | "wide" | "text";
  w: White;
}) {
  return (
    <button className={`rlw-btn is-${variant}${done ? " is-done" : ""}`} onClick={onCopy} type="button">
      {done ? (
        <>
          <svg aria-hidden="true" className="rlw-check" viewBox="0 0 24 24">
            <path d="M5 12l5 5 9-10" />
          </svg>
          {w.copied}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function ChannelMark({ channel }: { channel: RoomLinkChannel }) {
  return (
    <span className={`rlw-ch is-${channel}`}>
      <i aria-hidden="true" />
      {channel === "airbnb" ? "Airbnb" : "Booking.com"}
    </span>
  );
}

/** Booking.com — 숙소(건물) 단위 줄. 객실을 바꿔도 같은 건물이면 같은 줄이다. */
function BookingLine({
  building,
  copy,
  copiedKey,
  editing,
  onCopy,
  onEdit,
  onSaved,
}: {
  building: RoomLinkBuildingView;
  copy: Copy;
  copiedKey: string | null;
  editing: boolean;
  onCopy: (key: string, text: string) => void;
  onEdit: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const w = copy.white;
  const link = building.booking;
  const copyKey = `booking:${building.name}`;
  return (
    <>
      <div className="rlw-bk">
        <ChannelMark channel="booking" />
        {link?.listingId && (
          <span className="rlw-bk__id">
            {fill(copy.hotelId, { id: "" }).trim()} <span className="rlw-mono">{link.listingId}</span>
          </span>
        )}
        <span className="rlw-faint">{copy.buildingWide}</span>
        <span className="rlw-grow" />
        {!link ? (
          <>
            <span className="rlw-muted">{w.bookingNone}</span>
            {!editing && (
              <button className="rlw-tbtn is-v" onClick={() => onEdit(true)} type="button">
                {w.put}
              </button>
            )}
          </>
        ) : (
          <>
            {link.hostUrl && (
              <a className="rlw-tlink" href={link.hostUrl} rel="noopener noreferrer" target="_blank">
                {copy.extranet}
                <ExternalLink aria-hidden="true" />
              </a>
            )}
            {link.guestUrl ? (
              <>
                <CopyButton
                  done={copiedKey === copyKey}
                  label={w.guestPageCopy}
                  onCopy={() => onCopy(copyKey, link.guestUrl!)}
                  variant="text"
                  w={w}
                />
                {!editing && (
                  <button className="rlw-tbtn" onClick={() => onEdit(true)} type="button">
                    {copy.edit}
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="rlw-bad">{w.guestPageMissing}</span>
                {!editing && (
                  <button className="rlw-tbtn is-v" onClick={() => onEdit(true)} type="button">
                    {w.put}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
      {link?.memo && !editing && (
        <p className="rlw-memo">
          <span>{copy.memo}</span>
          {link.memo}
        </p>
      )}
      {editing && (
        <LinkEditor
          channel="booking"
          copy={copy}
          key={copyKey}
          link={link}
          onClose={() => onEdit(false)}
          onSaved={onSaved}
          save={(form) => saveBuildingListingLink({ ...form, building: building.name, channel: "booking" })}
        />
      )}
    </>
  );
}

/** 상세의 유닛 한 칸 — Airbnb 리스팅 하나. */
function UnitBlock({
  unit,
  copy,
  copiedKey,
  duplicate,
  editing,
  onCopy,
  onEdit,
  onSaved,
}: {
  unit: RoomLinkUnitView;
  copy: Copy;
  copiedKey: string | null;
  duplicate: boolean;
  editing: boolean;
  onCopy: (key: string, text: string) => void;
  onEdit: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const w = copy.white;
  const link = unit.airbnb;
  const copyKey = `pane:${unit.roomId}`;
  return (
    <section className={`rlw-unit${unit.selling ? " is-now" : ""}`}>
      <div className="rlw-unit__h">
        <b className="rlw-mono">{unit.unitLabel}</b>
        {/* 판매 중 표시는 유닛 하나인 방에도 붙인다(2026-10-02 사용자 지시). */}
        {unit.selling ? (
          <span className="rlw-sell">
            <i aria-hidden="true" />
            {copy.sellingNow}
          </span>
        ) : (
          <span className="rlw-faint">{copy.resting}</span>
        )}
        <span className="rlw-grow" />
        {!editing && link && (
          <button className="rlw-tbtn" onClick={() => onEdit(true)} type="button">
            {copy.edit}
          </button>
        )}
      </div>

      {editing ? (
        <LinkEditor
          channel="airbnb"
          copy={copy}
          link={link}
          onClose={() => onEdit(false)}
          onSaved={onSaved}
          save={(form) => saveRoomListingLink({ ...form, channel: "airbnb", roomId: unit.roomId })}
        />
      ) : !link ? (
        <div className="rlw-unit__ch">
          <ChannelMark channel="airbnb" />
          <span className="rlw-muted">{w.airbnbNone}</span>
          <span className="rlw-grow" />
          <button className="rlw-tbtn is-v" onClick={() => onEdit(true)} type="button">
            {w.put}
          </button>
        </div>
      ) : (
        <>
          <div className="rlw-unit__ch">
            <ChannelMark channel="airbnb" />
            {link.listingId && (
              <span className="rlw-unit__id">{fill(copy.listingId, { id: link.listingId })}</span>
            )}
            {duplicate && <em className="rlw-dup">{w.idDuplicate}</em>}
          </div>
          {duplicate && <p className="rlw-warn">{copy.duplicateWarn}</p>}
          {link.guestUrl ? (
            <>
              <span className="rlw-unit__url">{link.guestUrl}</span>
              <CopyButton
                done={copiedKey === copyKey}
                label={copy.copy}
                onCopy={() => onCopy(copyKey, link.guestUrl!)}
                variant={unit.selling ? "fill" : "wide"}
                w={w}
              />
            </>
          ) : (
            <>
              <span className="rlw-bad">{copy.guestMissing}</span>
              <button className="rlw-btn is-wide is-add" onClick={() => onEdit(true)} type="button">
                {w.guestAdd}
              </button>
            </>
          )}
          {(link.guestUrl || link.hostUrl) && (
            <div className="rlw-unit__links">
              {link.guestUrl && (
                <a className="rlw-tlink" href={link.guestUrl} rel="noopener noreferrer" target="_blank">
                  {w.guestPage}
                  <ExternalLink aria-hidden="true" />
                </a>
              )}
              {link.hostUrl && (
                <a className="rlw-tlink is-ink" href={link.hostUrl} rel="noopener noreferrer" target="_blank">
                  {w.hostEdit}
                  <ExternalLink aria-hidden="true" />
                </a>
              )}
            </div>
          )}
          {link.memo && (
            <p className="rlw-memo">
              <span>{copy.memo}</span>
              {link.memo}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function errorText(copy: Copy, error: Extract<SaveRoomLinkResult, { ok: false }>["error"]) {
  switch (error) {
    case "forbidden":
      return copy.errForbidden;
    case "not_found":
      return copy.errNotFound;
    case "host_invalid":
      return copy.errHostInvalid;
    case "guest_invalid":
      return copy.errGuestInvalid;
    case "host_channel":
      return copy.errHostChannel;
    case "guest_channel":
      return copy.errGuestChannel;
    case "memo_long":
      return copy.errMemoLong;
    default:
      return copy.errSaveFailed;
  }
}

type LinkForm = { host: string; guest: string; memo: string };

/** 링크 편집 폼 — 호스트 · 게스트 · 메모. 셋 다 비우고 저장하면 그 줄을 지운다(서버가 판단). */
function LinkEditor({
  channel,
  link,
  save: submit,
  copy,
  onClose,
  onSaved,
}: {
  channel: RoomLinkChannel;
  link: RoomLinkView | null;
  /** 저장 대상(객실 유닛 · 건물)은 부르는 쪽이 정한다. */
  save: (form: LinkForm) => Promise<SaveRoomLinkResult>;
  copy: Copy;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<LinkForm>({
    guest: link?.guestUrl ?? "",
    host: link?.hostUrl ?? "",
    memo: link?.memo ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hostLabel = channel === "airbnb" ? copy.host : copy.extranet;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await submit(form);
      if (!result.ok) {
        setError(errorText(copy, result.error));
        return;
      }
      onClose();
      onSaved(result.removed ? copy.removedToast : copy.savedToast);
      router.refresh();
    });
  };

  return (
    <div className={`rlw-form is-${channel}`}>
      <label className="rlw-field">
        <span>{hostLabel}</span>
        <input
          autoFocus
          className="rlw-mono"
          onChange={(event) => setForm({ ...form, host: event.target.value })}
          placeholder={channel === "airbnb" ? copy.hostHintAirbnb : copy.hostHintBooking}
          value={form.host}
        />
      </label>
      <label className="rlw-field">
        <span>{copy.guest}</span>
        <input
          className="rlw-mono"
          onChange={(event) => setForm({ ...form, guest: event.target.value })}
          placeholder={channel === "airbnb" ? copy.guestHintAirbnb : copy.guestHintBooking}
          value={form.guest}
        />
      </label>
      <label className="rlw-field">
        <span>
          {copy.memo} <em>({copy.optional})</em>
        </span>
        <input
          maxLength={200}
          onChange={(event) => setForm({ ...form, memo: event.target.value })}
          placeholder={copy.memoPlaceholder}
          value={form.memo}
        />
      </label>
      {error && <p className="rlw-err">{error}</p>}
      <div className="rlw-form__acts">
        {link && (
          <button
            className="rlw-tbtn is-bad"
            disabled={pending}
            onClick={() => setForm({ guest: "", host: "", memo: "" })}
            type="button"
          >
            {copy.remove}
          </button>
        )}
        <span className="rlw-grow" />
        <button className="rlw-tbtn" disabled={pending} onClick={onClose} type="button">
          {copy.cancel}
        </button>
        <button className="rlw-btn is-save" disabled={pending} onClick={save} type="button">
          {pending ? copy.saving : copy.save}
        </button>
      </div>
    </div>
  );
}
