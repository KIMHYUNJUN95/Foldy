"use client";

import { useMemo, useState, useTransition } from "react";
import { submitMinStayChange } from "@/actions/ops-calendar";
import type { PriceChangeError } from "@/actions/ops-calendar";
import type { GapContextEntry } from "@/lib/ops-gap-context";
import {
  outcomeText,
  type OpsWriteOutcomeCopy,
  type RunOpsWrite,
} from "@/components/admin/ops/ops-write-tracker";
import {
  SpwHead,
  SpwModeTabs,
  spwDate,
  type SpwCopy,
  type SpwMode,
} from "@/components/admin/ops/ops-price-panel";
import "./ops-calendar-panels-white.css";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";

/**
 * 최소 숙박일 패널 — 격자 오른쪽 세로 카드.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「1박 갭 감지」
 * 시안: Claude Design 「Foldy 운영 관리자 영역」 `6-minstay.dc.html`
 *
 * ## 왜 가격과 다른 패널인가
 *
 * 같은 자리에 있지만 **묻는 것이 다르다.** 가격 패널은 「얼마로?」를 묻고 칸마다 다른 값을
 * 계산한다. 여기는 「몇 박으로?」 하나를 묻고 고른 칸 전부에 같은 값을 넣는다. 대신 화면의
 * 대부분이 **왜 이 칸들이 문제인지**를 설명하는 데 쓰인다 — 갭은 눈에 안 띄는 손실이라
 * 「6칸」이라는 숫자만으로는 손이 안 간다.
 *
 * ## 목록에 앞뒤를 같이 적는다
 *
 * `402호 · 12/3` 만으로는 진짜 팔 수 없는 날인지 확인하러 격자를 다시 봐야 한다.
 * `Booking ▸ 1박 ▸ Airbnb` 로 적으면 목록만 보고 판단할 수 있다(`ops-gap-context.ts`).
 *
 * ## 감지 기준을 화면에 적어 둔다
 *
 * 「왜 이건 갭이 아니지?」가 반드시 나온다. 규칙을 숨기면 그때마다 코드를 열어야 한다.
 */

export type MinStayPanelCopy = OpsWriteOutcomeCopy & {
  minStayTitle: string;
  msGapCount: string;
  msGapBody: string;
  msOneNight: string;
  msTwoNights: string;
  msCustom: string;
  msCustomPlaceholder: string;
  msRuleTitle: string;
  msRuleBody: string;
  msRuleNote: string;
  msFootnote: string;
  msSave: string;
  msEmptyTitle: string;
  msEmptyBody: string;
  msQueued: string;
  msDone: string;
  msFailed: string;
  /** 요일 표기에 쓴다. */
  localeTag: string;
  /** 선택을 비우는 버튼. 가격 패널과 **같은 라벨**을 쓴다 — 같은 동작이다. */
  scopeClear: string;
  errForbidden: string;
  errNoCells: string;
  errBadMinStay: string;
  errPastDate: string;
  errTooManyCells: string;
  errNoWritableRoom: string;
  errEnqueueFailed: string;
};

export type MinStayPanelCell = {
  roomKey: string;
  roomLabel: string;
  roomIds: string[];
  date: string;
};

/** 최소 숙박일의 상한. 저쪽 모달과 같은 범위(1~30)다. */
const MIN_STAY_MAX = 30;

export function minStayErrorText(copy: MinStayPanelCopy, error: PriceChangeError): string {
  switch (error) {
    case "forbidden":
      return copy.errForbidden;
    case "no_cells":
      return copy.errNoCells;
    case "bad_min_stay":
      return copy.errBadMinStay;
    case "no_writable_room":
      return copy.errNoWritableRoom;
    case "past_date":
      return copy.errPastDate;
    case "too_many_cells":
      return copy.errTooManyCells;
    default:
      return copy.errEnqueueFailed;
  }
}

/** 기기 키보드의 「완료」(Enter)로 키보드를 내린다 — 모바일 시트에서 다음 버튼이 키보드에 가리지 않게(2026-10-02). */
const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") event.currentTarget.blur();
};
export function OpsMinStayPanel({
  cells,
  copy,
  gapContext,
  onApplied,
  onClear,
  onFinished,
  onPickGaps,
  onSwitchMode,
  runWrite,
  screenGapCount,
  scopeSummary,
}: {
  cells: MinStayPanelCell[];
  copy: MinStayPanelCopy & SpwCopy;
  gapContext: GapContextEntry[];
  /** 쓰기가 반영된 **뒤** 보낸 칸만 선택에서 뺀다(2026-09-30 버그) — 전체를 비우는 `onClear`
   * 와 달리, 왕복하는 동안 사람이 새로 고른 칸은 건드리지 않는다. */
  onApplied: (sentCells: { roomKey: string; date: string }[]) => void;
  onClear: () => void;
  /** 저장이 접수된 뒤(성공) — 모바일 시트가 스스로 닫히는 데 쓴다(2026-10-02). 데스크톱은 넘기지 않는다. */
  onFinished?: () => void;
  /** 패널 위 「가격 · 최소숙박 · 차단」 탭(2026-10-16 화이트 리디자인). 넘겨야 탭이 그려진다. */
  onSwitchMode?: (mode: SpwMode) => void;
  /**
   * 이 화면(지금 보는 건물 · 기간)에서 고를 수 있는 1박 갭 수와 「모두 고르기」(2026-10-23).
   * 넘기면 머리 숫자가 「고른 칸 중」이 아니라 「이 화면」 기준이 된다 — 패널을 켠 채 건물을 넘겼을 때
   * 아무것도 안 골라 0 으로 보이던 것. 모바일 시트는 넘기지 않는다(예전처럼 고른 칸 기준).
   */
  screenGapCount?: number;
  onPickGaps?: () => void;
  /** 격자가 흐린 값 → 접수 → 반영 대기 → 데이터 다시 받기를 맡는다(`ops-write-tracker.ts`). */
  runWrite: RunOpsWrite;
  scopeSummary: { rooms: string; dates: string } | null;
}) {
  const bName = useBuildingName();
  const bRoom = useRoomPlaceLabel();
  const [nights, setNights] = useState<number>(1);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 고른 칸 중 **갭인 것만** 목록에 나온다. 갭이 아닌 칸도 값은 바뀌지만, 목록은 「왜 문제인가」를
  // 설명하는 자리라 갭이 아닌 것을 섞으면 설명이 흐려진다.
  const selectedKeys = useMemo(
    () => new Set(cells.map((cell) => `${cell.roomKey}|${cell.date}`)),
    [cells],
  );
  const rows = useMemo(
    () => gapContext.filter((entry) => selectedKeys.has(`${entry.roomKey}|${entry.date}`)),
    [gapContext, selectedKeys],
  );

  const apply = () => {
    if (cells.length === 0) return;
    setMessage(copy.msQueued);
    const targets = cells;
    const value = nights;
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
        setMessage(copy.msFailed.replace("{error}", minStayErrorText(copy, result.error)));
        return;
      }
      // **보낸 칸만** 선택에서 뺀다(2026-09-30 버그) — 왕복하는 동안 새로 고른 칸까지
      // 통째로 비우면 안 된다.
      onApplied(targets.map((cell) => ({ date: cell.date, roomKey: cell.roomKey })));
      // 「반영했습니다」는 **Beds24 에 실제로 들어간 뒤에**. 예전에는 접수만 되면 바로 그렇게
      // 말했는데 그때는 아직 큐에 있을 뿐이었다(2026-09-28).
      void settled?.then((outcome) => setMessage(outcomeText(copy.msDone, copy, outcome)));
      onFinished?.();
    });
  };

  const pickCustom = (raw: string) => {
    setCustom(raw);
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MIN_STAY_MAX) setNights(parsed);
  };

  const multiBuilding = new Set(rows.map((entry) => entry.propertyName)).size > 1;
  const nightsText = (n: number) => copy.minStay.replace("{n}", String(n));

  return (
    <aside aria-label={copy.minStayTitle} className="opsp spw">
      <div className="spw-body">
        <SpwHead kicker={copy.spwKicker} sub={scopeSummary ? scopeSummary.rooms : copy.msEmptyTitle} title={copy.spwMsTitle} />
        <SpwModeTabs copy={copy} mode="minstay" onSwitchMode={onSwitchMode} />

        {/* 갭 개수를 크게 적는다 — 눈에 안 띄는 손실이라 숫자가 작으면 손이 안 간다. */}
        {screenGapCount === undefined ? (
          <div className={`spw-gap${rows.length === 0 ? " is-zero" : ""}`}>
            <b>{rows.length}</b>
            <span>{copy.spwMsGapLine}</span>
          </div>
        ) : screenGapCount > 0 ? (
          <div className="spw-gap is-screen">
            <b>{screenGapCount}</b>
            <span className="spw-gap__txt">
              {copy.spwGapScreen}
              {rows.length > 0 && <small>{copy.spwGapPicked.replace("{count}", String(rows.length))}</small>}
            </span>
            {onPickGaps && (
              <button className="spw-gap__pick" disabled={rows.length >= screenGapCount} onClick={onPickGaps} type="button">
                {copy.spwGapPick}
              </button>
            )}
          </div>
        ) : (
          <div className="spw-gap is-screen is-zero">
            <span>{copy.spwGapNone}</span>
          </div>
        )}

        {/* 1박이 기본이다. 2박·직접 입력은 되돌리거나 다른 값으로 바꿀 때 쓴다. */}
        <div className="spw-group">
          <span className="spw-label">{copy.minStayTitle}</span>
          <div className="spw-nights">
            {[1, 2].map((value) => (
              <button
                aria-pressed={nights === value}
                className={`spw-choice${nights === value ? " on" : ""}`}
                key={value}
                onClick={() => {
                  setNights(value);
                  setCustom("");
                }}
                type="button"
              >
                {nightsText(value)}
              </button>
            ))}
            <label className={`spw-choice is-input${nights > 2 ? " on" : ""}`}>
              <input
                aria-label={copy.msCustom}
                autoComplete="off"
                enterKeyHint="done"
                inputMode="numeric"
                max={MIN_STAY_MAX}
                min={1}
                onChange={(event) => pickCustom(event.target.value)}
                onKeyDown={blurOnEnter}
                placeholder={copy.spwMsCustomPh}
                type="number"
                value={custom}
              />
              <span aria-hidden="true">{copy.spwNightUnit}</span>
            </label>
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="spw-list">
            <span className="spw-sec">{copy.spwMsListTitle}</span>
            {rows.map((entry, order) => (
              // **어느 건물 · 어느 방 · 어느 날**만 적는다. 앞뒤 예약의 채널 칩은 최소 숙박일을 정하는 데
              // 필요 없고 플랫폼이 두 번 찍힌 것처럼 읽혔다(2026-09-28 지적). 건물이 여럿이면 건물도 적는다.
              <div className="spw-row" key={`${entry.roomKey}|${entry.date}`} style={{ "--i": Math.min(order, 12) } as React.CSSProperties}>
                <span className="spw-row__room is-wide">{bRoom(entry.roomLabel)}</span>
                <span className="spw-row__date">
                  {multiBuilding && <span className="spw-row__bld">{bName(entry.propertyName)}</span>}
                  {spwDate(entry.date, copy.localeTag)}
                </span>
                {/* 갭은 최소 숙박일이 정확히 2일 때만 잡힌다(감지 기준 ②). */}
                <span className="spw-row__cur">
                  {copy.change.replace("{from}", "2").replace("{to}", "")}
                  <b className={nights < 2 ? "is-ok" : undefined}>{nightsText(nights)}</b>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="spw-note">{copy.msEmptyBody}</p>
        )}

        {/* 「왜 이건 갭이 아니지?」가 반드시 나온다. 규칙을 숨기면 그때마다 코드를 열어야 한다 — 접어 둔다. */}
        <details className="spw-more">
          <summary>{copy.msRuleTitle}</summary>
          <p>
            {copy.msGapBody}
            {copy.msRuleBody}
            <br />
            {copy.msRuleNote}
          </p>
        </details>

        <p className="spw-note">
          {copy.msFootnote.replace("{count}", String(cells.length)).replace("{n}", String(nights))}
        </p>
        {message && (
          <p className="spw-msg" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="spw-foot">
        <button className="spw-btn" disabled={cells.length === 0} onClick={onClear} title="Esc" type="button">
          {copy.scopeClear}
        </button>
        <button
          className="spw-btn is-primary"
          disabled={cells.length === 0 || pending}
          onClick={apply}
          type="button"
        >
          {copy.msSave.replace("{count}", String(cells.length))}
        </button>
      </div>
    </aside>
  );
}
