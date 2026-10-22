"use client";

import { useCallback, useState } from "react";
import { CalendarCheck2, Home } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";

export type HomeReservationItem = {
  id: string;
  guestName: string;
  place: string;
  source: string;
};

/** 건물 하나 — 머리줄 이름과 그 건물의 체크인(또는 체크아웃) 줄. 순서는 `groupByBuilding`. */
export type HomeReservationGroup = {
  key: string;
  label: string;
  items: HomeReservationItem[];
};

type Props = {
  checkInLabel: string;
  checkOutLabel: string;
  checkIns: HomeReservationGroup[];
  checkOuts: HomeReservationGroup[];
  emptyCheckIn: string;
  emptyCheckOut: string;
  guestFallback: string;
};

type SheetKind = "in" | "out";

function countItems(groups: HomeReservationGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

export function HomeCheckInOut({
  checkInLabel,
  checkOutLabel,
  checkIns,
  checkOuts,
  emptyCheckIn,
  emptyCheckOut,
  guestFallback,
}: Props) {
  const [kind, setKind] = useState<SheetKind>("in");
  const [open, setOpen] = useState(false);

  const openSheet = useCallback((next: SheetKind) => {
    setKind(next);
    setOpen(true);
  }, []);

  const groups = kind === "out" ? checkOuts : checkIns;
  const inCount = countItems(checkIns);
  const outCount = countItems(checkOuts);
  const count = kind === "out" ? outCount : inCount;
  const title = kind === "out" ? checkOutLabel : checkInLabel;
  const emptyText = kind === "out" ? emptyCheckOut : emptyCheckIn;

  return (
    <>
      <div className="hm__stats">
        <button className="hm__stat" onClick={() => openSheet("in")} type="button">
          <span className="hm__stat-ic">
            <CalendarCheck2 aria-hidden="true" />
          </span>
          <div className="hm__stat-v">{inCount}</div>
          <div className="hm__stat-k">{checkInLabel}</div>
        </button>
        <button className="hm__stat" onClick={() => openSheet("out")} type="button">
          <span className="hm__stat-ic hm__stat-ic--alt">
            <Home aria-hidden="true" />
          </span>
          <div className="hm__stat-v">{outCount}</div>
          <div className="hm__stat-k">{checkOutLabel}</div>
        </button>
      </div>

      {open ? (
        <BottomSheet
          ariaLabel={title}
          header={
            <div className="hm">
              <div className="hm__cio-head">
                <span className="hm__cio-ic">
                  {kind === "out" ? (
                    <Home aria-hidden="true" />
                  ) : (
                    <CalendarCheck2 aria-hidden="true" />
                  )}
                </span>
                <span className="hm__cio-title">{title}</span>
                <span className="hm__cio-count">{count}</span>
              </div>
            </div>
          }
          onClose={() => setOpen(false)}
        >
          <div className="hm">
            {count === 0 ? (
              <div className="hm__cio-empty">{emptyText}</div>
            ) : (
              <div className="hm__cio-list">
                {groups.map((group) => (
                  <section className="hm__cio-grp" key={group.key}>
                    <div className="hm__cio-gh">
                      <span className="hm__cio-gt">{group.label}</span>
                      <span className="hm__cio-gc">{group.items.length}</span>
                    </div>
                    {group.items.map((item) => (
                      <div className="hm__cio-row" key={item.id}>
                        {item.place ? <span className="hm__cio-room">{item.place}</span> : null}
                        <div className="hm__cio-b">
                          <div className="hm__cio-g">{item.guestName || guestFallback}</div>
                        </div>
                        {item.source ? <span className="hm__cio-src">{item.source}</span> : null}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}
