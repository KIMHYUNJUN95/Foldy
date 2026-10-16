"use client";

import { useMemo, useState, useTransition } from "react";
import {
  submitRoomBlock,
  submitRoomUnblock,
  type BlockChangeCell,
  type BlockPurpose,
} from "@/app/admin/ops/calendar/actions";
import { BLOCK_PURPOSE_ORDER, blockErrorText, type BlockPanelCopy } from "@/components/admin/ops/ops-block-panel";
import type { PanelScopeSummary } from "@/components/admin/ops/ops-price-panel";
import { groupSelectionIntoRanges } from "@/lib/ops-calendar-selection";
import { MswField, MswSuccess, useSuccessThen } from "@/components/mobile/ops/mobile-ops-form";

/**
 * 모바일 차단 시트 — Claude Design 시안 `4a 최소숙박 · 차단 시트 v3`(4c · 4d · 4e, 2026-10-02 사용자 확정).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「모바일 판매 캘린더」 → 최소숙박 · 차단 시트 v3
 *
 * **서버 경로는 데스크톱 차단 패널과 같다**(`submitRoomBlock` · `submitRoomUnblock` — 그 방의 유닛 전부 · 끊긴 날짜는 구간을
 * 나눠 보냄 · 되읽기 검증). 모양은 가격 시트 v3 와 같은 뼈대:
 *
 * - 사유 칩 4개(다시 누르면 해제) + 메모 · 막을 구간 목록(객실 · 시작 → 끝 · 박 수).
 * - 이미 막힌 밤이 섞였으면 빨간 줄 + 「차단 해제」(그 밤만, 바로 실행).
 * - 「다음 · N박 차단」 → 빨간 확인 카드(구간별 한 줄 · 사유) → 「N박 차단」.
 * - 성공하면 부모가 시트를 닫고 알림(「차단 완료 · N박」 / 「차단 해제 · N박」 + 되돌리기 — `revertBlockChange`).
 */

export type MobileBlockSheetCopy = BlockPanelCopy & {
  mbRanges: string;
  mbConfirmHead: string;
  mbReason: string;
  mbGo: string;
  mbApply: string;
  mpNights: string;
  scopeClear: string;
  panelCancel: string;
  mwBlockTitle: string;
  mwBlockHead: string;
  mwMemo: string;
  mwBack: string;
  mwDone: string;
};

export type MobileBlockDone = { mode: "block" | "release"; nights: number; at: string };

const pad = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;
const nightsBetween = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

export function MobileOpsBlockSheet({
  blockedKeys,
  cells,
  copy,
  onClear,
  onDone,
  scopeSummary,
}: {
  /** 지금 막혀 있는 칸(`roomKey|date`). 「차단 해제」는 이 칸들에만 간다. */
  blockedKeys: ReadonlySet<string>;
  cells: BlockChangeCell[];
  copy: MobileBlockSheetCopy;
  onClear: () => void;
  /** 성공 — 부모가 선택을 비우고 시트를 닫고 알림을 띄운다. */
  onDone: (done: MobileBlockDone) => void;
  scopeSummary: PanelScopeSummary | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [purpose, setPurpose] = useState<BlockPurpose | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { done, succeed } = useSuccessThen();

  const ranges = useMemo(
    () => groupSelectionIntoRanges(cells.map((cell) => ({ date: cell.date, roomKey: cell.roomKey }))),
    [cells],
  );
  const blockedCells = useMemo(
    () => cells.filter((cell) => blockedKeys.has(`${cell.roomKey}|${cell.date}`)),
    [blockedKeys, cells],
  );
  const nightsLabel = (n: number) => copy.mpNights.replace("{n}", String(n));
  const roomName = (roomKey: string) => roomKey.replace("::", " ");

  const run = (mode: "block" | "release") => {
    const targets = mode === "release" ? blockedCells : cells;
    if (targets.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result =
        mode === "block"
          ? await submitRoomBlock({ cells: targets, memo: memo.trim() || null, purpose })
          : await submitRoomUnblock({ cells: targets });
      if (result.ok) {
        // 완료 — 초록 체크(햅틱) 뒤 부모가 선택을 비우고 시트를 닫는다.
        succeed(() => onDone({ at: result.at, mode, nights: targets.length }));
        return;
      }
      setConfirming(false);
      setError(
        result.appliedRanges
          ? copy.bkPartialFailed
              .replace("{done}", String(result.appliedRanges))
              .replace("{error}", blockErrorText(copy, result.error))
          : copy.bkFailed.replace("{error}", blockErrorText(copy, result.error)),
      );
    });
  };

  const sub = [scopeSummary?.rooms, nightsLabel(cells.length)].filter(Boolean).join(" · ");
  const why = [purpose ? copy.bkPurposes[purpose] : null, memo.trim() || null].filter(Boolean).join(" · ");

  return (
    <div className="msw">
      <div className="msw-body">
        {confirming ? (
          <div className="msw-step" key="confirm">
            <div className="msw-head">
              <div className="msw-head__t">
                <h3>{copy.mwBlockTitle}</h3>
                <p>{copy.mbConfirmHead}</p>
              </div>
            </div>
            <div className="msw-sum red" role="status">
              <div className="msw-blk-h">{copy.mwBlockHead.replace("{n}", String(cells.length))}</div>
              {ranges.slice(0, 6).map((range) => (
                <div className="ln" key={`${range.roomKey}|${range.startDate}`}>
                  <span>
                    <span className="mono">{roomName(range.roomKey)}</span> · {pad(range.startDate)} → {pad(range.endDate)}
                  </span>
                  <span>{nightsLabel(nightsBetween(range.startDate, range.endDate))}</span>
                </div>
              ))}
              {ranges.length > 6 && <div className="ln">+{ranges.length - 6}</div>}
              {why && (
                <div className="why">
                  {copy.mbReason} · {why}
                </div>
              )}
            </div>
            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}
            <p className="msw-note left">{copy.bkNote}</p>
          </div>
        ) : (
          <div className="msw-step" key="input">
            <div className="msw-head">
              <div className="msw-head__t">
                <h3>{copy.mwBlockTitle}</h3>
                <p>{sub}</p>
              </div>
              <button className="msw-link" disabled={pending} onClick={onClear} type="button">
                {copy.scopeClear}
              </button>
            </div>

            <div className="msw-step-sub">
              <div className="msw-sec">
                <span>{copy.bkPurposeLabel}</span>
              </div>
              <div className="msw-grid" role="group" aria-label={copy.bkPurposeLabel}>
                {BLOCK_PURPOSE_ORDER.map((key) => (
                  <button
                    aria-pressed={purpose === key}
                    className={`msw-opt${purpose === key ? " on" : ""}`}
                    disabled={pending}
                    key={key}
                    onClick={() => setPurpose((current) => (current === key ? null : key))}
                    type="button"
                  >
                    {copy.bkPurposes[key]}
                  </button>
                ))}
              </div>
            </div>

            <MswField label={copy.mwMemo}>
              <textarea
                className="msw-in"
                disabled={pending}
                enterKeyHint="done"
                maxLength={200}
                onChange={(event) => setMemo(event.target.value.replace(/\n/g, " "))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                placeholder={copy.bkMemoPlaceholder}
                rows={2}
                value={memo}
              />
            </MswField>

            <section aria-label={copy.mbRanges} className="msw-list">
              <div className="msw-list__h">
                <span>{copy.mbRanges}</span>
                <small>
                  {copy.bkSummary.replace("{ranges}", String(ranges.length)).replace("{nights}", String(cells.length))}
                </small>
              </div>
              {ranges.map((range) => (
                <div className="msw-row" key={`${range.roomKey}|${range.startDate}`}>
                  <span className="rm">{range.roomKey.split("::")[1] ?? range.roomKey}</span>
                  <span className="d">
                    {pad(range.startDate)} → {pad(range.endDate)}
                  </span>
                  <span className="n">{nightsLabel(nightsBetween(range.startDate, range.endDate))}</span>
                </div>
              ))}
            </section>

            {/* 이미 막힌 밤이 섞여 있을 때만 — 그 밤들만 바로 푼다. */}
            {blockedCells.length > 0 && (
              <div className="msw-alert row">
                <span>{copy.bkBlockedNote.replace("{nights}", String(blockedCells.length))}</span>
                <button className="msw-press" disabled={pending} onClick={() => run("release")} type="button">
                  {copy.bkRelease}
                </button>
              </div>
            )}

            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}

            <p className="msw-note left">{copy.bkBody}</p>
          </div>
        )}
      </div>

      <div className={`msw-foot${confirming ? " two" : ""}`}>
        {confirming ? (
          <>
            <button className="msw-btn ghost" disabled={pending} onClick={() => setConfirming(false)} type="button">
              {copy.mwBack}
            </button>
            <button className="msw-btn red" disabled={pending} onClick={() => run("block")} type="button">
              {copy.mbApply.replace("{n}", String(cells.length))}
            </button>
          </>
        ) : (
          <button
            className="msw-btn red"
            disabled={cells.length === 0 || pending}
            onClick={() => setConfirming(true)}
            type="button"
          >
            {copy.mbGo.replace("{n}", String(cells.length))}
          </button>
        )}
      </div>
      {done && <MswSuccess label={copy.mwDone} />}
    </div>
  );
}
