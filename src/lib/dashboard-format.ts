import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";
import {
  CANONICAL_TO_BUILDING_KEY,
  localizeBuildingName,
  localizeRoomPlaceLabel,
} from "@/lib/room-label-normalization";

const TZ = "Asia/Tokyo";

/** 청소 세션의 task_label 은 키(`checkout`)로 저장된다 — 사전 문구로 바꾼다. 키가 아닌 옛 자유 글자는 그대로. */
export function resolveCleaningTaskLabel(raw: string | null | undefined, taskOptions: Record<string, string>): string {
  if (!raw) return "";
  return taskOptions[raw] ?? raw;
}

/** 「건물 객실」 세션 라벨을 방 번호 · 건물 이름(보는 사람 언어)으로 나눈다. 방이 하나뿐인 건물은 room 이 빈 글자. */
export function splitSessionRoomLabel(label: string, buildingLabels: Record<string, string>): { building: string; room: string } {
  const trimmed = label.trim();
  const canonical = Object.keys(CANONICAL_TO_BUILDING_KEY)
    .sort((a, b) => b.length - a.length)
    .find((name) => trimmed === name || trimmed.startsWith(`${name} `));
  if (canonical) {
    return { building: localizeBuildingName(canonical, buildingLabels), room: trimmed.slice(canonical.length).trim() };
  }
  const space = trimmed.indexOf(" ");
  if (space === -1) return { building: localizeBuildingName(trimmed, buildingLabels), room: "" };
  return { building: localizeBuildingName(trimmed.slice(0, space), buildingLabels), room: trimmed.slice(space + 1).trim() };
}

const usable = (value: string | null | undefined): value is string => Boolean(value && value.trim() && value.trim() !== "-");

/** 요청 줄의 위치 — 건물 · 방 중 비었거나 「-」 인 쪽은 뺀다(「주문 · 다카다노바바 · -」 꼬리 방지). */
export function joinPlace(building: string | null | undefined, room: string | null | undefined, buildingLabels: Record<string, string>): string {
  return [
    usable(building) ? localizeBuildingName(building, buildingLabels) : null,
    usable(room) ? localizeRoomPlaceLabel(room, buildingLabels) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 도쿄 시각 HH:mm(24시간). */
export function tokyoHm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

/** 요청 줄 날짜 — 도쿄 기준 오늘 「오늘 09:12」 · 어제 · 그 밖은 「11/10」. */
export function formatRequestDate(iso: string, now: Date, copy: { today: string; yesterday: string }): string {
  const day = tokyoDateOf(iso);
  const today = tokyoDateOf(now.toISOString());
  if (!day || !today) return "";
  if (day === today) return copy.today.replace("{time}", tokyoHm(iso));
  if (day === ymdShift(today, -1)) return copy.yesterday;
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
}
