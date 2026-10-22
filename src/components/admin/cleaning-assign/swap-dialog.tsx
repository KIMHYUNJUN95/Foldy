"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import type { RoomMove } from "@/app/admin/cleaning-assign/actions";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { BoardPerson, BoardRoom } from "@/lib/cleaning-assign/data";
import { checkInText, dayLabel, timeLabel } from "./format";

/**
 * 담당 바꾸기 · 넘기기 창 — 시안 「청소 배정 — 담당 교체」(https://claude.ai/artifact/XbUXftFQio5hFvUKt31hmp) ③ · ④ · ⑦.
 * 두 사람 칸, 건물별 묶음 체크(전부 · 일부 · 없음) + 방별 체크. 처음엔 바꿀 수 있는 방이 전부 체크(방 ⋯ 메뉴로 열면 그 방만).
 * 청소 중 · 끝난 방, 미룸 · 처리 끝 방, 두 사람이 다 들어가 있는 방은 고를 수 없다. 아래 「바꾸면」 미리보기 → [그대로 두기] [N개 바꾸기].
 * docs/product/37-cleaning-shift-assignment.md 「담당 교체」
 */

type Props = {
  copy: CleaningAssignCopy;
  date: string;
  locale: string;
  a: BoardPerson;
  b: BoardPerson;
  rooms: BoardRoom[];
  /** 처음에 체크할 방(방 ⋯ 메뉴로 열었을 때). 없으면 바꿀 수 있는 방 전부. */
  initial?: string[];
  label: (name: string) => string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (moves: RoomMove[]) => void;
};

export function SwapDialog({ copy, date, locale, a, b, rooms, initial, label, busy, onClose, onSubmit }: Props) {
  const roomBy = new Map(rooms.map((room) => [room.roomKey, room]));
  const lockReason = (roomKey: string): string | null => {
    const room = roomBy.get(roomKey);
    if (!room) return copy.swapLocked;
    if (room.status === "progress") return copy.statusProgress;
    if (room.status === "done") return room.resolvedHold ? copy.tagResolved : copy.statusDone;
    if (room.deferredUntil) return copy.swapLocked;
    const ids = new Set(room.people.map((p) => p.userId));
    if (ids.has(a.userId) && ids.has(b.userId)) return copy.swapBoth;
    return null;
  };
  const movable = (p: BoardPerson) => p.rooms.filter((r) => !lockReason(r.roomKey)).map((r) => r.roomKey);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(initial ?? [...movable(a), ...movable(b)]));
  const give = b.rooms.length === 0;

  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    setChosen(next);
  };

  const roomName = (r: { propertyName: string; roomLabel: string }) => (r.roomLabel === r.propertyName ? label(r.propertyName) : `${label(r.propertyName)} ${r.roomLabel}`);
  const fromA = a.rooms.filter((r) => chosen.has(r.roomKey) && !lockReason(r.roomKey));
  const fromB = b.rooms.filter((r) => chosen.has(r.roomKey) && !lockReason(r.roomKey));
  const count = fromA.length + fromB.length;
  const after = (self: BoardPerson, out: typeof fromA, incoming: typeof fromA) => {
    const keep = self.rooms.filter((r) => !out.some((o) => o.roomKey === r.roomKey));
    const list = [...keep, ...incoming].map(roomName);
    return list.length > 0 ? list.join(" · ") : copy.swapNoneLeft;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const column = (person: BoardPerson) => {
    const groups = new Map<string, BoardPerson["rooms"]>();
    for (const r of person.rooms) groups.set(r.propertyName, [...(groups.get(r.propertyName) ?? []), r]);
    return (
      <div className="cas-swap__col">
        <div className="cas-swap__who">
          <span className="cas-swap__av" aria-hidden="true">
            {person.name.slice(0, 1)}
          </span>
          <span>
            <b>{person.name}</b>
            <small>{person.rooms.length > 0 ? `${timeLabel(person.startMinutes)} · ${fill(copy.roomsN, { n: person.rooms.length })}` : copy.swapNoneLeft}</small>
          </span>
        </div>
        {person.rooms.length === 0 ? <p className="cas-swap__empty">{copy.swapNoRooms}</p> : null}
        {[...groups.entries()].map(([building, list]) => {
          const keys = list.filter((r) => !lockReason(r.roomKey)).map((r) => r.roomKey);
          const on = keys.filter((key) => chosen.has(key)).length;
          return (
            <div key={building} className="cas-swap__grp">
              <label className="cas-swap__grp-h">
                <GroupBox all={keys.length} on={on} disabled={keys.length === 0} onChange={(value) => toggle(keys, value)} />
                <b>{label(building)}</b>
                <small>{`${on}/${keys.length}`}</small>
              </label>
              {list.map((r) => {
                const lock = lockReason(r.roomKey);
                const room = roomBy.get(r.roomKey);
                return (
                  <label key={r.roomKey} className={`cas-swap__room${lock ? " is-lock" : ""}`}>
                    <input type="checkbox" checked={!lock && chosen.has(r.roomKey)} disabled={Boolean(lock)} onChange={(event) => toggle([r.roomKey], event.target.checked)} />
                    <b>{r.roomLabel === r.propertyName ? label(r.propertyName) : r.roomLabel}</b>
                    <span>{lock ? `${lock} — ${copy.swapLocked}` : room ? checkInText(room, copy) : ""}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="modal-scrim on" onClick={onClose} />
      <div className="modal on cas-modal cas-swap" role="dialog" aria-modal="true" aria-labelledby="cas-swap-t">
        <div>
          <h3 id="cas-swap-t">{fill(give ? copy.giveTitle : copy.swapTitle, { a: a.name, b: b.name })}</h3>
          <p className="cas-modal__sub">{fill(give ? copy.giveSub : copy.swapSub, { b: b.name, date: dayLabel(date, locale) })}</p>
        </div>
        <div className="cas-swap__cols">
          {column(a)}
          <span className="cas-swap__mid" aria-hidden="true">
            {give ? <ArrowRight /> : <ArrowLeftRight />}
          </span>
          {column(b)}
        </div>
        <div className="cas-swap__sum">
          <small>{copy.swapResult}</small>
          <span>
            <b>{a.name}</b>
            <i aria-hidden="true">→</i>
            {after(a, fromA, fromB)}
          </span>
          <span>
            <b>{b.name}</b>
            <i aria-hidden="true">→</i>
            {after(b, fromB, fromA)}
          </span>
          <small>{copy.swapKeepNote}</small>
        </div>
        <div className="cas-modal__f">
          <span className="cas-swap__hint">{copy.swapUndoHint}</span>
          <button type="button" className="cas-btn is-gray" onClick={onClose}>
            {copy.swapKeep}
          </button>
          <button
            type="button"
            className="cas-btn is-pri"
            disabled={busy || count === 0}
            onClick={() =>
              onSubmit([
                ...fromA.map((r) => ({ fromUserId: a.userId, roomKey: r.roomKey, toUserId: b.userId })),
                ...fromB.map((r) => ({ fromUserId: b.userId, roomKey: r.roomKey, toUserId: a.userId })),
              ])
            }
          >
            {fill(give ? copy.giveDo : copy.swapDo, { n: count })}
          </button>
        </div>
      </div>
    </>
  );
}

/** 건물 묶음 체크 — 전부 ✓ · 일부 – · 없음(빈 칸). */
function GroupBox({ all, on, disabled, onChange }: { all: number; on: number; disabled: boolean; onChange: (value: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = on > 0 && on < all;
  }, [on, all]);
  return <input ref={ref} type="checkbox" checked={all > 0 && on === all} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
}
