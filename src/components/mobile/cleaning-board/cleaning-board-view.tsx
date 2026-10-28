"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import { assignToRoom, unassignFromRoom } from "@/actions/cleaning-assign-room";
import { dayLabel, timeLabel, tokyoTime } from "@/components/admin/cleaning-assign/format";
import { useBuildingName } from "@/components/shared/building-names";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { TaskToast } from "@/components/tasks/task-toast";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import {
  attentionRows,
  matchesFilter,
  orderAssignCandidates,
  type BoardFilter,
  type CleaningBoardRow,
  type CleaningBoardSummary,
} from "@/lib/cleaning-board";
import { haptic } from "@/lib/haptics";
import "./cleaning-board.css";

/**
 * 모바일 청소 현황판(배정 담당 · 2026-10-28, 시안 「R · 청소 현황판」 2riUcpk…).
 *
 * 위에서부터: 제목 · 실시간 → 「18개 중 7개 끝남」 + 막대 하나(범례 = 상태 거르기) → 「먼저 챙길 방」(담당 없음 · 늦음, 옅은 주황 묶음)
 * → 건물별 방 한 줄(상태는 색 + 모양: 끝남 ✓ · 청소 중 채워지는 원 · 대기 빈 원 · 담당 없음/늦음 !).
 * 시작 전 방을 누르면 담당 넣기 — 폰 · 폴드는 공용 바닥 시트, 태블릿 가로는 오른쪽 칸. 넣고 나면 확인 창 없이 「되돌리기」 토스트.
 * 시작 버튼은 없다(알바는 「오늘 내 방」에서 시작). docs/product/07-cleaning-workflow.md 「모바일 청소 현황판」
 */

export type BoardViewRow = CleaningBoardRow & { info: string; startedAt: string | null };
export type BoardViewPerson = {
  userId: string;
  name: string;
  applied: boolean;
  cancelled: boolean;
  rooms: { propertyName: string; roomKey: string; roomLabel: string }[];
};

type Toast = { stamp: number; message: string; undo: (() => void) | null };

const FILTERS: BoardFilter[] = ["all", "done", "progress", "waiting", "open"];

/** 1분마다 다시 그린다 — 청소 중 흐른 분. */
function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function StatusIcon({ row, now }: { row: BoardViewRow; now: number }) {
  if (row.kind === "done") {
    return (
      <svg aria-hidden="true" className="cbd-ic" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="10" fill="#7a52e6" />
        <path d="M6.5 11.3l3 3 6-6.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (row.kind === "progress") {
    // 한 시간에 한 바퀴 — 「얼마나 됐나」를 숫자 옆에서 모양으로도.
    const minutes = row.startedAt ? Math.max(0, (now - new Date(row.startedAt).getTime()) / 60000) : 0;
    const p = Math.min(minutes / 60, 0.999);
    const a = p * Math.PI * 2;
    const x = 11 + 9 * Math.sin(a);
    const y = 11 - 9 * Math.cos(a);
    return (
      <svg aria-hidden="true" className="cbd-ic" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" fill="none" stroke="#e5ddfb" strokeWidth="2.4" />
        {p > 0.01 ? <path d={`M11 2 A9 9 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke="#7a52e6" strokeWidth="2.4" strokeLinecap="round" /> : null}
      </svg>
    );
  }
  if (row.kind === "waiting") {
    return (
      <svg aria-hidden="true" className="cbd-ic" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" fill="none" stroke="#c7c7cc" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="cbd-ic" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="10" fill="#f07b1a" />
      <path d="M11 6.5v5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="11" cy="15.4" r="1.3" fill="#fff" />
    </svg>
  );
}

export function CleaningBoardView({
  copy,
  date,
  locale,
  people,
  rows,
  summary,
}: {
  copy: CleaningAssignCopy;
  date: string;
  locale: string;
  people: BoardViewPerson[];
  rows: BoardViewRow[];
  summary: CleaningBoardSummary;
}) {
  const router = useRouter();
  const isTablet = useIsTablet();
  const bName = useBuildingName();
  const now = useMinuteNow();
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const roomName = (row: { propertyName: string; roomLabel: string }) => (row.roomLabel === row.propertyName ? bName(row.propertyName) : row.roomLabel);
  const fullName = (row: { propertyName: string; roomLabel: string }) =>
    row.roomLabel === row.propertyName ? bName(row.propertyName) : `${bName(row.propertyName)} ${row.roomLabel}`;

  const attention = attentionRows(rows);
  const groups = useMemo(() => {
    const out: { propertyName: string; rows: BoardViewRow[]; total: number; done: number }[] = [];
    for (const row of rows) {
      let group = out.find((g) => g.propertyName === row.propertyName);
      if (!group) {
        group = { done: 0, propertyName: row.propertyName, rows: [], total: 0 };
        out.push(group);
      }
      group.total += 1;
      if (row.kind === "done") group.done += 1;
      if (matchesFilter(row, filter)) group.rows.push(row);
    }
    return out.filter((g) => g.rows.length > 0);
  }, [rows, filter]);

  const selected = rows.find((row) => row.roomKey === openKey) ?? null;
  const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
  const counts: Record<BoardFilter, number> = {
    all: summary.total,
    done: summary.done,
    open: summary.open,
    progress: summary.progress,
    waiting: summary.waiting,
  };
  const filterLabel: Record<BoardFilter, string> = {
    all: copy.boardFilterAll,
    done: copy.boardFilterDone,
    open: copy.boardFilterOpen,
    progress: copy.boardFilterProgress,
    waiting: copy.boardFilterWaiting,
  };

  const stateText = (row: BoardViewRow) => {
    if (row.kind === "done") return row.completedAt ? tokyoTime(row.completedAt) : copy.boardFilterDone;
    if (row.kind === "progress") {
      const minutes = row.startedAt ? Math.max(0, Math.floor((now - new Date(row.startedAt).getTime()) / 60000)) : row.elapsedMinutes;
      return minutes === null ? copy.boardFilterProgress : fill(copy.boardMinutes, { n: minutes });
    }
    if (row.kind === "late") return fill(copy.boardLateTag, { n: row.lateMinutes ?? 0 });
    if (row.kind === "open") return copy.boardAdd;
    return copy.boardWaiting;
  };
  const whoText = (row: BoardViewRow) => (row.people.length > 0 ? row.people.map((p) => p.name).join(" · ") : copy.boardFilterOpen);

  const open = (row: BoardViewRow) => {
    if (!row.editable) return;
    haptic("light");
    setOpenKey(row.roomKey);
  };

  /** 담당 저장 — 더하고 빼는 차이만 보낸다. 성공하면 「되돌리기」(거꾸로 보내기). */
  const save = (row: BoardViewRow, next: string[], close: () => void) => {
    const before = row.people.map((p) => p.userId);
    const add = next.filter((id) => !before.includes(id));
    const remove = before.filter((id) => !next.includes(id));
    if (add.length === 0 && remove.length === 0) return;
    const apply = async (adds: string[], removes: string[]) => {
      for (const userId of adds) {
        const result = await assignToRoom({ date, roomKey: row.roomKey, userId });
        if (!result.ok) return result.reason;
      }
      for (const userId of removes) {
        const result = await unassignFromRoom({ date, roomKey: row.roomKey, userId });
        if (!result.ok) return result.reason;
      }
      return null;
    };
    startTransition(async () => {
      const failure = await apply(add, remove);
      if (failure) {
        haptic("error");
        setToast({ message: failure === "conflict" ? copy.boardConflict : copy.boardFailed, stamp: Date.now(), undo: null });
        router.refresh();
        return;
      }
      haptic("success");
      close();
      const onlyName = add.length === 1 && remove.length === 0 ? people.find((p) => p.userId === add[0])?.name ?? null : null;
      setToast({
        message: onlyName ? fill(copy.boardSavedOne, { name: onlyName, room: roomName(row) }) : fill(copy.boardSavedMany, { room: roomName(row) }),
        stamp: Date.now(),
        undo: () => {
          setToast(null);
          startTransition(async () => {
            const undoFailure = await apply(remove, add);
            if (undoFailure) {
              haptic("error");
              setToast({ message: copy.boardFailed, stamp: Date.now(), undo: null });
            } else haptic("light");
            router.refresh();
          });
        },
      });
    });
  };

  const rowButton = (row: BoardViewRow, inAttention: boolean) => {
    const inner = inAttention ? (
      <>
        <span className="cbd-room">{roomName(row)}</span>
        <span className="cbd-main">
          <b className="cbd-warn">{row.kind === "open" ? copy.boardFilterOpen : fill(copy.boardLate, { n: row.lateMinutes ?? 0 })}</b>
          <span>
            {row.kind === "open"
              ? [bName(row.propertyName), row.info].filter(Boolean).join(" · ")
              : [bName(row.propertyName), fill(copy.boardPlanned, { name: row.plannedName ?? "", time: timeLabel(row.plannedStartMinutes ?? 0) })].join(" · ")}
          </span>
        </span>
        <span className={row.kind === "open" ? "cbd-pill" : "cbd-link"}>{row.kind === "open" ? copy.boardAdd : copy.boardView}</span>
      </>
    ) : (
      <>
        <StatusIcon row={row} now={now} />
        <span className="cbd-room">{roomName(row)}</span>
        <span className={`cbd-who is-${row.kind}`}>{whoText(row)}</span>
        <span className={`cbd-st is-${row.kind}`}>{stateText(row)}</span>
      </>
    );
    const cls = `${inAttention ? "cbd-arow" : "cbd-row"}${isTablet && openKey === row.roomKey ? " is-sel" : ""}`;
    return row.editable ? (
      <button key={row.roomKey} type="button" className={cls} onClick={() => open(row)} aria-label={`${fullName(row)} · ${whoText(row)} · ${stateText(row)}`}>
        {inner}
      </button>
    ) : (
      <div key={row.roomKey} className={cls}>
        {inner}
      </div>
    );
  };

  const panel = (row: BoardViewRow, close: () => void) => (
    <AssignPanel
      copy={copy}
      key={row.roomKey}
      onSave={(next) => save(row, next, close)}
      pending={pending}
      people={people}
      roomName={roomName(row)}
      row={row}
      buildingName={bName(row.propertyName)}
    />
  );

  return (
    <div className="cbd">
      <div className="cbd-col">
        <header className="cbd-head">
          <div className="cbd-head__t">
            <span className="cbd-sub">{dayLabel(date, locale)}</span>
            <h1>{copy.boardTitle}</h1>
          </div>
          <span className="cbd-live">
            <i aria-hidden="true" />
            {copy.boardLive}
          </span>
        </header>

        {rows.length === 0 ? (
          <p className="cbd-empty">{copy.boardEmpty}</p>
        ) : (
          <>
            <section className="cbd-prog" aria-label={copy.boardTitle}>
              <div className="cbd-prog__t">
                <b>{fill(copy.boardProgress, { d: summary.done, n: summary.total })}</b>
                <span>{pct}%</span>
              </div>
              <div
                className="cbd-bar"
                role="img"
                aria-label={`${copy.boardFilterDone} ${summary.done}, ${copy.boardFilterProgress} ${summary.progress}, ${copy.boardFilterWaiting} ${summary.waiting}, ${copy.boardFilterOpen} ${summary.open}`}
              >
                {summary.done > 0 ? <i className="is-done" style={{ flexGrow: summary.done }} /> : null}
                {summary.progress > 0 ? <i className="is-progress" style={{ flexGrow: summary.progress }} /> : null}
                {summary.waiting > 0 ? <i className="is-waiting" style={{ flexGrow: summary.waiting }} /> : null}
                {summary.open > 0 ? <i className="is-open" style={{ flexGrow: summary.open }} /> : null}
              </div>
              <div className="cbd-filters" role="group" aria-label={copy.boardFilterLabel}>
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    className={`cbd-filter is-${f}${filter === f ? " is-on" : ""}`}
                    onClick={() => {
                      haptic("light");
                      setFilter(f);
                    }}
                  >
                    {f !== "all" ? <i aria-hidden="true" /> : null}
                    {filterLabel[f]}
                    <span>{counts[f]}</span>
                  </button>
                ))}
              </div>
            </section>

            {attention.length > 0 && filter === "all" ? (
              <section className="cbd-attn" aria-label={copy.boardAttention}>
                {attention.map((row) => rowButton(row, true))}
              </section>
            ) : null}

            {groups.length === 0 ? <p className="cbd-empty is-filter">{copy.boardEmptyFilter}</p> : null}
            <div className="cbd-groups">
              {groups.map((group) => (
                <section key={group.propertyName} className="cbd-group" aria-label={bName(group.propertyName)}>
                  <div className="cbd-group__h">
                    <b>{bName(group.propertyName)}</b>
                    <span>{fill(copy.boardProgress, { d: group.done, n: group.total })}</span>
                  </div>
                  {group.rows.map((row) => rowButton(row, false))}
                </section>
              ))}
            </div>
          </>
        )}

        <nav className="cbd-links" aria-label={copy.boardRecords}>
          <Link href="/mobile/cleaning/records">
            <span>{copy.boardRecords}</span>
            <ChevronRight aria-hidden="true" />
          </Link>
          <Link href="/mobile/cleaning?work=1">
            <span>{copy.boardWork}</span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </nav>
      </div>

      {isTablet ? (
        <aside className="cbd-pane" aria-label={selected ? fullName(selected) : copy.boardPaneEmpty}>
          {selected ? panel(selected, () => setOpenKey(null)) : <p className="cbd-pane__empty">{copy.boardPaneEmpty}</p>}
        </aside>
      ) : selected ? (
        <BottomSheet ariaLabel={fullName(selected)} onClose={() => setOpenKey(null)}>
          {({ close }) => <div className="cbd-sheet">{panel(selected, close)}</div>}
        </BottomSheet>
      ) : null}

      {toast ? (
        <TaskToast
          key={toast.stamp}
          message={toast.message}
          onDismiss={() => setToast(null)}
          action={toast.undo ? { label: copy.myUndo, onAction: toast.undo } : undefined}
        />
      ) : null}
    </div>
  );
}

/** 담당 넣기 — 오늘 나온 사람(같은 건물 먼저 · 방 적은 순), 여러 명, 신청 안 한 사람은 접어 둔다. */
function AssignPanel({
  buildingName,
  copy,
  onSave,
  pending,
  people,
  roomName,
  row,
}: {
  buildingName: string;
  copy: CleaningAssignCopy;
  onSave: (next: string[]) => void;
  pending: boolean;
  people: BoardViewPerson[];
  roomName: string;
  row: BoardViewRow;
}) {
  const initial = row.people.map((p) => p.userId);
  const [picked, setPicked] = useState<string[]>(initial);
  const [showOthers, setShowOthers] = useState(false);
  const { today, others } = orderAssignCandidates(people, row.propertyName);
  const bName = useBuildingName();

  const toggle = (userId: string) => {
    haptic("light");
    setPicked((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };
  const add = picked.filter((id) => !initial.includes(id));
  const removed = initial.filter((id) => !picked.includes(id));
  const changed = add.length > 0 || removed.length > 0;
  const onlyAdd = add.length === 1 && removed.length === 0 ? people.find((p) => p.userId === add[0]) : undefined;
  const ctaText = !changed
    ? copy.boardUnchanged
    : onlyAdd
      ? fill(copy.boardSaveOne, { name: onlyAdd.name, room: roomName })
      : fill(copy.boardSaveMany, { room: roomName });

  const personRow = (p: BoardViewPerson) => {
    const on = picked.includes(p.userId);
    const places = [...new Set(p.rooms.map((r) => bName(r.propertyName)))].join(" · ");
    const load = p.rooms.length;
    return (
      <button key={p.userId} type="button" className="cbd-person" aria-pressed={on} onClick={() => toggle(p.userId)}>
        <span className="cbd-person__t">
          <b>{p.name}</b>
          <span>{[places, load > 0 ? fill(copy.boardRoomsN, { n: load }) : copy.boardNoRooms].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="cbd-load" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i < load ? "is-on" : undefined} />
          ))}
        </span>
        <span className={`cbd-check${on ? " is-on" : ""}`} aria-hidden="true">
          {on ? <Check strokeWidth={3.2} /> : null}
        </span>
      </button>
    );
  };

  return (
    <div className="cbd-assign">
      <div className="cbd-assign__head">
        <span className={row.kind === "open" ? "is-warn" : undefined}>{`${row.kind === "open" ? copy.boardFilterOpen : copy.boardSheetEdit.replace("{room}", roomName)} · ${buildingName}`}</span>
        <h2>{fill(copy.boardSheetQ, { room: roomName })}</h2>
        <p>{row.info || copy.boardNoIn}</p>
      </div>
      <div className="cbd-assign__list">
        <span className="cbd-cap">{copy.boardPeopleHead}</span>
        {today.length === 0 ? <p className="cbd-empty is-filter">{copy.boardNoPeople}</p> : today.map(personRow)}
        {others.length > 0 ? (
          showOthers ? (
            others.map(personRow)
          ) : (
            <button type="button" className="cbd-more" onClick={() => setShowOthers(true)}>
              {fill(copy.boardOthers, { n: others.length })}
            </button>
          )
        ) : null}
      </div>
      <div className="cbd-assign__foot">
        <button type="button" className="cbd-cta" disabled={!changed || pending} aria-busy={pending} onClick={() => onSave(picked)}>
          {ctaText}
        </button>
        <span className="cbd-note">{copy.boardWillShow}</span>
      </div>
    </div>
  );
}
