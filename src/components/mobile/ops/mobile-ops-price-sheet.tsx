"use client";

import { useMemo, useState, useTransition } from "react";
import { submitPriceChange, type PriceChangeCell, type PriceChangeError } from "@/app/admin/ops/calendar/actions";
import type { PanelCell, PanelCopy, PanelScopeSummary } from "@/components/admin/ops/ops-price-panel";
import type { OpsWriteOutcome, RunOpsWrite } from "@/components/admin/ops/ops-write-tracker";
import {
  amountFromPercent,
  buildAdjustmentPreview,
  findAdjustmentWarnings,
  percentFromAmount,
  PERCENT_PRESETS,
  type AdjustmentInput,
} from "@/lib/ops-price-adjustment";
import { MswField, MswSuccess, mdWeekday, useSuccessThen } from "@/components/mobile/ops/mobile-ops-form";
import { PriceScopeEditor, usePriceScope, type PriceScopeRoom } from "@/components/admin/ops/ops-price-scope";

/**
 * 모바일 가격 시트 — Claude Design 시안 `3a 가격 시트 v3`(2026-10-02 사용자 확정).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「모바일 판매 캘린더」 → 가격 시트 v3
 *
 * **계산 · 서버 경로는 데스크톱 가격 패널(`OpsPricePanel`)과 같다** — 같은 미리보기(`buildAdjustmentPreview`),
 * 같은 경고(`findAdjustmentWarnings`), 같은 서버 액션(`submitPriceChange`) · 같은 쓰기 추적(`runWrite`). 모양만
 * 모바일 시안으로 다시 그렸다:
 *
 * - **화이트 리디자인(2026-10-16, 시안 `SalesPrice-Phone` · `SalesPriceConfirm-Phone`)** — 클래스 `msw-*`
 *   (`mobile-ops-sheets-white.css`). 머리 = 고른 객실 / 날짜 · 칸 수 + 「선택 해제」 글자 버튼.
 * - 현재 · 변경 상자: 둘 다 범위(최저 – 최고) + 평균.
 * - 「가격 직접 입력」 한 칸 + 「퍼센트로 조정」 프리셋 4 × 2(8번째 = 「지우기」) · 제목 줄 오른쪽에 직접 % 칸.
 *   같은 프리셋을 다시 누르면 해제.
 * - 입력 전에도 **같은 「다음 · N칸 확인」 버튼을 흐리게**(문구를 바꾸지 않는다 — 사용자 지시).
 * - 확인 단계: 「N칸이 바뀌어요」 + 요약 상자(바뀌는 칸 · 현재 · 변경 · 평균). 경고가 있으면 빨강 · 버튼도 빨강.
 * - 접수되면 초록 체크를 그리고(`haptic("success")`) 잠깐 뒤 부모에게 넘긴다.
 * - 키보드가 떠도 프리셋은 그대로 둔다(2026-10-02 사용자 지시 — 시안 3d 의 「접기」는 뺐다). 시트 높이는 고정이라 값이
 *   바뀌어도 위 끝이 오르내리지 않는다(부모가 `h-[88dvh]`).
 * - **「1박으로」는 없다** — 1박 갭 고치기는 최소숙박 시트에서만(2026-10-02 사용자 지시).
 * - 접수되면 부모가 시트를 닫고 탭 바 위 알림으로 진행 → 완료(되돌리기) / 실패(이력 보기)를 보여 준다.
 */

export type MobilePriceSheetCopy = PanelCopy & {
  mSelCount: string;
  mpClearInput: string;
  mpConfirmHead: string;
  mpAvgDelta: string;
  mpSameValue: string;
  mpPerCell: string;
  mpSkipped: string;
  scopeClear: string;
  localeTag: string;
  mwPriceInput: string;
  mwPriceInputHint: string;
  mwPctTitle: string;
  mwPctHint: string;
  mwPctCustom: string;
  mwChangeHead: string;
  mwChangedCells: string;
  mwOfCells: string;
  mwAverage: string;
  mwSameValue: string;
  mwPerCellValue: string;
  mwBack: string;
  mwDone: string;
  dateNext: string;
  datePrev: string;
  today: string;
};

export type MobilePriceSubmitted = {
  jobId: string;
  count: number;
  settled: Promise<OpsWriteOutcome> | null;
};

const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

/** 입력칸 표시용 — 숫자만 남겨 쉼표를 넣는다. */
const formatAmountText = (text: string) => {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString("ja-JP") : "";
};

const signedPercent = (value: number) => (value > 0 ? `+${value}%` : value < 0 ? `−${Math.abs(value)}%` : "0%");

/** 기기 키보드의 「완료」(Enter)로 키보드를 내린다. */
const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") event.currentTarget.blur();
};

function errorText(copy: PanelCopy, code: PriceChangeError): string {
  switch (code) {
    case "forbidden":
      return copy.errForbidden;
    case "no_cells":
      return copy.errNoCells;
    case "no_priced_cells":
      return copy.errNoPricedCells;
    case "bad_min_stay":
      return copy.errBadMinStay;
    case "no_writable_room":
      return copy.errNoWritableRoom;
    case "invalid_values":
      return copy.errInvalidValues;
    default:
      return copy.errEnqueueFailed;
  }
}

type ListRow = { date: string; current: number | null; next: number | null };
type ListRoom = { key: string; label: string; rows: ListRow[] };
type ListBuilding = { name: string; rooms: ListRoom[] };

/** 고른 칸을 건물 → 객실 → 날짜로 묶는다(데스크톱 「선택한 칸」 목록과 같은 순서). */
function groupSelection(cells: readonly PanelCell[], nextByCell: ReadonlyMap<string, number>): ListBuilding[] {
  const buildings: ListBuilding[] = [];
  const buildingByName = new Map<string, ListBuilding>();
  const roomByKey = new Map<string, ListRoom>();
  for (const cell of cells) {
    const separator = cell.roomKey.indexOf("::");
    const name = separator >= 0 ? cell.roomKey.slice(0, separator) : "";
    let building = buildingByName.get(name);
    if (!building) {
      building = { name, rooms: [] };
      buildingByName.set(name, building);
      buildings.push(building);
    }
    let room = roomByKey.get(cell.roomKey);
    if (!room) {
      room = { key: cell.roomKey, label: cell.roomLabel, rows: [] };
      roomByKey.set(cell.roomKey, room);
      building.rooms.push(room);
    }
    room.rows.push({ current: cell.price, date: cell.date, next: nextByCell.get(`${cell.roomKey}|${cell.date}`) ?? null });
  }
  for (const room of roomByKey.values()) room.rows.sort((a, b) => a.date.localeCompare(b.date));
  return buildings;
}

export function MobileOpsPriceSheet({
  cells: selectedCells,
  copy,
  exclude,
  onApplied,
  onClear,
  onSubmitted,
  priceAt,
  rooms,
  runWrite,
  scopeSummary: selectionSummary,
  today,
}: {
  /** 격자에서 고른 칸 — 범위의 처음 값. 시트에서 기간 · 요일 · 객실을 고치면 그 범위로 바뀐다(데스크톱과 같은 `usePriceScope`). */
  cells: PanelCell[];
  /** 범위를 펼칠 때 뺄 칸 — 팔린 밤(격자에 보이는 날만 안다). */
  exclude: (roomKey: string, date: string) => boolean;
  /** 격자가 아는 지금 가격 — 격자 창 밖이면 `undefined`(서버에서 읽는다). */
  priceAt: (roomKey: string, date: string) => number | null | undefined;
  rooms: readonly PriceScopeRoom[];
  today: string;
  copy: MobilePriceSheetCopy;
  /** 보낸 칸만 선택에서 뺀다(데스크톱과 같다). */
  onApplied: (sentCells: { roomKey: string; date: string }[]) => void;
  /** 「선택 해제」 — 선택을 비우고 시트를 닫는다. */
  onClear: () => void;
  /** 접수 성공 — 부모가 시트를 닫고 알림을 띄운다. */
  onSubmitted: (submitted: MobilePriceSubmitted) => void;
  runWrite: RunOpsWrite;
  scopeSummary: PanelScopeSummary | null;
}) {
  const scope = usePriceScope({
    andMore: copy.andMore,
    cells: selectedCells,
    exclude,
    priceAt,
    rooms,
    summary: selectionSummary,
    today,
  });
  const cells = scope.cells;
  const scopeSummary = scope.summary;
  const [input, setInput] = useState<AdjustmentInput | null>(null);
  const [amountText, setAmountText] = useState("");
  const [percentText, setPercentText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { done, succeed } = useSuccessThen();

  const preview = useMemo(
    () =>
      buildAdjustmentPreview(
        cells.map((cell) => ({ date: cell.date, price: cell.price, roomKey: cell.roomKey, roomLabel: cell.roomLabel })),
        input ?? { amount: 0, kind: "amount" },
      ),
    [cells, input],
  );
  const listBuildings = useMemo(() => {
    const nextByCell = new Map<string, number>();
    if (input) for (const row of preview.rows) nextByCell.set(`${row.roomKey}|${row.date}`, row.newPrice);
    return groupSelection(cells, nextByCell);
  }, [cells, input, preview]);
  const warnings = useMemo(() => (input ? findAdjustmentWarnings(preview) : []), [input, preview]);
  const currentRange = useMemo(() => {
    if (preview.rows.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const row of preview.rows) {
      min = Math.min(min, row.currentPrice);
      max = Math.max(max, row.currentPrice);
    }
    return { max, min };
  }, [preview]);

  const hasPriced = preview.rows.length > 0;
  const deltaPercent = input && hasPriced ? percentFromAmount(preview.currentAverage, preview.newAverage) : null;
  const roomCount = listBuildings.reduce((sum, building) => sum + building.rooms.length, 0);
  // 버튼 숫자 — 입력 전에는 「바꿀 수 있는 칸」(요금 있는 칸), 입력 뒤에는 실제로 바뀌는 칸.
  const goCount = input ? preview.changedCount : preview.rows.length;
  // 격자 밖 칸의 지금 가격을 아직 못 읽었으면 기다린다(데스크톱과 같다).
  const canGo = input !== null && preview.changedCount > 0 && !pending && !scope.loading && !scope.failed;
  const danger = warnings.length > 0;

  const onAmount = (text: string) => {
    setAmountText(text);
    setError(null);
    const amount = Number.parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(amount)) {
      setInput(null);
      setPercentText("");
      return;
    }
    setInput({ amount, kind: "amount" });
    const percent = percentFromAmount(preview.currentAverage, amount);
    setPercentText(percent === null ? "" : String(percent));
  };
  const onPercent = (value: number) => {
    setError(null);
    setPercentText(String(value));
    setInput({ kind: "percent", percent: value });
    const amount = amountFromPercent(preview.currentAverage, value);
    setAmountText(amount === null ? "" : String(amount));
  };
  const clearInput = () => {
    setInput(null);
    setAmountText("");
    setPercentText("");
    setConfirming(false);
  };

  const apply = () => {
    if (!input) return;
    const rows = preview.rows;
    const count = preview.changedCount;
    const sentInput = input;
    const cellsToSend: PriceChangeCell[] = cells.map((cell) => ({
      currentPrice: cell.price,
      date: cell.date,
      roomIds: cell.roomIds,
      roomKey: cell.roomKey,
      roomLabel: cell.roomLabel,
    }));
    setError(null);
    startTransition(async () => {
      const { result, settled } = await runWrite(
        "price",
        rows.map((row) => ({ key: `${row.roomKey}|${row.date}`, value: row.newPrice })),
        () => submitPriceChange({ cells: cellsToSend, input: sentInput }),
      );
      if (!result.ok) {
        setConfirming(false);
        setError(copy.panelFailed.replace("{error}", errorText(copy, result.error)));
        return;
      }
      // 접수 — 초록 체크를 그리고(햅틱) 잠깐 뒤 부모가 시트를 닫고 알림을 띄운다.
      succeed(() => {
        onApplied(cellsToSend.map((cell) => ({ date: cell.date, roomKey: cell.roomKey })));
        onSubmitted({ count, jobId: result.jobId, settled });
      });
    });
  };

  const range = (min: number, max: number) => (min === max ? yen(min) : `${yen(min)} – ${yen(max)}`);
  const warningText = (warning: string) =>
    warning === "zero" ? copy.warnZero : warning === "huge_drop" ? copy.warnDrop : copy.warnRise;
  const pctOn = input?.kind === "percent" && !PERCENT_PRESETS.some((preset) => preset === input.percent);
  const sub = [scopeSummary?.dates, copy.mSelCount.replace("{n}", String(cells.length))].filter(Boolean).join(" · ");

  return (
    <div className="msw">
      <div className="msw-body">
        {confirming && input ? (
          <div className="msw-step" key="confirm">
            <div className="msw-head">
              <div className="msw-head__t">
                <h3>{copy.mwChangeHead.replace("{n}", String(preview.changedCount))}</h3>
                <p>{[scopeSummary?.rooms, scopeSummary?.dates].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <div className={`msw-sum${danger ? " red" : ""}`} role="status">
              <div className="msw-kv">
                <span className="k">{copy.mwChangedCells}</span>
                <span className="v">
                  {copy.mwOfCells.replace("{total}", String(cells.length)).replace("{n}", String(preview.changedCount))}
                </span>
              </div>
              <div className="msw-kv">
                <span className="k">{copy.panelCurrent}</span>
                <span className="v">{currentRange ? range(currentRange.min, currentRange.max) : "—"}</span>
              </div>
              <div className="msw-kv">
                <span className="k">{copy.panelNext}</span>
                <span className="v">
                  <b className="vi">{range(preview.newMin, preview.newMax)}</b>
                </span>
              </div>
              <div className="msw-kv">
                <span className="k">{copy.mwAverage}</span>
                <span className="v">
                  {[
                    deltaPercent !== null ? signedPercent(deltaPercent) : null,
                    input.kind === "amount" ? copy.mwSameValue : copy.mwPerCellValue,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {preview.skippedNoPrice > 0 && (
                <div className="msw-kv">
                  <span className="k" />
                  <span className="v">{copy.mpSkipped.replace("{n}", String(preview.skippedNoPrice))}</span>
                </div>
              )}
            </div>
            {warnings.map((warning) => (
              <div className="msw-alert" key={warning} role="alert">
                {warningText(warning)}
              </div>
            ))}
            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}
            <p className="msw-note">{copy.panelChannelNote}</p>
          </div>
        ) : (
          <div className="msw-step" key="input">
            <div className="msw-head">
              <div className="msw-head__t">
                <h3>{scopeSummary?.rooms || copy.panelTitle}</h3>
                <p>{sub}</p>
              </div>
              {/* 「선택 해제」 — 선택을 비우고 시트를 닫는다(기존 기능 유지 · 시안엔 없는 글자 버튼). */}
              <button className="msw-link" onClick={onClear} type="button">
                {copy.scopeClear}
              </button>
            </div>

            {/* 범위 — 기간 · 요일 · 객실(2026-10-20, Beds24 와 같이). 처음 값은 격자에서 고른 칸. */}
            <PriceScopeEditor
              copy={copy}
              localeTag={copy.localeTag}
              mobileDateLabels={{ nextMonth: copy.dateNext, prevMonth: copy.datePrev, today: copy.today }}
              rooms={rooms}
              state={scope}
              today={today}
              variant="mobile"
            />

            <div className="msw-cmp">
              <div>
                <span>{copy.panelCurrent}</span>
                {/* 늘 같은 줄 수 — 값이 생기거나 범위가 하나로 모여도 상자 높이가 안 바뀐다(2026-10-02 사용자 지적). */}
                <b className={currentRange ? "" : "dash"}>{currentRange ? range(currentRange.min, currentRange.max) : "—"}</b>
                <span>{currentRange ? copy.panelAverage.replace("{price}", yen(preview.currentAverage)) : "\u00a0"}</span>
              </div>
              <div className={`nx${deltaPercent !== null && deltaPercent < 0 ? " dn" : ""}`}>
                <span>
                  {copy.panelNext}
                  {deltaPercent !== null ? ` · ${signedPercent(deltaPercent)}` : ""}
                </span>
                <b className={input && hasPriced ? "" : "dash"}>{input && hasPriced ? range(preview.newMin, preview.newMax) : "—"}</b>
                <span>{input && hasPriced ? copy.panelAverage.replace("{price}", yen(preview.newAverage)) : "\u00a0"}</span>
              </div>
            </div>

            <MswField hint={copy.mwPriceInputHint} className="hint-end" label={copy.mwPriceInput}>
              <span className="msw-money">
                <span aria-hidden="true">¥</span>
                <input
                  aria-label={copy.panelAmount}
                  autoComplete="off"
                  disabled={!hasPriced}
                  enterKeyHint="done"
                  inputMode="numeric"
                  onChange={(event) => onAmount(event.target.value)}
                  onKeyDown={blurOnEnter}
                  placeholder={currentRange ? yen(preview.currentAverage).slice(1) : "0"}
                  value={formatAmountText(amountText)}
                />
              </span>
            </MswField>

            <div className="msw-step-sub">
              <div className="msw-sec">
                <span>{copy.mwPctTitle}</span>
                {/* 직접 % — 기존 퍼센트 입력칸(프리셋 밖의 값). */}
                <label className={`msw-pctin${pctOn ? " on" : ""}`}>
                  <input
                    aria-label={copy.panelPercent}
                    autoComplete="off"
                    disabled={!hasPriced}
                    enterKeyHint="done"
                    inputMode="numeric"
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value.replace(/[^\d-]/g, ""), 10);
                      if (Number.isFinite(value)) onPercent(value);
                      else {
                        setPercentText(event.target.value);
                        setInput(null);
                      }
                    }}
                    onKeyDown={blurOnEnter}
                    placeholder={copy.mwPctCustom}
                    // 프리셋을 누른 동안엔 비운다(프리셋 버튼이 이미 보라) — 직접 값 · 금액에서 나온 % 만 보인다.
                    value={input?.kind === "percent" && !pctOn ? "" : percentText}
                  />
                  <span>%</span>
                </label>
              </div>
              <div className="msw-grid">
                {PERCENT_PRESETS.map((preset) => {
                  const on = input?.kind === "percent" && input.percent === preset;
                  return (
                    <button
                      aria-pressed={on}
                      className={`msw-opt${on ? " on" : ""}`}
                      disabled={!hasPriced}
                      key={preset}
                      // 같은 프리셋을 다시 누르면 푼다(2026-10-01 사용자 요청).
                      onClick={() => (on ? clearInput() : onPercent(preset))}
                      type="button"
                    >
                      {signedPercent(preset)}
                    </button>
                  );
                })}
                <button className="msw-opt mute" disabled={!input} onClick={clearInput} type="button">
                  {copy.mpClearInput}
                </button>
              </div>
              <span className="msw-field__hint end">{copy.mwPctHint}</span>
            </div>

            {preview.skippedNoPrice > 0 && (
              <div className="msw-alert warn">{copy.panelExcluded.replace("{count}", String(preview.skippedNoPrice))}</div>
            )}
            {input !== null && hasPriced && preview.changedCount === 0 && (
              <div className="msw-alert warn">{copy.panelNoChange}</div>
            )}
            {warnings.map((warning) => (
              <div className="msw-alert" key={warning} role="alert">
                {warningText(warning)}
              </div>
            ))}
            {error && (
              <div className="msw-alert" role="alert">
                {error}
              </div>
            )}

            <p className="msw-note">{copy.panelChannelNote}</p>

            <section aria-label={copy.panelListTitle} className="msw-list">
              <div className="msw-list__h">
                <span>{copy.panelListTitle}</span>
                <small>
                  {copy.panelListRooms.replace("{rooms}", String(roomCount)).replace("{cells}", String(cells.length))}
                </small>
              </div>
              {listBuildings.map((building) => (
                <div className="msw-list" key={building.name}>
                  {listBuildings.length > 1 && <div className="msw-list__b">{building.name}</div>}
                  {building.rooms.flatMap((room) =>
                    room.rows.map((row) => {
                      const changed = row.current !== null && row.next !== null && row.next !== row.current;
                      return (
                        <div className="msw-row" key={`${room.key}|${row.date}`}>
                          <span className="rm">{room.label}</span>
                          <span className="d">{mdWeekday(row.date, copy.localeTag)}</span>
                          {row.current === null ? (
                            <span className="none">{copy.panelListNoPrice}</span>
                          ) : (
                            <>
                              <span className="c">{yen(row.current)}</span>
                              {changed && row.next !== null && (
                                <>
                                  <span aria-hidden="true" className="ar">
                                    →
                                  </span>
                                  <b className={`nx${row.next < row.current ? " dn" : ""}`}>{yen(row.next)}</b>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      );
                    }),
                  )}
                </div>
              ))}
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
            <button className={`msw-btn${danger ? " red" : ""}`} disabled={!canGo} onClick={apply} type="button">
              {copy.panelConfirmBody.replace("{count}", String(preview.changedCount))}
            </button>
          </>
        ) : (
          // 입력 전에도 같은 버튼 · 같은 문구를 흐리게(사용자 지시) — 입력하면 그 자리에서 진해진다.
          <button className="msw-btn" disabled={!canGo} onClick={() => setConfirming(true)} type="button">
            {copy.panelGo.replace("{count}", String(goCount))}
          </button>
        )}
      </div>
      {done && <MswSuccess label={copy.mwDone} />}
    </div>
  );
}
