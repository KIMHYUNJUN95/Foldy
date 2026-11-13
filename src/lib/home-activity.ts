import type { HomeActivityEventType } from "@/lib/home";

/** 홈 오늘 기록 첫 줄(「무슨 일」) 문구 — 함수 없는 순수 글자라 클라이언트로 넘겨도 안전하다. */
export type HomeActivityWhatCopy = {
  cleaningNone: string;
  cleaningByType: Record<string, string>;
  cleaningOther: string; // {task} 자리표시자
  lostItem: string;
  maintenance: string;
  order: string;
  linen: string;
};

const BLANK = (value: string | null | undefined) => !value || !value.trim() || value.trim() === "-";

/** 방이 비었거나 「-」 이면 건물만, 연결 부호 없이(「다카다노바바 -」 꼬리 방지). */
export function joinBuildingRoom(building: string | null | undefined, room: string | null | undefined): string {
  return [building, room]
    .filter((part) => !BLANK(part))
    .map((part) => part!.trim())
    .join(" ");
}

/** 지역화한 장소에서 「-」 조각을 걷어낸다 — 비면 빈 글자(장소 줄을 그리지 않는다). */
export function cleanActivityPlace(place: string | null | undefined): string {
  return (place ?? "")
    .split(/\s+/)
    .filter((part) => part && part !== "-")
    .join(" ");
}

export function getActivityWhat(
  type: HomeActivityEventType,
  copy: HomeActivityWhatCopy,
  taskKey?: string | null,
  taskLabel?: string | null,
): string {
  switch (type) {
    case "cleaning_completed": {
      if (taskKey && copy.cleaningByType[taskKey]) return copy.cleaningByType[taskKey];
      if (BLANK(taskLabel ?? taskKey)) return copy.cleaningNone;
      return copy.cleaningOther.replace("{task}", (taskLabel ?? taskKey)!.trim());
    }
    case "lost_item_reported":
      return copy.lostItem;
    case "maintenance_reported":
      return copy.maintenance;
    case "order_requested":
      return copy.order;
    case "linen_returned":
      return copy.linen;
  }
}
