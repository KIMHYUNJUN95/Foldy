"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, List, Map as MapIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { Dictionary } from "@/lib/i18n";
import { getPropertyLocation } from "@/lib/property-locations";
import type { MapBuilding } from "./building-map/building-map";
import { decideMapIntro } from "./building-map/map-intro";
import "./building-picker.css";

// 지도(신주쿠구 경계 데이터 포함)는 지도 보기를 열 때만 받는다 — 목록은 바로 뜬다.
const BuildingMap = dynamic(() => import("./building-map/building-map").then((m) => m.BuildingMap), { ssr: false });

export type BuildingPickerRow = { property: string; label: string; rooms: number; empty: number; href: string };

const VIEW_KEY = "foldy.calPick.view";
type View = "map" | "list";
const listeners = new Set<() => void>();
function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "map";
  } catch {
    return "map";
  }
}
function writeView(v: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // 저장이 막혀도 이번 화면에선 바뀐다(아래 메모리 값).
  }
  memoryView = v;
  listeners.forEach((l) => l());
}
let memoryView: View | null = null;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * 예약 캘린더 「건물 고르기」(2026-10-15) — 지도 | 목록.
 * 지도: 실제 신주쿠구 위에 건물 블록(BuildingMap). 건물을 누르면 다가가 고르고, 한 번 더(또는 이름표의 「달력 보기」) 누르면
 * 그 건물 달력. 아래 목록은 지도와 같이 움직인다(고른 건물 줄 강조). 고른 보기는 기기에 기억한다.
 * 폰: 지도 위 · 목록 아래(지도 아래로 겹쳐 올라온 흰 판). 폴드 · 태블릿: 지도 왼쪽 · 목록 오른쪽.
 */
export function BuildingPicker({ rows, w }: { rows: BuildingPickerRow[]; w: Dictionary["mobile"]["calendarW"] }) {
  const router = useRouter();
  const view = useSyncExternalStore(subscribe, () => memoryView ?? readView(), () => "map" as View);
  const [selected, setSelected] = useState<string | null>(null);
  // 지도의 처음 장면과 같은 박자로 목록 판이 올라오고 줄이 차례로 들어온다(세션마다 한 번).
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view === "map") setIntro(decideMapIntro());
  }, [view]);

  const buildings = useMemo<MapBuilding[]>(
    () =>
      rows.flatMap((r) => {
        const loc = getPropertyLocation(r.property);
        return loc ? [{ id: r.property, label: loc.mapLabel ?? r.label, rooms: r.rooms, empty: r.empty, lat: loc.lat, lng: loc.lng }] : [];
      }),
    [rows],
  );
  const totalEmpty = rows.reduce((a, r) => a + r.empty, 0);

  const list = (
    <div className="mcw-blist">
      {rows.map((row, i) => {
        const on = view === "map" && row.property === selected;
        return (
          <Link
            aria-current={on ? "true" : undefined}
            className={`mcw-brow${on ? " on" : ""}`}
            href={row.href}
            key={row.property}
            style={{ "--i": i } as CSSProperties}
          >
            <span className="mcw-brow__t">
              <b>{row.label}</b>
              <span className="num">
                {w.roomsToday.replace("{n}", String(row.rooms)).replace("{e}", row.empty ? String(row.empty) : w.noneEmpty)}
              </span>
            </span>
            {on ? (
              <span className="bpk-go">
                {w.mapOpen}
                <ChevronRight aria-hidden="true" />
              </span>
            ) : (
              <ChevronRight aria-hidden="true" className="mcw-brow__go" />
            )}
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className={`mcw bpk${view === "map" ? " is-map" : ""}${intro ? " is-intro" : ""}${view === "map" && selected ? " has-sel" : ""}`}>
      <div className="mcw-h is-row">
        <div className="mcw-h__main">
          <span className="mcw-h__k">{w.title}</span>
          <h1 className="mcw-h__t">{w.pickBuilding}</h1>
        </div>
        <div aria-label={w.viewAria} className="bpk-seg" role="radiogroup">
          {(
            [
              ["map", w.viewMap, MapIcon],
              ["list", w.viewList, List],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              aria-checked={view === key}
              className={view === key ? "on" : undefined}
              key={key}
              onClick={() => writeView(key)}
              role="radio"
              type="button"
            >
              <Icon aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "map" ? (
        <div className="bpk-body">
          <div className="bpk-map">
            <BuildingMap
              buildings={buildings}
              copy={{
                mapAria: w.mapAria,
                emptyN: w.mapEmptyN,
                full: w.mapFull,
                roomsN: w.mapRoomsN,
                open: w.mapOpen,
                more: w.mapMore,
                reset: w.mapReset,
                stationShinjuku: w.stationShinjuku,
                stationYotsuya: w.stationYotsuya,
              }}
              onOpen={(id) => {
                const row = rows.find((r) => r.property === id);
                if (row) router.push(row.href);
              }}
              onSelect={setSelected}
              selectedId={selected}
            />
          </div>
          <div className="bpk-sheet">
            <p className="bpk-sum">
              <i aria-hidden="true" />
              {w.mapSummary.replace("{n}", String(rows.length)).replace("{e}", String(totalEmpty))}
            </p>
            {list}
          </div>
        </div>
      ) : (
        list
      )}
    </div>
  );
}
