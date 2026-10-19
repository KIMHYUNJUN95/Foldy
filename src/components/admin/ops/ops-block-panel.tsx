"use client";

import { useMemo, useState, useTransition } from "react";
import {
  submitRoomBlock,
  submitRoomUnblock,
  type BlockChangeCell,
  type BlockChangeError,
  type BlockPurpose,
} from "@/app/admin/ops/calendar/actions";
import { groupSelectionIntoRanges } from "@/lib/ops-calendar-selection";
import {
  SpwHead,
  SpwModeTabs,
  spwDate,
  type SpwCopy,
  type SpwMode,
} from "@/components/admin/ops/ops-price-panel";
import "./ops-calendar-panels-white.css";

/** 사유 칩 순서. 코드는 DB 체크 제약과 같다(`202610010001_block_log_purpose.sql`). */
export const BLOCK_PURPOSE_ORDER: readonly BlockPurpose[] = ["repair", "cleaning", "owner", "other"];

/**
 * 차단(블록) 패널 — 격자 오른쪽 세로 카드.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「저쪽 블록의 실제 규칙」
 *
 * ## 이 패널이 하는 일은 하나뿐이다
 *
 * 가격 패널은 「얼마로?」를 묻고 칸마다 다른 값을 계산한다. 여기는 **고른 칸을 막거나 푸는
 * 것**이 전부라 입력이 없다. 대신 화면의 대부분이 **무슨 일이 벌어지는지**를 설명하는 데 쓰인다
 * — 막는 순간 그 방이 **채널에서 내려간다.**
 *
 * ## 구간으로 보여준다
 *
 * 「9칸」보다 「2구간 · 9박」이 정확하다. 블록은 구간 단위로 쓰이고, 끊긴 구간은 나뉘기
 * 때문이다(`groupSelectionIntoRanges`). 구간 수를 보여주지 않으면 10/1·10/2·10/5 를 고른
 * 사람이 「10/1~10/5 를 막았다」고 오해한다.
 *
 * ## 막을 때만 한 번 더 묻는다
 *
 * 막는 순간 그 방이 **채널에서 내려간다** — 되돌리기 전까지 팔 수 있는 밤이 안 팔린다. 그래서
 * 무엇이 몇 구간 몇 박 바뀌는지 보여주고 확인을 받는다.
 *
 * ## 「선택 해제」와 「차단 해제」는 다른 버튼이다 (2026-09-28)
 *
 * 예전에는 하단에 「해제」 하나가 있었고, 그게 **Beds24 차단 해제**였다. 선택을 비우는 버튼으로
 * 읽혀 누르면 「Beds24 에 보내는 중」이 떴다(사용자 지적 — 막혀 있지 않은 날이라 바뀐 것은
 * 없었다). 그래서 둘을 가른다 —
 *
 * - 하단 **「선택 해제」** — 화면의 선택만 비운다. 아무 데도 안 보낸다.
 * - **「차단 해제」** — 고른 칸 중 **실제로 막혀 있는 밤이 있을 때만** 본문에 나타나고,
 *   **그 밤들만** 푼다. 막혀 있지 않은 날에 `override: none` 을 쓰는 헛쓰기가 없다.
 *   푸는 것은 다시 파는 쪽이라 확인 없이 바로 한다.
 */

export type BlockPanelCopy = {
  bkTitle: string;
  bkPurposeLabel: string;
  bkPurposes: Record<BlockPurpose, string>;
  bkMemoPlaceholder: string;
  bkBody: string;
  bkApply: string;
  bkRelease: string;
  bkBlockedNote: string;
  scopeClear: string;
  bkConfirmBlock: string;
  bkSummary: string;
  bkEmptyTitle: string;
  bkEmptyBody: string;
  bkPending: string;
  bkDoneBlock: string;
  bkDoneRelease: string;
  bkFailed: string;
  /** 앞 구간 일부가 이미 반영된 실패. `{done}` = 반영된 구간 수, `{error}` = 사유. */
  bkPartialFailed: string;
  bkNote: string;
  panelCancel: string;
  errForbidden: string;
  errNoCells: string;
  /** Beds24 왕복이 실패한 경우. 사유별로 사람이 할 일이 다르다. */
  errBkCooldown: string;
  errBkUnavailable: string;
  errBkRejected: string;
  errBkVerify: string;
  errBkRolledBack: string;
  errBkNotRolledBack: string;
  errBkUnknownRoom: string;
  errBkPastDate: string;
  errBkSnapshotRead: string;
  errBkNotRestored: string;
  /** 반영 안 된 구간 목록. `{ranges}` = 「302 10/26 → 10/29, …」. */
  bkUnapplied: string;
};

export function blockErrorText(copy: BlockPanelCopy, error: BlockChangeError): string {
  switch (error) {
    case "forbidden":
      return copy.errForbidden;
    case "no_cells":
    case "no_rooms":
      return copy.errNoCells;
    case "cooldown":
      return copy.errBkCooldown;
    case "beds24_unavailable":
    case "readback_truncated":
      return copy.errBkUnavailable;
    case "beds24_rejected":
      return copy.errBkRejected;
    case "verify_mismatch":
      return copy.errBkVerify;
    case "save_failed_rolled_back":
      return copy.errBkRolledBack;
    // 되돌리지 못한 경우는 **사람이 Beds24 에서 직접 풀어야 한다.** 다른 실패와 같은 문구로
    // 묶으면 그냥 재시도하고 넘어가는데, 그러면 고아 블록이 남는다.
    case "save_failed_not_rolled_back":
      return copy.errBkNotRolledBack;
    case "past_date":
      return copy.errBkPastDate;
    case "snapshot_read_failed":
      return copy.errBkSnapshotRead;
    // 해제가 일부만 됐을 수 있고 되돌리지도 못했다 — 사람이 Beds24 에서 확인해야 한다.
    case "unblock_not_restored":
      return copy.errBkNotRestored;
    default:
      return copy.errBkUnknownRoom;
  }
}

export function OpsBlockPanel({
  blockedKeys,
  cells,
  copy,
  onClear,
  onSwitchMode,
  scopeSummary,
}: {
  /** 지금 막혀 있는 칸(`roomKey|date`). 「차단 해제」는 이 칸들에만 간다. */
  blockedKeys: ReadonlySet<string>;
  cells: BlockChangeCell[];
  copy: BlockPanelCopy & SpwCopy;
  onClear: () => void;
  /** 패널 위 「가격 · 최소숙박 · 차단」 탭(2026-10-16 화이트 리디자인). 넘겨야 탭이 그려진다. */
  onSwitchMode?: (mode: SpwMode) => void;
  scopeSummary: { rooms: string; dates: string } | null;
}) {
  const [confirming, setConfirming] = useState(false);
  // 차단 사유(선택) — 걸 때만 보낸다. 같은 칩을 다시 누르면 뺀다.
  const [purpose, setPurpose] = useState<BlockPurpose | null>(null);
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ranges = useMemo(
    () => groupSelectionIntoRanges(cells.map((cell) => ({ date: cell.date, roomKey: cell.roomKey }))),
    [cells],
  );

  const blockedCells = useMemo(
    () => cells.filter((cell) => blockedKeys.has(`${cell.roomKey}|${cell.date}`)),
    [blockedKeys, cells],
  );

  const run = (mode: "block" | "release") => {
    // 푸는 것은 **막혀 있는 밤만** 보낸다.
    const targets = mode === "release" ? blockedCells : cells;
    if (targets.length === 0) return;
    setMessage(copy.bkPending);
    setConfirming(false);
    startTransition(async () => {
      const result =
        mode === "block"
          ? await submitRoomBlock({ cells: targets, memo: memo.trim() || null, purpose })
          : await submitRoomUnblock({ cells: targets });
      if (result.ok) {
        setMessage(mode === "block" ? copy.bkDoneBlock : copy.bkDoneRelease);
        if (mode === "block") {
          setPurpose(null);
          setMemo("");
        }
        onClear();
        return;
      }
      // 앞 구간이 이미 반영됐으면 그렇다고 말한다 — 「실패」만 보면 전부 안 된 줄 알고 다시 누른다.
      // 반영 안 된 구간(실패 + 손대지 않은 뒤 구간)은 방 · 날짜로 적는다 — 무엇을 다시 골라야 하는지 보이게(2026-10-19).
      const failed = result.appliedRanges
        ? copy.bkPartialFailed
            .replace("{done}", String(result.appliedRanges))
            .replace("{error}", blockErrorText(copy, result.error))
        : copy.bkFailed.replace("{error}", blockErrorText(copy, result.error));
      const unapplied =
        result.appliedRanges && result.unappliedRanges?.length
          ? copy.bkUnapplied.replace(
              "{ranges}",
              result.unappliedRanges
                .map(
                  (range) =>
                    `${range.roomLabel} ${spwDate(range.startDate, copy.localeTag)} → ${spwDate(nextDay(range.endDate), copy.localeTag)}`,
                )
                .join(", "),
            )
          : null;
      setMessage(unapplied ? `${failed} ${unapplied}` : failed);
    });
  };

  const hasSelection = cells.length > 0;
  const summary = copy.bkSummary
    .replace("{ranges}", String(ranges.length))
    .replace("{nights}", String(cells.length));
  /** 행 키는 `건물::방` 이다 — 그대로 보이면 내부 키가 드러난다. 고른 칸의 방 이름을 쓴다. */
  const labelByRoom = new Map(cells.map((cell) => [cell.roomKey, cell.roomLabel]));
  const roomName = (roomKey: string) => labelByRoom.get(roomKey) ?? roomKey.replace("::", " ");
  /** 구간은 **밤** 기준(끝 = 마지막 밤)이다. 화면은 예약처럼 「첫 밤 → 다음 날 아침」으로 적는다. */
  const rangeText = (range: { startDate: string; endDate: string }) =>
    `${spwDate(range.startDate, copy.localeTag)} → ${spwDate(nextDay(range.endDate), copy.localeTag)}`;
  const rangeNights = (range: { startDate: string; endDate: string }) =>
    Math.round((Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  /** 이미 막힌 밤을 구간으로 — 「302 10/26 – 10/28 은 이미 막혀 있어요」. */
  const blockedRanges = useMemo(
    () => groupSelectionIntoRanges(blockedCells.map((cell) => ({ date: cell.date, roomKey: cell.roomKey }))),
    [blockedCells],
  );
  const rangeList = (limit: number) => (
    <>
      {ranges.slice(0, limit).map((range, order) => (
        <div className="spw-row" key={`${range.roomKey}|${range.startDate}`} style={{ "--i": Math.min(order, 12) } as React.CSSProperties}>
          <span className="spw-row__room is-wide">{roomName(range.roomKey)}</span>
          <span className="spw-row__date">{rangeText(range)}</span>
          <b className="spw-row__nights">{copy.minStay.replace("{n}", String(rangeNights(range)))}</b>
        </div>
      ))}
      {ranges.length > limit && <span className="spw-more-count">+{ranges.length - limit}</span>}
    </>
  );

  // ── 확인 단계 ── 막는 순간 채널에서 내려간다. 무엇이 몇 구간 몇 박인지 보여주고 한 번 더 묻는다.
  if (confirming) {
    const reason = [purpose ? copy.bkPurposes[purpose] : null, memo.trim() || null].filter(Boolean).join(" · ");
    return (
      <aside aria-label={copy.bkTitle} className="opsp spw">
        <div className="spw-body spw-anim" key="confirm">
          <SpwHead
            kicker={copy.spwBkConfirmKicker}
            sub={summary}
            title={copy.spwBkConfirmTitle
              .replace("{rooms}", scopeSummary?.rooms ?? "")
              .replace("{nights}", String(cells.length))}
          />
          <div className="spw-alert is-block" role="alert">
            <b>{copy.spwBkConfirmHead.replace("{nights}", String(cells.length))}</b>
            <div className="spw-alert__rows">{rangeList(8)}</div>
            {reason && <span className="spw-alert__sub">{copy.spwBkReason.replace("{text}", reason)}</span>}
          </div>
          <p className="spw-note">{copy.spwBkConfirmNote}</p>
          <p className="spw-note">{copy.bkNote}</p>
        </div>
        <div className="spw-foot">
          <button className="spw-btn" onClick={() => setConfirming(false)} type="button">
            {copy.spwBack}
          </button>
          <button className="spw-btn is-danger" disabled={pending} onClick={() => run("block")} type="button">
            {copy.bkConfirmBlock.replace("{ranges}", String(ranges.length)).replace("{nights}", String(cells.length))}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label={copy.bkTitle} className="opsp spw">
      <div className="spw-body">
        <SpwHead kicker={copy.spwKicker} sub={scopeSummary ? scopeSummary.rooms : copy.bkEmptyTitle} title={copy.spwBkTitle} />
        <SpwModeTabs copy={copy} mode="block" onSwitchMode={onSwitchMode} />

        {/* 사유(선택) — BLOCK 막대에 같이 보인다. 「이 방 왜 막혀 있지?」를 묻지 않게(2026-10-01). */}
        {hasSelection && (
          <>
            <div className="spw-group">
              <span className="spw-label">{copy.bkPurposeLabel}</span>
              <div aria-label={copy.bkPurposeLabel} className="spw-pills" role="group">
                {BLOCK_PURPOSE_ORDER.map((key) => (
                  <button
                    aria-pressed={purpose === key}
                    className={`spw-pill${purpose === key ? " on" : ""}`}
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
            <div className="spw-field">
              <span className="spw-field__l">
                {copy.spwBkMemoLabel} <span className="spw-field__lq">· {copy.spwBkMemoLimit}</span>
              </span>
              <textarea
                aria-label={copy.spwBkMemoLabel}
                className="spw-field__area"
                disabled={pending}
                maxLength={200}
                onChange={(event) => setMemo(event.target.value)}
                placeholder={copy.bkMemoPlaceholder}
                rows={2}
                value={memo}
              />
            </div>
          </>
        )}

        {hasSelection ? (
          <div className="spw-list">
            {/* 「9칸」보다 「2구간 · 9박」이 정확하다 — 끊긴 구간은 나뉘어 쓰인다. */}
            <span className="spw-sec">
              {copy.spwBkRangesTitle}
              <span className="spw-sec__n">{summary}</span>
            </span>
            {rangeList(12)}
          </div>
        ) : (
          <p className="spw-note">{copy.bkEmptyBody}</p>
        )}

        {/* 이미 막힌 밤이 섞여 있을 때만 — 그 밤들만 푼다. 푸는 것은 다시 파는 쪽이라 확인 없이 바로 한다. */}
        {blockedCells.length > 0 && (
          <div className="spw-release">
            <span>
              {blockedRanges.slice(0, 3).map((range) => (
                <span className="spw-release__r" key={`${range.roomKey}|${range.startDate}`}>
                  <b>{roomName(range.roomKey)}</b> {spwDate(range.startDate, copy.localeTag)} – {spwDate(range.endDate, copy.localeTag)}
                </span>
              ))}
              <span className="spw-release__t">{copy.bkBlockedNote.replace("{nights}", String(blockedCells.length))}</span>
            </span>
            <button className="spw-release__btn" disabled={pending} onClick={() => run("release")} type="button">
              {copy.bkRelease}
            </button>
          </div>
        )}

        {/* 막는다는 것이 무슨 뜻인지 화면에 적는다 — 「왜 예약이 안 들어오지?」가 안 나오게. */}
        <p className="spw-note">{copy.bkBody}</p>
        <p className="spw-note">{copy.bkNote}</p>
        {message && (
          <p className="spw-msg" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="spw-foot">
        {/* 화면의 선택만 비운다 — Beds24 에는 아무것도 안 보낸다. */}
        <button
          className="spw-btn"
          disabled={!hasSelection || pending}
          onClick={() => {
            setMessage(null);
            onClear();
          }}
          title="Esc"
          type="button"
        >
          {copy.scopeClear}
        </button>
        <button
          className="spw-btn is-danger"
          disabled={!hasSelection || pending}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {copy.spwBkGo.replace("{nights}", String(cells.length))}
        </button>
      </div>
    </aside>
  );
}

/** `YYYY-MM-DD` 다음 날. 시간대에 안 흔들리도록 UTC 정오로 고정한다. */
function nextDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
