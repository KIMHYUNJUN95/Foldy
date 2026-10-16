"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type CellHistory, viewHistoryEntry } from "@/lib/ops-price-history";
import "./ops-calendar-tools-white.css";

/**
 * 가격 칸 호버 카드 — 「누가 언제 얼마에서 얼마로」.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「가격 이력 호버 카드」
 * 원본: STAY ARI Manager 가격 칸 툴팁(가격+minStay 머리, 증감액, 시각·작성자, 「외 N건」)
 *
 * 브라우저 `title` 을 대신한다 — 1초 늦게 뜨고, 글자만 늘어놓아 증감이 안 읽혔다.
 *
 * - **읽기 전용이다.** 포인터를 받지 않는다(`pointer-events: none`) — 격자 드래그를 가리면 안 된다.
 * - 칸 **아래**에 띄우고 자리가 없으면 위로 뒤집는다. 좌우는 화면 안으로 민다.
 * - `.ops` 안에 `absolute` 로 붙인다. 콘솔 색(`.adm`)·운영 색(`.ops`) 토큰을 그대로 물려받고,
 *   조상에 `transform` 이 있어도 `fixed` 처럼 어긋나지 않는다.
 * - 화이트 리디자인(2026-10-16, 시안 SalesCell-Phone): 머리(객실 · 날짜 · 현재 값) → 「변경 이력 · N회 변경」 →
 *   줄마다 왼쪽 종류 · 오른쪽 「이전(취소선) → 이후 · 증감」 + 누가 · 언제(Beds24 는 회색 꼬리표).
 *   모바일은 같은 카드를 칸 이력 시트(`.mops-hc`)에 그대로 놓는다. 루트 `opshc` 는 자리 · 모바일 규칙용으로 남긴다.
 */

export type CellHistoryCardCopy = {
  hcNow: string;
  hcPrice: string;
  hcMinStay: string;
  hcHistory: string;
  hcCount: string;
  hcLoading: string;
  hcBlock: string;
  hcBlockOn: string;
  hcBlockOff: string;
  hcBeds24Note: string;
  hsSourceBeds24: string;
  minStay: string;
  historyMore: string;
  unknownUser: string;
};

const GAP = 6;
const EDGE = 8;

const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

export function OpsCellHistoryCard({
  anchor,
  container,
  copy,
  currentMinStay,
  currentPrice,
  date,
  history,
  localeTag,
  roomTitle,
}: {
  /** 호버 중인 칸의 화면 좌표. */
  anchor: DOMRect;
  /** 카드를 붙일 `.ops` 요소. */
  container: HTMLElement;
  copy: CellHistoryCardCopy;
  currentMinStay: number | null;
  currentPrice: number | null;
  date: string;
  /**
   * 그 칸의 이력. **`null` 이면 아직 받는 중이다** — 이력은 카드가 뜰 때 칸 하나 것만 서버에서 받는다
   * (2026-09-30 속도). 머리(현재 가격·최소숙박)는 격자에 이미 있으므로 먼저 그린다.
   */
  history: CellHistory | null;
  localeTag: string;
  roomTitle: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const loaded = history !== null;
  const [place, setPlace] = useState<{ left: number; top: number; side: "below" | "above" } | null>(null);

  // 크기를 재야 뒤집을지 안다 — 첫 그림은 숨긴 채로 재고 바로 자리를 잡는다.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { height, width } = card.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const below = anchor.bottom + GAP + height <= window.innerHeight - EDGE;
    const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - height);
    const left = Math.min(
      Math.max(EDGE, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - EDGE,
    );
    setPlace({ left: left - box.left, side: below ? "below" : "above", top: top - box.top });
    // 이력이 도착하면 카드 높이가 바뀐다 — 그때 한 번 더 자리를 잡는다(아래로 넘치면 위로 뒤집는다).
  }, [anchor, container, loaded]);

  const [y, m, d] = date.split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  const hidden = history ? history.total - history.entries.length : 0;
  const nights = (n: number) => copy.minStay.replace("{n}", String(n));
  const views = (history?.entries ?? []).map(viewHistoryEntry);
  const anyBeds24 = views.some((view) => view.fromBeds24);
  const nowParts = [
    `${copy.hcNow} ${currentPrice === null ? "–" : yen(currentPrice)}`,
    currentMinStay !== null ? `${copy.hcMinStay} ${nights(currentMinStay)}` : null,
  ].filter(Boolean);

  return createPortal(
    <div
      className={`opshc stw-hc${place ? ` is-${place.side}` : ""}`}
      ref={cardRef}
      role="tooltip"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      <div className="stw-hc__head">
        <b className="stw-hc__room">{roomTitle}</b>
        <span className="stw-hc__sub">
          {dateLabel} · {nowParts.join(" · ")}
        </span>
      </div>

      <div className="stw-hc__sec">
        {copy.hcHistory}
        {history && <span> · {copy.hcCount.replace("{n}", String(history.total))}</span>}
      </div>

      {!history && (
        <div aria-live="polite" className="stw-hc__more">
          {copy.hcLoading}
        </div>
      )}

      <ol className="stw-hc__list">
        {views.map((view, index) => {
          const show = (value: number | null) =>
            value === null
              ? "—"
              : view.field === "minStay"
                ? nights(value)
                : view.field === "block"
                  ? value === 1
                    ? copy.hcBlockOn
                    : copy.hcBlockOff
                  : yen(value);
          // 차단은 증감 줄이 없다(상태다).
          const change =
            view.field !== "block" && view.delta !== null && view.delta !== 0
              ? [
                  `${view.delta > 0 ? "+" : "−"}${view.field === "minStay" ? nights(Math.abs(view.delta)) : yen(Math.abs(view.delta))}`,
                  view.percent !== null ? `${view.percent > 0 ? "+" : "−"}${Math.abs(view.percent).toFixed(1)}%` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : null;
          return (
            <li className="stw-hc__row" key={`${view.when}-${index}`} style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
              <span className="stw-hc__kind">
                {view.field === "minStay" ? copy.hcMinStay : view.field === "block" ? copy.hcBlock : copy.hcPrice}
              </span>
              <div className="stw-hc__main">
                <div className="stw-hc__vals">
                  {view.from !== null && <s>{show(view.from)}</s>}
                  {view.from !== null && <span aria-hidden="true"> → </span>}
                  <b>{show(view.to)}</b>
                  {change && <em className={view.direction === "up" ? "is-up" : "is-down"}>{change}</em>}
                </div>
                <div className="stw-hc__meta">
                  {view.fromBeds24 ? (
                    <span className="stw-tag">{view.by ?? copy.hsSourceBeds24}</span>
                  ) : (
                    <span>{view.by ?? copy.unknownUser}</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{view.when.replace(/^(\d\d)-(\d\d)/, "$1/$2")}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {hidden > 0 && <div className="stw-hc__more">{copy.historyMore.replace("{count}", String(hidden))}</div>}
      {anyBeds24 && <p className="stw-hc__note">{copy.hcBeds24Note}</p>}
    </div>,
    container,
  );
}
