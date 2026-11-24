// 공지 규칙 — 서버 · 클라이언트가 같이 쓰는 순수 함수(2026-11-12 공지 점검). DB · 브라우저 저장소를 직접 만지지 않는다.
// docs/product/11-announcement-workflow.md 참고.

/** 수정 저장의 게시 시각 — 게시 중이 아니던 공지(초안 · 보관)를 게시하면 지금으로. 게시 중이면 원래 시각을 지킨다. */
export function nextPublishedAtOnEdit(
  existing: { status: "draft" | "published" | "archived"; published_at: string | null },
  nextStatus: "draft" | "published",
  now: string,
): string | null {
  if (nextStatus !== "published") return existing.published_at;
  return existing.status === "published" ? (existing.published_at ?? now) : now;
}

// ─── 팝업 ─────────────────────────────────────────────────────────────────────

export type PopupCandidate = {
  id: string;
  show_popup_on_app_open: boolean;
  popup_until: string | null;
};

/**
 * 서버 쪽 팝업 후보 — 팝업 켠 공지 중 아직 안 끝났고, 이미 읽지 않았고, 「7일 보지 않기」(DB)로 숨기지 않은 것.
 * 넘기는 목록은 이미 게시 중 · 나를 대상으로 하는 공지여야 한다(읽기 정책이 거른다).
 */
export function selectPopupCandidates<T extends PopupCandidate>(
  rows: T[],
  opts: { dismissedIds: Set<string>; readIds: Set<string>; now: Date },
): T[] {
  const nowMs = opts.now.getTime();
  return rows.filter(
    (row) =>
      row.show_popup_on_app_open &&
      (!row.popup_until || new Date(row.popup_until).getTime() > nowMs) &&
      !opts.dismissedIds.has(row.id) &&
      !opts.readIds.has(row.id),
  );
}

/** 「7일 동안 보지 않기」 브라우저 기록 — 사람마다 따로(같은 기기에서 계정을 바꿔도 섞이지 않게). */
export function popupHideStorageKey(userId: string): string {
  return `foldy:announcement-popup-hidden-until:${userId}`;
}

/** 이번 앱 실행(탭 세션)에서 이미 닫은 팝업 — 홈 · 목록이 같이 쓴다. */
export function popupSessionStorageKey(userId: string): string {
  return `foldy:announcement-popup-seen:${userId}`;
}

export type HiddenPopupMap = Record<string, string>;

/** 저장된 값에서 아직 안 끝난 숨김만 남긴다. 망가진 값은 빈 기록. */
export function parseHiddenPopupMap(raw: string | null, nowMs: number): HiddenPopupMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && new Date(entry[1]).getTime() > nowMs,
      ),
    );
  } catch {
    return {};
  }
}

/** 세션에 닫은 팝업 id 목록. 망가진 값은 빈 목록. */
export function parseSessionSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * 브라우저에서 띄울 차례 — 7일 숨김 · 이번 세션에 닫은 것을 뺀다.
 * `keepIds` 는 지금 화면에서 방금 닫은 것 — 「1 / 2」 번호가 이어지도록 차례에 남긴다.
 */
export function filterPopupQueue<T extends { id: string }>(
  items: T[],
  hidden: HiddenPopupMap,
  sessionSeen: Set<string>,
  keepIds: Set<string> = new Set(),
): T[] {
  return items.filter((item) => keepIds.has(item.id) || (!hidden[item.id] && !sessionSeen.has(item.id)));
}
