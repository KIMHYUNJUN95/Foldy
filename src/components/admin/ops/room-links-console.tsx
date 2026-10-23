"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ExternalLink, Search } from "lucide-react";
import {
  addManualBuilding,
  addManualRoom,
  deleteManualBuilding,
  deleteManualRoom,
  type ManualEntryResult,
  renameManualBuilding,
  renameManualRoom,
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
import { ROOM_LINK_NAME_MAX, type RoomLinkChannel } from "@/lib/room-links-model";
import { useBuildingName } from "@/components/shared/building-names";
import "./room-links-white.css";

/**
 * 룸 링크 콘솔 — 화이트 리디자인(2026-10-15, 시안 Links-PC).
 *
 * 도메인 계약: docs/product/35-room-links.md 「화면」
 *
 * 건물 목록 → 가운데 객실 표(객실 · 유닛 · 게스트 링크 · 바로 하기) → 오른쪽 상세. 표에서 판매 중 계정의 게스트 링크를
 * 바로 복사하고, 상세에서 유닛마다 링크를 고친다. Booking.com 은 건물 단위라 가운데 건물 머리에 있다.
 * 저장은 서버 액션이 권한 · 조직 · 입력을 다시 본다 — 여기 검사는 편의다.
 *
 * 건물 · 객실 직접 추가(2026-10-15, 시안 LinksAdd · LinksNewBld · LinksDelete): 건물 목록 아래 「+ 건물 추가」, 표 아래
 * 「+ 객실 추가」. 직접 추가한 것엔 회색 「직접 추가」 표시가 붙고, 이름 바꾸기 · 지우기(확인 창)가 있다. 룸 링크에만 생긴다.
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

/** 고른 건물 · 객실 — 인덱스가 아니라 키로 들고 있어 추가 · 이름 바꾸기 · 지우기 뒤에도 그대로 남는다. */
type Selection = { building: string; row: string | null };
/** 열려 있는 편집 폼 — 건물 Booking.com(`booking:<건물 키>`) 또는 유닛(roomId). */
type EditTarget = string | null;
/** 확인 창 — 직접 추가한 건물 · 객실 지우기(되돌릴 수 없음). */
type ConfirmTarget =
  | { kind: "building"; id: string; name: string; rooms: number }
  | { kind: "room"; id: string; name: string };

/** 건물 키 — 직접 추가한 건물은 id(이름을 바꿔도 같은 키), Beds24 건물은 이름. */
const buildingKey = (building: RoomLinkBuildingView) =>
  building.manualId ? `m:${building.manualId}` : `b:${building.name}`;

export function RoomLinksConsole({ data, copy }: { data: RoomLinksPageData; copy: Copy }) {
  const w = copy.white;
  // Beds24 건물 이름(과 독채 객실 이름)은 한국어 정규 명칭 — 그릴 때만 보는 사람 언어로(2026-10-23). 서버로는 원래 이름을 보낸다.
  // 직접 추가한 건물은 사람이 적은 이름이라 그대로.
  const bName = useBuildingName();
  const shownBuilding = (building: RoomLinkBuildingView) => (building.manualId ? building.name : bName(building.name));
  const shownRow = (building: RoomLinkBuildingView, row: RoomLinkRowView) =>
    !building.manualId && row.label === building.name ? bName(row.label) : row.label;
  const [selection, setSelection] = useState<Selection>(() => ({
    building: data.buildings[0] ? buildingKey(data.buildings[0]) : "",
    row: null,
  }));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EditTarget>(null);
  /** 객실 추가 폼(지금 건물) · 건물 추가 폼 · 이름 바꾸기(`building` / `room`). */
  const [addingRoom, setAddingRoom] = useState(false);
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [renaming, setRenaming] = useState<"building" | "room" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
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
    () => data.buildings.flatMap((building) => building.rows.map((row) => ({ building, row }))),
    [data.buildings],
  );
  // 직접 추가한 객실도 한 줄 = 객실 하나 · 리스팅은 링크가 있는 것만으로 같이 센다.
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
          shownBuilding(building),
          building.booking?.listingId,
          building.booking?.guestUrl,
          row.label,
          ...row.units.flatMap((unit) => [unit.unitLabel, unit.airbnb?.listingId, unit.airbnb?.guestUrl]),
        ].some((value) => value && value.toLowerCase().includes(needle)),
      )
    : [];

  const building: RoomLinkBuildingView | undefined =
    data.buildings.find((item) => buildingKey(item) === selection.building) ?? data.buildings[0];
  const bKey = building ? buildingKey(building) : "";
  const row: RoomLinkRowView | undefined = building
    ? (building.rows.find((item) => item.key === selection.row) ?? building.rows[0])
    : undefined;

  const select = (next: Selection) => {
    if (next.building !== bKey || next.row !== (row?.key ?? null)) {
      setEditing(null);
      setRenaming(null);
    }
    if (next.building !== bKey) setAddingRoom(false);
    setSelection(next);
    setQuery("");
  };

  /** 추가 · 이름 바꾸기 · 지우기가 끝나면 — 알림 한 줄. 목록은 액션의 revalidatePath 가 다시 읽는다(refresh 중복 금지). */
  const done = (message: string) => {
    flash(message);
  };

  const isDuplicate = (unit: RoomLinkUnitView) => !!unit.airbnb?.listingId && duplicates.has(unit.airbnb.listingId);

  const renderRow = (entry: { building: RoomLinkBuildingView; row: RoomLinkRowView }, index: number, showBuilding: boolean) => {
    const target = { building: buildingKey(entry.building), row: entry.row.key };
    const on = !needle && target.building === bKey && row?.key === entry.row.key;
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
          {showBuilding && <small>{shownBuilding(entry.building)}</small>}
          <button aria-pressed={on} className="rlw-row__sel" onClick={() => select(target)} type="button">
            {shownRow(entry.building, entry.row)}
          </button>
        </span>
        <span className="rlw-row__units">
          {entry.row.manualRoomId ? (
            // 직접 추가한 객실 — Beds24 유닛이 없어 판매 중 표시 대신 「직접 추가」.
            <span className="rlw-tag">{w.manualTag}</span>
          ) : (
            <>
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
            </>
          )}
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

  const buildingAdd = (
    <div className="rlw-badd">
      {addingBuilding ? (
        <NameForm
          copy={copy}
          key="add-building"
          label={w.newBuildingName}
          note={w.buildingNote}
          onCancel={() => setAddingBuilding(false)}
          onDone={(result) => {
            setAddingBuilding(false);
            setSelection({ building: `m:${result.id}`, row: null });
            setQuery("");
            done(w.addedToast);
          }}
          submit={(name) => addManualBuilding({ name })}
          submitLabel={w.add}
          variant="stack"
        />
      ) : (
        <button className="rlw-addlink" onClick={() => setAddingBuilding(true)} type="button">
          <span aria-hidden="true">+</span>
          {w.addBuilding}
        </button>
      )}
    </div>
  );

  const roomAddForm = building ? (
    <RoomAddForm
      building={building}
      copy={copy}
      key={`add-room:${bKey}`}
      onCancel={() => setAddingRoom(false)}
      onDone={(result) => {
        setAddingRoom(false);
        setSelection({ building: bKey, row: `manual:${result.id}` });
        done(w.addedToast);
      }}
    />
  ) : null;

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
            <div className="rlw-side">
              <nav aria-label={copy.buildings} className="rlw-blds">
                {data.buildings.map((item) => {
                  const key = buildingKey(item);
                  const on = key === bKey && !needle;
                  return (
                    <button
                      aria-current={on ? "true" : undefined}
                      className={`rlw-bld${on ? " on" : ""}`}
                      key={key}
                      onClick={() => select({ building: key, row: null })}
                      type="button"
                    >
                      <span>{shownBuilding(item)}</span>
                      {item.manualId && <span className="rlw-tag">{w.manualTag}</span>}
                      <span className="rlw-bld__n">{unitTotal(item)}</span>
                    </button>
                  );
                })}
              </nav>
              {buildingAdd}
            </div>

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
              ) : !building ? (
                <div className="rlw-empty">{copy.noRooms}</div>
              ) : (
                <>
                  <header className="rlw-bh">
                    {building.manualId && renaming === "building" ? (
                      <NameForm
                        copy={copy}
                        initial={building.name}
                        key={`rename:${bKey}`}
                        label={w.renameAria}
                        onCancel={() => setRenaming(null)}
                        onDone={() => {
                          setRenaming(null);
                          done(w.renamedToast);
                        }}
                        submit={(name) => renameManualBuilding({ id: building.manualId!, name })}
                        submitLabel={copy.save}
                        variant="inline"
                      />
                    ) : (
                      <div className="rlw-bh__t">
                        <h2>{shownBuilding(building)}</h2>
                        {building.manualId && <span className="rlw-tag">{w.manualTag}</span>}
                        <span>
                          {fill(copy.statRooms, { n: building.rows.length })}
                          {building.manualId ? "" : ` · ${fill(copy.statListings, { n: unitTotal(building) })}`}
                        </span>
                        {building.manualId && (
                          <>
                            <span className="rlw-grow" />
                            <button className="rlw-tbtn" onClick={() => setRenaming("building")} type="button">
                              {w.rename}
                            </button>
                            <button
                              className="rlw-tbtn is-bad"
                              onClick={() =>
                                setConfirm({
                                  id: building.manualId!,
                                  kind: "building",
                                  name: building.name,
                                  rooms: building.rows.length,
                                })
                              }
                              type="button"
                            >
                              {w.deleteBuilding}
                            </button>
                          </>
                        )}
                      </div>
                    )}
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
                    ) : null /* 주소를 두지 않는 건물(사노 — 사용자 결정 2026-10-02) · 직접 추가한 건물은 줄 자체를 감춘다. */}
                    <BookingLine
                      building={building}
                      copiedKey={copiedKey}
                      copy={copy}
                      editing={editing === `booking:${bKey}`}
                      editKey={`booking:${bKey}`}
                      onCopy={copyLink}
                      onEdit={(open) => setEditing(open ? `booking:${bKey}` : null)}
                      onSaved={flash}
                    />
                  </header>
                  <div className="rlw-table" key={bKey}>
                    {tableHead}
                    {building.rows.map((item, index) => renderRow({ building, row: item }, index, false))}
                    {building.rows.length === 0 && !addingRoom && (
                      <div className="rlw-blank">
                        <b>{w.emptyTitle}</b>
                        <span>{w.emptyBody}</span>
                        <button className="rlw-btn is-save" onClick={() => setAddingRoom(true)} type="button">
                          + {w.addRoom}
                        </button>
                      </div>
                    )}
                    {addingRoom
                      ? roomAddForm
                      : building.rows.length > 0 && (
                          <button className="rlw-addlink is-row" onClick={() => setAddingRoom(true)} type="button">
                            <span aria-hidden="true">+</span>
                            {w.addRoom}
                          </button>
                        )}
                  </div>
                </>
              )}
              {!addingRoom && <p className="rlw-note">{w.note}</p>}
            </section>
          </div>
        </div>

        {row && building ? (
          <aside className="rlw-pane" key={row.key}>
            <div className="rlw-pane__h">
              <span>{shownBuilding(building)}</span>
              {row.manualRoomId ? (
                <>
                  <div className="rlw-pane__name">
                    <b>{row.label}</b>
                    <span className="rlw-tag">{w.manualTag}</span>
                  </div>
                  <small>{w.manualRoomSub}</small>
                </>
              ) : (
                <>
                  <b>{shownRow(building, row)}</b>
                  <small>
                    {fill(w.unitCount, { n: row.units.length })}
                    {row.units.length > 1 ? ` · ${w.sellingFirst}` : ""}
                  </small>
                </>
              )}
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
            {row.manualRoomId &&
              (renaming === "room" ? (
                <div className="rlw-pane__acts">
                  <NameForm
                    copy={copy}
                    initial={row.label}
                    key={`rename:${row.key}`}
                    label={w.renameAria}
                    onCancel={() => setRenaming(null)}
                    onDone={() => {
                      setRenaming(null);
                      done(w.renamedToast);
                    }}
                    submit={(name) => renameManualRoom({ id: row.manualRoomId!, name })}
                    submitLabel={copy.save}
                    variant="stack"
                  />
                </div>
              ) : (
                <div className="rlw-pane__acts">
                  <button className="rlw-tbtn" onClick={() => setRenaming("room")} type="button">
                    {w.rename}
                  </button>
                  <button
                    className="rlw-tbtn is-bad"
                    onClick={() => setConfirm({ id: row.manualRoomId!, kind: "room", name: row.label })}
                    type="button"
                  >
                    {w.deleteRoom}
                  </button>
                </div>
              ))}
            {lastEdited && (
              <span className="rlw-pane__foot">{fill(w.lastEdited, { d: tokyoMonthDay.format(new Date(lastEdited)) })}</span>
            )}
          </aside>
        ) : (
          <aside className="rlw-pane is-empty">
            <span>{w.pickRoom}</span>
          </aside>
        )}
      </div>

      {confirm && (
        <ConfirmDelete
          copy={copy}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            if (confirm.kind === "room") setSelection({ building: bKey, row: null });
            setEditing(null);
            setRenaming(null);
            done(w.deletedToast);
          }}
          target={confirm}
        />
      )}

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
  editKey,
  onCopy,
  onEdit,
  onSaved,
}: {
  building: RoomLinkBuildingView;
  copy: Copy;
  copiedKey: string | null;
  editing: boolean;
  /** 복사 표시 · 폼 키 — 건물 키(직접 추가한 건물은 id). */
  editKey: string;
  onCopy: (key: string, text: string) => void;
  onEdit: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const w = copy.white;
  const link = building.booking;
  const copyKey = editKey;
  const manual = Boolean(building.manualId);
  return (
    <>
      <div className="rlw-bk">
        <ChannelMark channel="booking" />
        {link?.listingId && (
          <span className="rlw-bk__id">
            {fill(copy.hotelId, { id: "" }).trim()} <span className="rlw-mono">{link.listingId}</span>
          </span>
        )}
        {!link && manual ? (
          // 직접 추가한 건물 — 시안 LinksNewBld: 「아직 링크가 없어요」 + 「Booking.com 링크 넣기」.
          <>
            <span className="rlw-muted">{w.bookingEmpty}</span>
            <span className="rlw-grow" />
            {!editing && (
              <button className="rlw-tbtn is-v" onClick={() => onEdit(true)} type="button">
                {w.bookingPut}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="rlw-faint">{copy.buildingWide}</span>
            <span className="rlw-grow" />
          </>
        )}
        {!link ? (
          !manual && (
            <>
              <span className="rlw-muted">{w.bookingNone}</span>
              {!editing && (
                <button className="rlw-tbtn is-v" onClick={() => onEdit(true)} type="button">
                  {w.put}
                </button>
              )}
            </>
          )
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
          save={(form) =>
            saveBuildingListingLink({
              ...form,
              building: building.name,
              channel: "booking",
              manualBuildingId: building.manualId,
            })
          }
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
        {/* 판매 중 표시는 유닛 하나인 방에도 붙인다(2026-10-02 사용자 지시). 직접 추가한 객실은 판매 정보가 없어 링크 유무만. */}
        {unit.manual ? (
          link?.guestUrl ? (
            <span className="rlw-sell">
              <i aria-hidden="true" />
              {w.linkReady}
            </span>
          ) : (
            <span className="rlw-faint">{w.linkNone}</span>
          )
        ) : unit.selling ? (
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
          save={(form) => saveRoomListingLink({ ...form, channel: "airbnb", manual: unit.manual, roomId: unit.roomId })}
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
                variant={unit.selling || unit.manual ? "fill" : "wide"}
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

type ActionError = Extract<SaveRoomLinkResult, { ok: false }>["error"] | Extract<ManualEntryResult, { ok: false }>["error"];

function errorText(copy: Copy, error: ActionError) {
  switch (error) {
    case "name_empty":
      return copy.white.errNameEmpty;
    case "name_long":
      return copy.white.errNameLong;
    case "name_taken":
      return copy.white.errNameTaken;
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

/**
 * 이름 한 칸 폼 — 건물 추가(건물 목록 아래, `stack`) · 건물 이름 바꾸기(건물 머리, `inline`) · 객실 이름 바꾸기(상세, `stack`).
 * 검사(1~40자 · 겹침)는 서버가 한다 — 여기선 빈 값만 막는다.
 */
function NameForm({
  copy,
  initial = "",
  label,
  note,
  submit,
  submitLabel,
  variant,
  onCancel,
  onDone,
}: {
  copy: Copy;
  initial?: string;
  label: string;
  note?: string;
  submit: (name: string) => Promise<ManualEntryResult>;
  submitLabel: string;
  variant: "stack" | "inline";
  onCancel: () => void;
  onDone: (result: Extract<ManualEntryResult, { ok: true }>) => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = () => {
    if (!name.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await submit(name);
      if (!result.ok) {
        setError(errorText(copy, result.error));
        return;
      }
      onDone(result);
    });
  };
  return (
    <form
      className={`rlw-nform is-${variant}`}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label className="rlw-field">
        <span>{label}</span>
        <input
          autoFocus
          maxLength={ROOM_LINK_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
          value={name}
        />
      </label>
      <div className="rlw-nform__acts">
        <button className="rlw-tbtn" disabled={pending} onClick={onCancel} type="button">
          {copy.cancel}
        </button>
        <button className="rlw-btn is-save" disabled={pending || !name.trim()} type="submit">
          {pending ? copy.saving : submitLabel}
        </button>
      </div>
      {error && <p className="rlw-err">{error}</p>}
      {note && <p className="rlw-nform__note">{note}</p>}
    </form>
  );
}

/** 객실 추가 — 표 바로 아래(시안 LinksAdd). 이름은 필수, 게스트 · 호스트 링크(리스팅 ID 숫자만도)는 선택. */
function RoomAddForm({
  building,
  copy,
  onCancel,
  onDone,
}: {
  building: RoomLinkBuildingView;
  copy: Copy;
  onCancel: () => void;
  onDone: (result: Extract<ManualEntryResult, { ok: true }>) => void;
}) {
  const w = copy.white;
  const [form, setForm] = useState({ guest: "", host: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = () => {
    if (!form.name.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await addManualRoom({
        building: building.manualId ? null : building.name,
        guest: form.guest,
        host: form.host,
        manualBuildingId: building.manualId,
        name: form.name,
      });
      if (!result.ok) {
        setError(errorText(copy, result.error));
        return;
      }
      onDone(result);
    });
  };
  return (
    <form
      className="rlw-radd"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <b>{w.addRoom}</b>
      <div className="rlw-radd__fields">
        <label className="rlw-field is-name">
          <span>{w.roomName}</span>
          <input
            autoFocus
            className="rlw-mono"
            maxLength={ROOM_LINK_NAME_MAX}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            value={form.name}
          />
        </label>
        <label className="rlw-field">
          <span>{w.guestOptional}</span>
          <input
            onChange={(event) => setForm({ ...form, guest: event.target.value })}
            placeholder={w.guestHint}
            value={form.guest}
          />
        </label>
        <label className="rlw-field">
          <span>{w.hostOptional}</span>
          <input
            onChange={(event) => setForm({ ...form, host: event.target.value })}
            placeholder={w.hostIdHint}
            value={form.host}
          />
        </label>
      </div>
      {error && <p className="rlw-err">{error}</p>}
      <div className="rlw-radd__acts">
        <span className="rlw-radd__note">{w.addRoomNote}</span>
        <button className="rlw-tbtn" disabled={pending} onClick={onCancel} type="button">
          {copy.cancel}
        </button>
        <button className="rlw-btn is-save" disabled={pending || !form.name.trim()} type="submit">
          {pending ? copy.saving : w.addRoom}
        </button>
      </div>
    </form>
  );
}

/**
 * 지우기 확인 창(시안 LinksDelete) — 「그대로 두기 / 지우기(빨강)」. 첫 초점은 「그대로 두기」(Enter 한 번에 지워지지 않게),
 * Esc · 바깥 누르기는 닫기. 직접 추가한 건물을 지우면 그 객실 · 링크가 함께 지워진다(되돌릴 수 없음).
 */
function ConfirmDelete({
  copy,
  target,
  onClose,
  onDone,
}: {
  copy: Copy;
  target: ConfirmTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const w = copy.white;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);
  const title =
    target.kind === "building" ? fill(w.delBuildingTitle, { name: target.name }) : fill(w.delRoomTitle, { name: target.name });
  const body =
    target.kind === "room"
      ? w.delRoomBody
      : target.rooms > 0
        ? fill(w.delBuildingBody, { n: target.rooms })
        : w.delBuildingBodyEmpty;
  const run = () => {
    setError(null);
    startTransition(async () => {
      const result =
        target.kind === "building" ? await deleteManualBuilding({ id: target.id }) : await deleteManualRoom({ id: target.id });
      if (!result.ok) {
        setError(errorText(copy, result.error));
        return;
      }
      onDone();
    });
  };
  return (
    <div className="rlw-scrim" onClick={() => !pending && onClose()}>
      <div aria-label={title} aria-modal="true" className="rlw-dialog" onClick={(event) => event.stopPropagation()} role="alertdialog">
        <b>{title}</b>
        <p>{body}</p>
        {error && <p className="rlw-err">{error}</p>}
        <div className="rlw-dialog__acts">
          <button autoFocus className="rlw-dbtn is-keep" disabled={pending} onClick={onClose} type="button">
            {w.keep}
          </button>
          <button className="rlw-dbtn is-del" disabled={pending} onClick={run} type="button">
            {pending ? w.deleting : w.confirmDelete}
          </button>
        </div>
      </div>
    </div>
  );
}
