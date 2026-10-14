"use client";

// 린넨 장부 — 화이트 리디자인(2026-10-14, 시안 LinenLedger-Phone · LinenLedgerItems-Phone): [기록 | 품목 집계] 토글 →
// 글자 고르기(내 등록만 · 등록자 · 품목) → 숫자 둘(반품 장수 · 기록 건수) → 한 줄 기록 / 품목 막대. 상자 · 칩 · 그라데이션 제거.

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { LinenItemOption, LinenReturnRecord } from "@/lib/linen-returns";

type LinenLedgerViewProps = {
  building: string;
  copy: Dictionary["linenReturn"];
  currentUserId: string;
  locale: Locale;
  records: LinenReturnRecord[];
  /** 이 건물의 활성 품목 — 품목 집계에 반품 0 인 품목도 보이려고(2026-10-14). */
  catalog?: LinenItemOption[];
};

type Mode = "records" | "aggregate";

export function LinenLedgerView({
  building,
  copy,
  currentUserId,
  records,
  catalog = [],
}: LinenLedgerViewProps) {
  const [mode, setMode] = useState<Mode>("records");
  const [mineOnly, setMineOnly] = useState(false);
  const [registrant, setRegistrant] = useState<string>("");
  const [itemId, setItemId] = useState<string>("");
  const [openFilter, setOpenFilter] = useState<"registrant" | "item" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenFilter(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const registrants = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) map.set(r.registeredByUserId, r.registrantName);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [records]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) for (const l of r.lines) map.set(l.itemId, l.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [records]);

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        if (mineOnly && r.registeredByUserId !== currentUserId) return false;
        if (registrant && r.registeredByUserId !== registrant) return false;
        if (itemId && !r.lines.some((l) => l.itemId === itemId)) return false;
        return true;
      }),
    [records, mineOnly, currentUserId, registrant, itemId],
  );

  const relevantQty = (record: LinenReturnRecord) =>
    itemId
      ? record.lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.quantity, 0)
      : record.totalQuantity;

  const totalRecords = filtered.length;
  const totalQty = filtered.reduce((sum, r) => sum + relevantQty(r), 0);

  const aggregate = useMemo(() => {
    const agg = new Map<string, { name: string; qty: number; count: number }>();
    for (const r of filtered) {
      for (const l of r.lines) {
        if (itemId && l.itemId !== itemId) continue;
        const entry = agg.get(l.itemId) ?? { name: l.name, qty: 0, count: 0 };
        entry.qty += l.quantity;
        entry.count += 1;
        agg.set(l.itemId, entry);
      }
    }
    return Array.from(agg.values()).sort((a, b) => b.qty - a.qty);
  }, [filtered, itemId]);
  const maxQty = aggregate.length ? aggregate[0].qty : 1;

  const registrantLabel = registrant
    ? registrants.find((r) => r.id === registrant)?.name ?? copy.filterRegistrant
    : copy.allRegistrants;
  const itemLabel = itemId ? itemOptions.find((i) => i.id === itemId)?.name ?? copy.filterItem : copy.allItems;

  const buildingParam = encodeURIComponent(building);
  // 품목 집계: 반품이 없던 품목도 0 으로 보여 준다(「반품 없음」과 「품목 없음」을 구분 — PC 품목별 수량과 같다).
  const aggRows = (() => {
    const rows = [...aggregate];
    if (!itemId) {
      for (const it of catalog) {
        if (!rows.some((r) => r.name === it.name)) rows.push({ name: it.name, qty: 0, count: 0 });
      }
    }
    return rows;
  })();

  return (
    <div className="lnw-ledger" ref={wrapRef}>
      <div className="lnw-seg" role="tablist">
        {(["records", "aggregate"] as const).map((m) => (
          <button
            aria-selected={mode === m}
            className={mode === m ? "on" : ""}
            key={m}
            onClick={() => setMode(m)}
            role="tab"
            type="button"
          >
            {m === "records" ? copy.wModeRecords : copy.wModeAgg}
          </button>
        ))}
      </div>

      <div className="lnw-filters">
        <button aria-pressed={mineOnly} className={`lnw-fbtn${mineOnly ? " on" : ""}`} onClick={() => setMineOnly((v) => !v)} type="button">
          {mineOnly ? <Check aria-hidden="true" /> : null}
          {copy.wMineOnly}
        </button>
        <FilterMenu label={registrantLabel} onToggle={() => setOpenFilter(openFilter === "registrant" ? null : "registrant")} open={openFilter === "registrant"}>
          <FilterOption active={!registrant} label={copy.allRegistrants} onClick={() => { setRegistrant(""); setOpenFilter(null); }} />
          {registrants.map((r) => (
            <FilterOption active={registrant === r.id} key={r.id} label={r.name} onClick={() => { setRegistrant(r.id); setOpenFilter(null); }} />
          ))}
        </FilterMenu>
        <FilterMenu align="right" label={itemLabel} onToggle={() => setOpenFilter(openFilter === "item" ? null : "item")} open={openFilter === "item"}>
          <FilterOption active={!itemId} label={copy.allItems} onClick={() => { setItemId(""); setOpenFilter(null); }} />
          {itemOptions.map((i) => (
            <FilterOption active={itemId === i.id} key={i.id} label={i.name} onClick={() => { setItemId(i.id); setOpenFilter(null); }} />
          ))}
        </FilterMenu>
      </div>

      <div className="lnw-kpis is-ledger">
        <div>
          <span>{copy.wQtyLabel}</span>
          <b className="num">
            {totalQty}
            <small>{copy.quantityUnit}</small>
          </b>
        </div>
        <div>
          <span>{copy.wRecordsLabel}</span>
          <b className="num">
            {totalRecords}
            <small>{copy.countUnit}</small>
          </b>
        </div>
      </div>

      {mode === "records" ? (
        filtered.length === 0 ? (
          <div className="lnw-empty-state">
            <b>{copy.noLedgerResultTitle}</b>
            <span>{copy.noLedgerResultSub}</span>
          </div>
        ) : (
          <div className="lnw-rows">
            {filtered.map((r) => {
              const t = parts(r.registeredAt);
              return (
                <Link className="lnw-row" href={`/mobile/linen-return/record/${r.id}?building=${buildingParam}`} key={r.id}>
                  <span className="lnw-row__d num">
                    <b>{t.md}</b>
                    <span>{t.hm}</span>
                  </span>
                  <span className="lnw-row__b">
                    <b>{r.lines.length ? r.lines.map((l) => `${l.name} ${l.quantity}`).join(" · ") : "—"}</b>
                    <span>
                      {r.registrantName}
                      {r.imageUrls.length > 0 ? ` · ${copy.wPhotoN.replace("{n}", String(r.imageUrls.length))}` : ""}
                    </span>
                  </span>
                  <span className="lnw-row__q num">
                    {relevantQty(r)}
                    <small>{copy.quantityUnit}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        )
      ) : (
        <>
          <p className="lnw-note">{copy.wAggNote}</p>
          {aggRows.length === 0 ? (
            <div className="lnw-empty-state">
              <b>{copy.noAggTitle}</b>
              <span>{copy.noLedgerResultSub}</span>
            </div>
          ) : (
            <div className="lnw-agg">
              {aggRows.map((row, idx) => (
                <div className={`lnw-agg__row${row.qty === 0 ? " is-zero" : ""}`} key={`${row.name}-${idx}`}>
                  <div className="lnw-agg__h">
                    <span>{row.name}</span>
                    <span className="num">
                      {copy.wAggLine.replace("{q}", String(row.qty)).replace("{c}", String(row.count))}
                    </span>
                  </div>
                  <span className="lnw-agg__bar" aria-hidden="true">
                    <i style={{ width: `${row.qty ? Math.max(4, Math.round((row.qty / maxQty) * 100)) : 0}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 도쿄 기준 「M/D」 · 「HH:mm」. */
function parts(iso: string): { md: string; hm: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { md: `${+g("month")}/${+g("day")}`, hm: `${g("hour")}:${g("minute")}` };
}

function FilterMenu({
  align = "left",
  children,
  label,
  onToggle,
  open,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
  label: string;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <div className="lnw-fmenu">
      <button aria-expanded={open} className="lnw-fbtn" onClick={onToggle} type="button">
        <span>{label}</span>
        <ChevronDown aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open ? <ul className={`lnw-fmenu__list${align === "right" ? " is-right" : ""}`}>{children}</ul> : null}
    </div>
  );
}

function FilterOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <li>
      <button className={active ? "on" : ""} onClick={onClick} type="button">
        {label}
      </button>
    </li>
  );
}
