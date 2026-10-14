"use client";

// 분실물 반환완료 · 폐기 내역 전용 목록(모바일) — 화이트 리디자인(2026-10-14, 시안 LFReturned-Phone).
// 두 화면이 같은 모양이라 하나로 합쳤다(예전 returned-lost-found-list · disposed-lost-found-list).
// 숫자 셋(전체 · 이번 달 · 이번 주) · 검색 + 「필터」(기간 · 건물 시트) · 월별 묶음 · 한 줄 행(품목 / 객실 · 건물 · 처리자 / 방식).
// 상자 · 왼쪽 막대 · 배지 없음. 폐기 내역은 90일 자동 삭제 시계를 보여주지 않는다(관리자 영역, 2026-07-16 결정).
import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Search } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Dictionary, Locale } from "@/lib/i18n";
import "./requests-list.css";
import { FoldyEmpty } from "@/components/shared/foldy-empty";

export type ArchiveItemVM = {
  id: string;
  itemName: string;
  buildingLabel: string;
  roomLabel: string;
  reporterName: string;
  /** 처리자 이름 — 자동 폐기면 「시스템(자동)」 문구가 이미 들어 있다. */
  handlerLabel: string;
  atIso: string | null;
  /** Tokyo YYYY-MM-DD */
  dateKey: string | null;
  /** 둘째 줄(반환 방식 · 송장번호). 없으면 null. */
  extra: string | null;
  /** Tokyo YYYY-MM */
  monthKey: string;
  relativeGroup: "thisMonth" | "lastMonth" | null;
};

type Period = "all" | "today" | "7d" | "30d";

type ArchiveListProps = {
  locale: Locale;
  items: ArchiveItemVM[];
  stats: { total: number; month: number; week: number };
  todayKey: string;
  buildingOptions: string[];
  copy: Pick<
    Dictionary["lostFound"]["returned"],
    | "title"
    | "statTotal"
    | "statMonth"
    | "statWeek"
    | "searchPlaceholder"
    | "filterPeriod"
    | "filterBuilding"
    | "periodAll"
    | "periodToday"
    | "period7d"
    | "period30d"
    | "groupThisMonth"
    | "groupLastMonth"
    | "empty"
    | "filterSheetTitle"
    | "reset"
    | "apply"
  >;
  filterLabel: string;
};

function dayDiff(todayKey: string, key: string): number {
  const [ay, am, ad] = todayKey.split("-").map(Number);
  const [by, bm, bd] = key.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** 도쿄 M/D HH:mm. */
function shortStamp(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`;
}

export function LostFoundArchiveList({ locale, items, stats, todayKey, buildingOptions, copy, filterLabel }: ArchiveListProps) {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [building, setBuilding] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  const periodLabel: Record<Period, string> = {
    all: copy.periodAll,
    today: copy.periodToday,
    "7d": copy.period7d,
    "30d": copy.period30d,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (
        q &&
        !(
          it.itemName.toLowerCase().includes(q) ||
          it.reporterName.toLowerCase().includes(q) ||
          it.handlerLabel.toLowerCase().includes(q) ||
          it.roomLabel.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
      if (building !== "all" && it.buildingLabel !== building) return false;
      if (period !== "all") {
        if (!it.dateKey) return false;
        const diff = dayDiff(todayKey, it.dateKey);
        if (period === "today" && diff !== 0) return false;
        if (period === "7d" && (diff < 0 || diff > 6)) return false;
        if (period === "30d" && (diff < 0 || diff > 29)) return false;
      }
      return true;
    });
  }, [items, query, building, period, todayKey]);

  // 월별 묶음(이미 처리 시각 내림차순 → 순서 유지).
  const groups = useMemo(() => {
    const label = (monthKey: string, rel: ArchiveItemVM["relativeGroup"]) => {
      if (rel === "thisMonth") return copy.groupThisMonth;
      if (rel === "lastMonth") return copy.groupLastMonth;
      const [y, m] = monthKey.split("-").map(Number);
      return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, 1, 3)));
    };
    const out: { key: string; label: string; items: ArchiveItemVM[] }[] = [];
    for (const it of filtered) {
      const last = out[out.length - 1];
      if (last && last.key === it.monthKey) last.items.push(it);
      else out.push({ key: it.monthKey, label: label(it.monthKey, it.relativeGroup), items: [it] });
    }
    return out;
  }, [filtered, locale, copy.groupThisMonth, copy.groupLastMonth]);

  const activeCount = (period !== "all" ? 1 : 0) + (building !== "all" ? 1 : 0);

  return (
    <div className="lfa">
      <h1 className="lfa-title">{copy.title}</h1>

      <div className="lfa-stats">
        {[
          [copy.statTotal, stats.total],
          [copy.statMonth, stats.month],
          [copy.statWeek, stats.week],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>

      <div className="lfa-bar">
        <label className="lfa-search">
          <Search aria-hidden="true" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchPlaceholder}
            type="search"
            value={query}
          />
        </label>
        <button className={`rqw-filter${activeCount ? " is-on" : ""}`} onClick={() => setSheetOpen(true)} type="button">
          {filterLabel}
          {activeCount ? <b>{activeCount}</b> : <ChevronDown aria-hidden="true" />}
        </button>
      </div>

      {filtered.length === 0 ? (
        <FoldyEmpty title={copy.empty} />
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <div className="rqw-gh">
              <span>{group.label}</span>
              <b>{group.items.length}</b>
            </div>
            <div className="rqw-list">
              {group.items.map((it) => (
                <Link className="rqw-row lfa-row" href={`/mobile/requests/lost-found/${it.id}`} key={it.id}>
                  <span className="rqw-row__b">
                    <span className="rqw-row__t">{it.itemName}</span>
                    <span className="rqw-row__m">
                      {[it.roomLabel, it.buildingLabel, it.handlerLabel].filter((x) => x && x !== "-").join(" · ")}
                    </span>
                    {it.extra ? <span className="lfa-extra">{it.extra}</span> : null}
                  </span>
                  <span className="lfa-at">{it.atIso ? shortStamp(it.atIso) : "-"}</span>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}

      {sheetOpen ? (
        <BottomSheet
          ariaLabel={copy.filterSheetTitle}
          className="flex max-h-[85dvh] flex-col"
          header={<p className="lfa-sheet__t">{copy.filterSheetTitle}</p>}
          onClose={() => setSheetOpen(false)}
          zIndexClassName="z-[95]"
        >
          {({ close }) => (
            <div className="lfa-sheet">
              <span className="lfa-sheet__k">{copy.filterPeriod}</span>
              <div className="rqw-seg lfa-seg" role="radiogroup" aria-label={copy.filterPeriod}>
                {(["all", "today", "7d", "30d"] as Period[]).map((p) => (
                  <button aria-checked={period === p} role="radio" className={period === p ? "on" : undefined} key={p} onClick={() => setPeriod(p)} type="button">
                    {periodLabel[p]}
                  </button>
                ))}
              </div>
              {buildingOptions.length > 0 ? (
                <>
                  <span className="lfa-sheet__k">{copy.filterBuilding}</span>
                  <div className="lfa-opts" role="radiogroup" aria-label={copy.filterBuilding}>
                    {["all", ...buildingOptions].map((b) => (
                      <button aria-checked={building === b} role="radio" className={building === b ? "on" : undefined} key={b} onClick={() => setBuilding(b)} type="button">
                        {b === "all" ? copy.periodAll : b}
                        {building === b ? <Check aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="lfa-sheet__foot">
                <button
                  className="lfa-sheet__reset"
                  disabled={period === "all" && building === "all"}
                  onClick={() => {
                    setPeriod("all");
                    setBuilding("all");
                  }}
                  type="button"
                >
                  {copy.reset}
                </button>
                <button className="lfa-sheet__apply" onClick={close} type="button">
                  {copy.apply}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}
