"use client";

import { useMemo, useState, useTransition } from "react";
import { submitMinStayChange } from "@/app/admin/ops/calendar/actions";
import { minStayErrorText, type MinStayPanelCopy } from "@/components/admin/ops/ops-minstay-panel";
import type { PanelScopeSummary } from "@/components/admin/ops/ops-price-panel";
import type { RunOpsWrite } from "@/components/admin/ops/ops-write-tracker";
import type { MobilePriceSubmitted } from "@/components/mobile/ops/mobile-ops-price-sheet";
import type { GapContextEntry } from "@/lib/ops-gap-context";
import { MswSuccess, mdWeekday, useSuccessThen } from "@/components/mobile/ops/mobile-ops-form";

/**
 * 모바일 최소숙박 시트 — Claude Design 시안 `4a 최소숙박 · 차단 시트 v3`(4a · 4b, 2026-10-02 사용자 확정).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「모바일 판매 캘린더」 → 최소숙박 · 차단 시트 v3
 *
 * **서버 경로는 데스크톱 최소숙박 패널과 같다**(`submitMinStayChange` · `runWrite` — 작업 큐 · 되읽기). 모양은 가격 시트 v3 와
 * 같은 뼈대(머리 · 본문 · 바닥 버튼 · 한 줄 알림):
 *
 * - **1박 갭이 섞였으면** 갭 수를 크게(빨간 상자) + 갭 칸 목록. 1박이 기본.
 * - **갭이 없으면** 「지금 최소 숙박일」(모두 같으면 하나, 갈리면 값별 칸 수) + 칸별 현재 → 바뀔 값(데스크톱은 「갭이
 *   없습니다」만 떴다 — 시안 제안 ①).
 * - 값은 세 칸(1박 · 2박 · 직접 1~30). 「감지 기준」 줄 · 「저장하면 N칸이…」 안내는 두지 않는다(2026-10-02 사용자 지시).
 * - 접수되면 부모가 시트를 닫고 알림(「최소숙박 N박 · M칸 완료」 + 되돌리기).
 */

export type MobileMinStaySheetCopy = MinStayPanelCopy & {
  mSelCount: string;
  mmCurrent: string;
  mmNoGap: string;
  mmGapList: string;
  mpNights: string;
  panelListTitle: string;
  panelListRooms: string;
  panelGo: string;
  panelCurrent: string;
  panelNext: string;
  mwGapHero: string;
  mwNightUnit: string;
  mwChangeHead: string;
  mwChangedCells: string;
  mwOfCells: string;
  mwBack: string;
  mwDone: string;
};

export type MobileMinStayCell = {
  roomKey: string;
  roomLabel: string;
  roomIds: string[];
  date: string;
  /** 지금 최소 숙박일(모르면 `null`). 「지금 값」 · 칸별 현재 → 바뀔 값에 쓴다. */
  minStay: number | null;
};

const MIN_STAY_MAX = 30;


/** 기기 키보드의 「완료」(Enter)로 키보드를 내린다. */
const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") event.currentTarget.blur();
};

export function MobileOpsMinStaySheet({
  cells,
  copy,
  gapContext,
  onApplied,
  onClear,
  onSubmitted,
  runWrite,
  scopeSummary,
}: {
  cells: MobileMinStayCell[];
  copy: MobileMinStaySheetCopy;
  gapContext: GapContextEntry[];
  onApplied: (sentCells: { roomKey: string; date: string }[]) => void;
  onClear: () => void;
  /** 접수 성공 — 부모가 시트를 닫고 알림을 띄운다. `nights` = 보낸 값. */
  onSubmitted: (submitted: MobilePriceSubmitted & { nights: number }) => void;
  runWrite: RunOpsWrite;
  scopeSummary: PanelScopeSummary | null;
}) {
  const [nights, setNights] = useState(1);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const { done, succeed } = useSuccessThen();

  // 고른 칸 중 1박 갭인 것(데스크톱 패널과 같은 판정 — 격자가 넘겨 준 갭 맥락).
  const gapRows = useMemo(() => {
    const keys = new Set(cells.map((cell) => `${cell.roomKey}|${cell.date}`));
    return gapContext.filter((entry) => keys.has(`${entry.roomKey}|${entry.date}`));
  }, [cells, gapContext]);
  const gapMode = gapRows.length > 0;

  // 지금 값 — 값별 칸 수(많은 순).
  const distribution = useMemo(() => {
    const counts = new Map<number, number>();
    for (const cell of cells) if (cell.minStay !== null) counts.set(cell.minStay, (counts.get(cell.minStay) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }, [cells]);

  // 칸별 목록(갭이 없을 때) — 객실 → 날짜.
  const rooms = useMemo(() => {
    const byRoom = new Map<string, { label: string; rows: MobileMinStayCell[] }>();
    for (const cell of cells) {
      const room = byRoom.get(cell.roomKey) ?? { label: cell.roomLabel, rows: [] };
      room.rows.push(cell);
      byRoom.set(cell.roomKey, room);
    }
    for (const room of byRoom.values()) room.rows.sort((a, b) => a.date.localeCompare(b.date));
    return [...byRoom.entries()];
  }, [cells]);

  const pick = (value: number) => {
    setNights(value);
    setCustom("");
    setError(null);
  };
  const pickCustom = (raw: string) => {
    setCustom(raw);
    setError(null);
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MIN_STAY_MAX) setNights(parsed);
  };
  const customActive = custom !== "" && nights === Number(custom);
  const nightsLabel = (n: number) => copy.mpNights.replace("{n}", String(n));

  const apply = () => {
    if (cells.length === 0) return;
    const targets = cells;
    const value = nights;
    setError(null);
    startTransition(async () => {
      const { result, settled } = await runWrite(
        "minStay",
        targets.map((cell) => ({ key: `${cell.roomKey}|${cell.date}`, value })),
        () =>
          submitMinStayChange({
            cells: targets.map((cell) => ({
              date: cell.date,
              roomIds: cell.roomIds,
              roomKey: cell.roomKey,
              roomLabel: cell.roomLabel,
            })),
            minStay: value,
          }),
      );
      if (!result.ok) {
        setConfirming(false);
        setError(copy.msFailed.replace("{error}", minStayErrorText(copy, result.error)));
        return;
      }
      // 접수 — 초록 체크(햅틱) 뒤 부모가 시트를 닫고 알림.
      succeed(() => {
        onApplied(targets.map((cell) => ({ date: cell.date, roomKey: cell.roomKey })));
        onSubmitted({ count: targets.length, jobId: result.jobId, nights: value, settled });
      });
    });
  };

  const minStayByKey = new Map(cells.map((cell) => [`${cell.roomKey}|${cell.date}`, cell.minStay]));
  const changedCount = cells.filter((cell) => cell.minStay !== nights).length;
  const buildingNames = [...new Set(cells.map((cell) => cell.roomKey.split("::")[0]).filter(Boolean))];
  const sub = [buildingNames.join(" · "), copy.mSelCount.replace("{n}", String(cells.length))].filter(Boolean).join(" · ");
  const valueRow = (current: number | null) => (
    <>
      <span className="c">{current === null ? "—" : current}</span>
      <span aria-hidden="true" className="ar">
        →
      </span>
      <b className="nx ok">{nightsLabel(nights)}</b>
    </>
  );

  return (
    <div className="msw">
      <div className="msw-body">
        {confirming ? (
          <div className="msw-step" key="confirm">
            <div className="msw-head">
              <div className="msw-head__t">
                <h3>{copy.mwChangeHead.replace("{n}", String(changedCount))}</h3>
                <p>{[scopeSummary?.rooms, scopeSummary?.dates].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <div className="msw-sum" role="status">
              <div className="msw-kv">
                <span className="k">{copy.mwChangedCells}</span>
                <span className="v">
                  {copy.mwOfCells.replace("{total}", String(cells.length)).replace("{n}", String(changedCount))}
                </span>
              </div>
              <div className="msw-kv">
                <span className="k">{copy.panelCurrent}</span>
                <span className="v">
                  {distribution.length > 0
                    ? distribution.map(([value, count]) => `${nightsLabel(value)} ×${count}`).join(" · ")
                    : "—"}
                </span>
              </div>
              <div className="msw-kv">
                <span className="k">{copy.panelNext}</span>
                <span className="v">
                  <b className="vi">{nightsLabel(nights)}</b>
                </span>
              </div>
            </div>
            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="msw-step" key="input">
            <div className="msw-head">
              <div className="msw-head__t">
                <h3>{copy.minStayTitle}</h3>
                <p>{sub}</p>
              </div>
              <button className="msw-link" onClick={onClear} type="button">
                {copy.scopeClear}
              </button>
            </div>

            {gapMode ? (
              <>
                <div className="msw-hero">
                  <b>{gapRows.length}</b>
                  <span>{copy.mwGapHero}</span>
                </div>
                <p className="msw-hero__p">{copy.msGapBody}</p>
              </>
            ) : (
              <div className="msw-hero cur">
                <b>{distribution.length > 0 ? nightsLabel(distribution[0][0]) : "—"}</b>
                <span>{copy.mmCurrent}</span>
                {distribution.length > 1 && (
                  <small>{distribution.map(([value, count]) => `${nightsLabel(value)} ×${count}`).join(" · ")}</small>
                )}
              </div>
            )}

            <div className="msw-seg" role="group" aria-label={copy.minStayTitle}>
              <button
                aria-pressed={!customActive && nights === 1}
                className={`msw-opt${!customActive && nights === 1 ? " on" : ""}`}
                onClick={() => pick(1)}
                type="button"
              >
                {nightsLabel(1)}
              </button>
              <button
                aria-pressed={!customActive && nights === 2}
                className={`msw-opt${!customActive && nights === 2 ? " on" : ""}`}
                onClick={() => pick(2)}
                type="button"
              >
                {nightsLabel(2)}
              </button>
              <label className={`msw-cust${customActive ? " on" : ""}`}>
                <input
                  aria-label={copy.msCustom}
                  autoComplete="off"
                  enterKeyHint="done"
                  inputMode="numeric"
                  max={MIN_STAY_MAX}
                  min={1}
                  onChange={(event) => pickCustom(event.target.value)}
                  onKeyDown={blurOnEnter}
                  placeholder={copy.msCustom}
                  type="number"
                  value={custom}
                />
                <span>{copy.mwNightUnit}</span>
              </label>
            </div>

            {!gapMode && <p className="msw-note left">{copy.mmNoGap}</p>}

            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}

            <section aria-label={gapMode ? copy.mmGapList : copy.panelListTitle} className="msw-list">
              <div className="msw-list__h">
                <span>{gapMode ? copy.mmGapList : copy.panelListTitle}</span>
                <small>
                  {gapMode
                    ? copy.mSelCount.replace("{n}", String(gapRows.length))
                    : copy.panelListRooms.replace("{rooms}", String(rooms.length)).replace("{cells}", String(cells.length))}
                </small>
              </div>
              {gapMode
                ? gapRows.map((entry) => (
                    <div className="msw-row" key={`${entry.roomKey}|${entry.date}`}>
                      <span className="rm">{entry.roomLabel}</span>
                      <span className="d">
                        {buildingNames.length > 1 ? `${entry.propertyName} · ` : ""}
                        {mdWeekday(entry.date, copy.localeTag)}
                      </span>
                      {valueRow(minStayByKey.get(`${entry.roomKey}|${entry.date}`) ?? null)}
                    </div>
                  ))
                : rooms.flatMap(([key, room]) =>
                    room.rows.map((cell) => (
                      <div className="msw-row" key={`${key}|${cell.date}`}>
                        <span className="rm">{room.label}</span>
                        <span className="d">{mdWeekday(cell.date, copy.localeTag)}</span>
                        {cell.minStay !== nights ? (
                          valueRow(cell.minStay)
                        ) : (
                          <span className="c">{nightsLabel(nights)}</span>
                        )}
                      </div>
                    )),
                  )}
            </section>
          </div>
        )}
      </div>

      <div className={`msw-foot${confirming ? " two" : ""}`}>
        {confirming ? (
          <>
            <button className="msw-btn ghost" disabled={pending} onClick={() => setConfirming(false)} type="button">
              {copy.mwBack}
            </button>
            <button className="msw-btn" disabled={cells.length === 0 || pending} onClick={apply} type="button">
              {copy.msSave.replace("{count}", String(cells.length))}
            </button>
          </>
        ) : (
          <button
            className="msw-btn"
            disabled={cells.length === 0 || pending}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            type="button"
          >
            {copy.panelGo.replace("{count}", String(cells.length))}
          </button>
        )}
      </div>
      {done && <MswSuccess label={copy.mwDone} />}
    </div>
  );
}
