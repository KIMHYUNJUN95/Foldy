"use client";

/* eslint-disable @next/next/no-img-element */

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Receipt, X } from "lucide-react";
import type { AdminReceiptItem, AdminTransportReceiptsView } from "@/lib/admin-attendance";
import { getDictionary, type Locale } from "@/lib/i18n";
import { refreshAdminTransportReceiptUrlsAction } from "@/app/admin/attendance/actions";
import { useBodyScrollLock } from "@/components/shell/use-body-scroll-lock";
import { receiptEvidenceState } from "@/lib/transport-receipt-ui";
import { adminTransportStatusPill } from "../shared/admin-format";
import "@/components/admin/admin-console.css";
import "@/components/admin/shared/adm-dropdown.css";

// 데스크톱 영수증 검토 화면 — 그 달 영수증의 컨택트 시트 그리드(썸네일 전부 한눈에,
// 각각 날짜/금액/건물 캡션 포함)라서, 사진을 한 장씩 보는 레이아웃의 낭비되는 여백 없이
// 한 달 치를 한 화면에서 훑어볼 수 있다. 썸네일을 누르면 포커스 오버레이가 열린다
// (큰 이미지, 클릭 확대, 모든 영수증 간 ←/→ 이동, "원본 열기", Esc/배경 클릭으로 닫기).

type PhotoCell = { url: string; item: AdminReceiptItem; photoNo: number; photoCount: number };

function fmtDate(usageDate: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${usageDate}T00:00:00+09:00`));
}

export function TransportReceiptView({
  data,
  locale,
  localeTag,
}: {
  data: AdminTransportReceiptsView;
  locale: Locale;
  localeTag: string;
}) {
  const c = getDictionary(locale).admin.attendanceConsole;
  const nf = useMemo(() => new Intl.NumberFormat(localeTag), [localeTag]);
  const yen = useCallback((n: number) => `${c.yenSym}${nf.format(n)}`, [c.yenSym, nf]);
  const pill = adminTransportStatusPill(data.reportStatus, c);

  // 서명 주소는 10분 — 다시 받으면 항목별로 갈아 끼운다. 그림이 깨진 주소는 `broken` 에 모아 「불러오지 못함」으로 본다.
  const [items, setItems] = useState<AdminReceiptItem[]>(data.items);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; msg: string } | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(t);
  }, [notice]);
  // 서버가 새 목록을 주면(달 바꾸기 · 새로고침) 렌더 중에 맞춘다 — 효과 안 setState 를 피한다.
  const [seenItems, setSeenItems] = useState(data.items);
  if (seenItems !== data.items) {
    setSeenItems(data.items);
    setItems(data.items);
    setBroken(new Set());
  }

  const refreshItem = useCallback(async (itemId: string) => {
    setRefreshing(itemId);
    try {
      const res = await refreshAdminTransportReceiptUrlsAction(itemId).catch(() => null);
      if (!res || !res.ok) {
        setNotice((prev) => ({ id: (prev?.id ?? 0) + 1, msg: c.trReceiptRefreshFailed }));
        return;
      }
      const old = itemsRef.current.find((it) => it.itemId === itemId);
      setItems((prev) =>
        prev.map((it) =>
          it.itemId === itemId
            ? {
                ...it,
                imageCount: res.images.length,
                imageUrls: res.images.flatMap((i) => (i.url ? [i.url] : [])),
                imageUrlsFailed: res.imageUrlsFailed,
              }
            : it,
        ),
      );
      // 이 항목의 옛 주소만 깨짐 목록에서 뺀다 — 다른 항목의 표시는 그대로.
      if (old) {
        const gone = new Set(old.imageUrls);
        setBroken((prev) => new Set([...prev].filter((u) => !gone.has(u))));
      }
    } finally {
      setRefreshing(null);
    }
  }, [c.trReceiptRefreshFailed]);

  // 모든 영수증 사진을 순서 있는 하나의 시퀀스로 펼쳐 그리드 + 포커스 탐색에 쓴다.
  const photos = useMemo<PhotoCell[]>(
    () =>
      items.flatMap((item) => {
        const urls = item.imageUrls.filter((u) => !broken.has(u));
        return urls.map((url, k) => ({ url, item, photoNo: k + 1, photoCount: urls.length }));
      }),
    [items, broken],
  );
  // 「누락」은 붙은 사진이 0장일 때만. 사진은 있는데 주소를 못 받았거나 깨진 것은 「불러오지 못함」(다시 받기).
  const evidence = useMemo(
    () =>
      items.map((it) => ({
        item: it,
        state: receiptEvidenceState({
          imageCount: it.imageCount,
          imageUrlsFailed: it.imageUrlsFailed,
          usableUrlCount: it.imageUrls.filter((u) => !broken.has(u)).length,
        }),
      })),
    [items, broken],
  );
  const missingItems = evidence.filter((e) => e.state === "missing").map((e) => e.item);
  const failedItems = evidence.filter((e) => e.state === "failed").map((e) => e.item);

  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  // 확대는 「어느 사진을 확대했나」로 둔다 — 다른 사진으로 넘기면 저절로 풀린다.
  const [zoomIdx, setZoomIdx] = useState<number | null>(null);
  const zoom = focusIdx !== null && zoomIdx === focusIdx;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // 사진이 줄어(깨짐 · 다시 받기) 가리키던 자리가 사라지면 겹침 · 잠금도 같이 끝난다.
  useBodyScrollLock(focusIdx !== null && photos[focusIdx] !== undefined);

  const closeFocus = useCallback(() => setFocusIdx(null), []);

  // 사진이 줄어 가리키던 자리가 사라지면 마지막 사진으로 당기고, 하나도 없으면 닫는다(렌더 중 맞춤).
  if (focusIdx !== null && photos[focusIdx] === undefined) {
    setFocusIdx(photos.length > 0 ? photos.length - 1 : null);
  }
  // 닫히면(직접 · 사진이 모두 사라져서) 눌렀던 썸네일로 포커스를 돌려준다.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (focusIdx !== null) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      returnFocusRef.current?.focus();
    }
  }, [focusIdx]);

  const thumbLabel = useCallback(
    (cell: PhotoCell, i: number) =>
      c.trReceiptThumbAria
        .replace("{n}", String(i + 1))
        .replace("{total}", String(photos.length))
        .replace("{date}", fmtDate(cell.item.usageDate, localeTag))
        .replace("{amount}", yen(cell.item.amountYen)),
    [c.trReceiptThumbAria, photos.length, localeTag, yen],
  );

  const move = useCallback(
    (delta: number) => {
      setFocusIdx((i) => {
        if (i === null) return i;
        return Math.min(photos.length - 1, Math.max(0, i + delta));
      });
    },
    [photos.length],
  );

  useEffect(() => {
    if (focusIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeFocus();
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "Tab") {
        // 포커스 가두기 — 대화상자 안의 버튼 · 링크만 돈다.
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusIdx, move, closeFocus]);

  // 열리면 닫기 버튼으로 포커스를 옮긴다.
  useEffect(() => {
    if (focusIdx === null) return;
    closeBtnRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 열릴 때만(←/→ 로 넘길 때는 그대로)
  }, [focusIdx === null]);

  const focus = focusIdx !== null ? photos[focusIdx] : null;

  return (
    <div className="adm" style={{ minHeight: "100dvh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "6px 12px",
          padding: "14px 22px",
          borderBottom: "1px solid var(--line)",
          background: "var(--adm-surface)",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        <span className="ic" style={{ color: "var(--adm-primary)" }}>
          <Receipt />
        </span>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
          {data.staffName}
        </div>
        <span className={`pill ${pill.cls}`}>
          <span className="d" />
          {pill.label}
        </span>
        <span style={{ color: "var(--adm-muted)", fontSize: 13 }}>{data.monthLabel}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--adm-muted)" }}>
          {c.trReceiptCount(items.length)} · {c.trReceiptPhotoCount(photos.length)}
        </span>
        <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
          {yen(data.totalAmount)}
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <div className="state">
            <span className="state__ic empty">
              <span className="ic">
                <ImageOff />
              </span>
            </span>
            <div className="state__s">
              {data.reportStatus === "none" ? c.trReceiptEmptyNone : c.trReceiptEmptyNoItems}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "20px 22px 40px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 16,
            }}
          >
            {photos.map((cell, i) => (
              <button
                key={`${cell.item.itemId}-${cell.photoNo}`}
                type="button"
                aria-label={thumbLabel(cell, i)}
                onClick={(e) => {
                  returnFocusRef.current = e.currentTarget;
                  setZoomIdx(null);
                  setFocusIdx(i);
                }}
                style={{
                  padding: 0,
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "var(--adm-surface)",
                  cursor: "zoom-in",
                  textAlign: "left",
                  boxShadow: "0 4px 14px -10px rgba(31,42,68,.4)",
                }}
              >
                <div style={{ position: "relative", aspectRatio: "3 / 4", background: "var(--surface2)" }}>
                  <Image
                    src={cell.url}
                    alt=""
                    fill
                    sizes="180px"
                    style={{ objectFit: "cover" }}
                    onError={() => setBroken((prev) => new Set(prev).add(cell.url))}
                  />
                  {cell.photoCount > 1 ? (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        fontSize: 10,
                        fontWeight: 800,
                        color: "#fff",
                        background: "rgba(0,0,0,.55)",
                        borderRadius: 6,
                        padding: "1px 6px",
                      }}
                    >
                      {cell.photoNo}/{cell.photoCount}
                    </span>
                  ) : null}
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)" }}>
                      {fmtDate(cell.item.usageDate, localeTag)}
                    </span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>
                      {yen(cell.item.amountYen)}
                    </span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11, color: "var(--adm-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cell.item.buildingLabel || cell.item.contextLabel || "—"}
                  </div>
                </div>
              </button>
            ))}

            {/* 사진은 있는데 주소를 못 받았거나 깨진 항목 — 「누락」이 아니라 다시 받기. */}
            {failedItems.map((item) => (
              <div
                key={`failed-${item.itemId}`}
                role="alert"
                style={{
                  border: "1px dashed var(--line)",
                  borderRadius: 12,
                  background: "var(--adm-surface)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ aspectRatio: "3 / 4", display: "grid", placeItems: "center", color: "var(--warn)", padding: 10 }}>
                  <span style={{ display: "grid", placeItems: "center", gap: 8, fontSize: 12, fontWeight: 700, textAlign: "center" }}>
                    <span className="ic">
                      <ImageOff />
                    </span>
                    {c.trReceiptLoadFailed}
                    <button
                      type="button"
                      className="chipbtn"
                      disabled={refreshing === item.itemId}
                      onClick={() => void refreshItem(item.itemId)}
                    >
                      {c.trReceiptRetry}
                    </button>
                  </span>
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)" }}>
                      {fmtDate(item.usageDate, localeTag)}
                    </span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>
                      {yen(item.amountYen)}
                    </span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11, color: "var(--adm-muted)" }}>
                    {item.buildingLabel || item.contextLabel || "—"}
                  </div>
                </div>
              </div>
            ))}

            {/* 영수증이 없는 항목 — 빠진 날이 회계 쪽에서 눈에 안 띄는 일이 없도록 보여준다. */}
            {missingItems.map((item) => (
              <div
                key={`empty-${item.itemId}`}
                style={{
                  border: "1px dashed var(--line)",
                  borderRadius: 12,
                  background: "var(--adm-surface)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ aspectRatio: "3 / 4", display: "grid", placeItems: "center", color: "var(--warn)" }}>
                  <span style={{ display: "grid", placeItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
                    <span className="ic">
                      <ImageOff />
                    </span>
                    {c.trReceiptMissing}
                  </span>
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)" }}>
                      {fmtDate(item.usageDate, localeTag)}
                    </span>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>
                      {yen(item.amountYen)}
                    </span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11, color: "var(--adm-muted)" }}>
                    {item.buildingLabel || item.contextLabel || "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 포커스 오버레이 */}
      {focus ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={c.trReceiptDialogLabel
            .replace("{date}", fmtDate(focus.item.usageDate, localeTag))
            .replace("{amount}", yen(focus.item.amountYen))}
          onClick={closeFocus}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(15,20,34,.82)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 포커스 상단 바 */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 12px", padding: "14px 18px", color: "#fff" }}
          >
            <span style={{ fontSize: 14, fontWeight: 800 }}>{fmtDate(focus.item.usageDate, localeTag)}</span>
            <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{yen(focus.item.amountYen)}</span>
            {focus.item.buildingLabel ? (
              <span style={{ fontSize: 13, opacity: 0.8 }}>· {focus.item.buildingLabel}</span>
            ) : null}
            <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
              {focusIdx! + 1} / {photos.length}
            </span>
            <a
              href={focus.url}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none", opacity: 0.9 }}
            >
              <span className="ic"><ExternalLink /></span>
              {c.trReceiptOpenOriginal}
            </a>
            <button ref={closeBtnRef} type="button" onClick={closeFocus} aria-label={c.panelClose} style={FOCUS_ICON_BTN}>
              <span className="ic"><X /></span>
            </button>
          </div>

          {/* 포커스 이미지 영역 */}
          <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 64px 24px" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); move(-1); }}
              disabled={focusIdx === 0}
              aria-label={c.panelPrev}
              style={{ ...FOCUS_NAV_BTN, left: 12 }}
            >
              <span className="ic"><ChevronLeft /></span>
            </button>

            <div
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "100%", maxHeight: "100%", overflow: zoom ? "auto" : "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <img
                src={focus.url}
                alt={thumbLabel(focus, focusIdx ?? 0)}
                onError={() => setBroken((prev) => new Set(prev).add(focus.url))}
                onClick={() => setZoomIdx((z) => (z === focusIdx ? null : focusIdx))}
                title={c.trReceiptOpenHint}
                style={{
                  display: "block",
                  width: zoom ? "auto" : "auto",
                  height: zoom ? "auto" : "auto",
                  maxWidth: zoom ? "none" : "min(90vw, 1100px)",
                  maxHeight: zoom ? "none" : "82vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  background: "#fff",
                  cursor: zoom ? "zoom-out" : "zoom-in",
                  boxShadow: "0 20px 60px -20px rgba(0,0,0,.7)",
                }}
              />
            </div>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); move(1); }}
              disabled={focusIdx === photos.length - 1}
              aria-label={c.panelNext}
              style={{ ...FOCUS_NAV_BTN, right: 12 }}
            >
              <span className="ic"><ChevronRight /></span>
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div key={notice.id} role="status" className="adm-toast" onClick={() => setNotice(null)}>
          {notice.msg}
        </div>
      ) : null}
    </div>
  );
}

const FOCUS_ICON_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.25)",
  background: "rgba(255,255,255,.1)",
  color: "#fff",
  cursor: "pointer",
};

const FOCUS_NAV_BTN: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,.25)",
  background: "rgba(255,255,255,.12)",
  color: "#fff",
  cursor: "pointer",
};
