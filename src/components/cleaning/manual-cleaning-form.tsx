"use client";

import { useState, useTransition } from "react";
import { BedDouble, ChevronRight, SprayCan } from "lucide-react";
import { startCleaningSession } from "@/app/mobile/cleaning/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";

/*
 * 청소 「기타」 — 목록에 없는 객실을 골라 시작(HIG 2차, 시안 A2CleanMan3-*, 2026-10-20).
 * 화면에는 「다른 객실 고르기 ›」 한 줄만 두고, 고르기는 공용 아래 시트 안에서 한다 — 객실이 많은 건물(STAY ARI 26)이어도
 * 청소 화면 길이가 늘지 않는다. 시트: 건물 글자 탭 → 객실 번호 버튼(층 묶음 없음) → 작업 나눔 → 「{객실} 청소 시작」.
 * 이미 청소 목록에 잡힌 방 · 오늘 이미 시작한 방(`blocked`)은 흐리게 · 못 누름. 마지막에 고른 건물은 이 기기에 기억한다.
 */

export type ManualRoomEntry = {
  canonicalRoomLabel: string;
  /** 사용자에게 보여주는 합쳐진 라벨 (Arakicho 201_2 → 201). sessionRoomLabel 은 정식 값 그대로 둔다. */
  displayRoomLabel: string;
  sessionRoomLabel: string;
  /** 이미 청소 목록에 잡혀 있거나 오늘 시작한 방 — 여기서는 못 고른다. */
  blocked?: boolean;
};

export type ManualBuildingOption = {
  buildingKey: string;
  rooms: ManualRoomEntry[];
};

type ManualCleaningFormProps = {
  buildings: ManualBuildingOption[];
  buildingLabels: Record<string, string>;
  labels: {
    open: string;
    openSub: string;
    sheetTitle: string;
    blockedHint: string;
    pickRoom: string;
    /** `{room}` 자리에 객실 번호. */
    startRoom: string;
    task: string;
  };
  taskOptions: { key: string; label: string }[];
};

const LAST_BUILDING_KEY = "foldy.cleaning.manualBuilding";

function readLastBuilding(): string | null {
  try {
    return window.localStorage.getItem(LAST_BUILDING_KEY);
  } catch {
    return null;
  }
}

function writeLastBuilding(value: string) {
  try {
    window.localStorage.setItem(LAST_BUILDING_KEY, value);
  } catch {
    // 저장이 막힌 브라우저 — 다음엔 첫 건물로 연다.
  }
}

export function ManualCleaningForm({ buildings, buildingLabels, labels, taskOptions }: ManualCleaningFormProps) {
  // 시트는 누른 뒤에만 그린다 — 서버 렌더에는 늘 닫힌 상태라 따로 하이드레이션을 기다리지 않는다.
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [buildingKey, setBuildingKey] = useState(buildings[0]?.buildingKey ?? "");
  const [roomLabel, setRoomLabel] = useState("");
  const [taskKey, setTaskKey] = useState(taskOptions[0]?.key ?? "");

  const building = buildings.find((b) => b.buildingKey === buildingKey) ?? buildings[0];
  const room = building?.rooms.find((r) => r.sessionRoomLabel === roomLabel && !r.blocked);
  const hasBlocked = buildings.some((b) => b.rooms.some((r) => r.blocked));

  function openSheet() {
    const last = readLastBuilding();
    if (last && buildings.some((b) => b.buildingKey === last)) setBuildingKey(last);
    setRoomLabel("");
    setOpen(true);
  }

  function pickBuilding(key: string) {
    setBuildingKey(key);
    setRoomLabel("");
    writeLastBuilding(key);
  }

  function start() {
    if (!room || !taskKey || isPending) return;
    const fd = new FormData();
    fd.set("roomLabel", room.sessionRoomLabel);
    fd.set("taskKey", taskKey);
    startTransition(async () => {
      await startCleaningSession(fd);
    });
  }

  return (
    <>
      <button className="cln-mo" onClick={openSheet} type="button">
        <span aria-hidden="true" className="cln-mo__ic">
          <BedDouble />
        </span>
        <span className="cln-mo__b">
          <b>{labels.open}</b>
          <span>{labels.openSub}</span>
        </span>
        <ChevronRight aria-hidden="true" className="cln-mo__chev" />
      </button>

      {open ? (
        <BottomSheet
          ariaLabel={labels.sheetTitle}
          className="max-h-[88dvh] flex flex-col"
          header={
            <div className="cln-ms__h">
              <h3>{labels.sheetTitle}</h3>
              {hasBlocked ? <p>{labels.blockedHint}</p> : null}
            </div>
          }
          onClose={() => setOpen(false)}
        >
          {() => (
            <div className="cln-ms">
              {buildings.length > 1 ? (
                <div className="cln-ms__tabs" role="radiogroup" aria-label={labels.sheetTitle}>
                  {buildings.map((b) => (
                    <button
                      aria-checked={b.buildingKey === building?.buildingKey}
                      className={b.buildingKey === building?.buildingKey ? "on" : undefined}
                      key={b.buildingKey}
                      onClick={() => pickBuilding(b.buildingKey)}
                      role="radio"
                      type="button"
                    >
                      {buildingLabels[b.buildingKey] ?? b.buildingKey}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="cln-ms__rooms" key={building?.buildingKey}>
                {(building?.rooms ?? []).map((r) => (
                  <button
                    aria-pressed={r.sessionRoomLabel === room?.sessionRoomLabel}
                    className={r.blocked ? "is-blocked" : r.sessionRoomLabel === room?.sessionRoomLabel ? "on" : undefined}
                    disabled={r.blocked}
                    key={r.sessionRoomLabel}
                    onClick={() => setRoomLabel(r.sessionRoomLabel)}
                    type="button"
                  >
                    {r.displayRoomLabel}
                  </button>
                ))}
              </div>

              <span className="cln-ms__lab">{labels.task}</span>
              <div className="cln-ms__seg" role="radiogroup" aria-label={labels.task}>
                {taskOptions.map((t) => (
                  <button
                    aria-checked={t.key === taskKey}
                    className={t.key === taskKey ? "on" : undefined}
                    key={t.key}
                    onClick={() => setTaskKey(t.key)}
                    role="radio"
                    type="button"
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <button className="cln-ms__go" disabled={!room || isPending} onClick={start} type="button">
                <SprayCan aria-hidden="true" />
                {room ? labels.startRoom.replace("{room}", room.displayRoomLabel) : labels.pickRoom}
              </button>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
