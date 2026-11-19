/**
 * 답장 칸 쓰던 글(초안) 보관 — 브라우저 탭 세션 안에서만(sessionStorage), 서버에는 아무것도 안 보낸다.
 *
 * - 대화마다 하나(`조직 id : 대화 id`). 글만 — 사진 · 번역 미리 보기는 보관하지 않는다.
 * - 저장소가 없거나 가득 차거나 던져도 화면은 멀쩡해야 한다 → 모든 접근 try/catch, 실패하면 메모리 칸으로 대신.
 * - 무한히 커지지 않게: 가장 최근 대화 `MAX_DRAFTS` 개만, 글 하나는 `MAX_DRAFT_CHARS` 까지.
 */

export const DRAFT_STORAGE_KEY = "foldy:gm-drafts:v1";
export const MAX_DRAFTS = 30;
/** 답장 최대 길이(`MAX_REPLY_CHARS` 4000)와 같게 — 서버가 어차피 그보다 긴 글은 안 받는다. */
export const MAX_DRAFT_CHARS = 4000;

export type DraftStorage = Pick<Storage, "getItem" | "setItem">;

type Entry = { t: string; at: number };
type Bag = Record<string, Entry>;

export function draftScope(organizationId: string, conversationId: string): string {
  return `${organizationId}:${conversationId}`;
}

function parse(raw: string | null): Bag {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: Bag = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const v = value as Partial<Entry> | null;
      if (v && typeof v.t === "string" && typeof v.at === "number") out[key] = { t: v.t, at: v.at };
    }
    return out;
  } catch {
    return {};
  }
}

function trim(bag: Bag): Bag {
  const keys = Object.keys(bag);
  if (keys.length <= MAX_DRAFTS) return bag;
  keys.sort((a, b) => bag[b].at - bag[a].at);
  const out: Bag = {};
  for (const key of keys.slice(0, MAX_DRAFTS)) out[key] = bag[key];
  return out;
}

/** `storage` 가 null 이면 메모리 칸만 쓴다(시험 · 저장소 없는 환경). */
export function createDraftStore(
  getStorage: () => DraftStorage | null,
  now: () => number = Date.now,
) {
  let memory: Bag = {};
  /** 저장소 쓰기가 실패한 뒤에는 메모리 칸이 기준이다(저장소에는 낡은 묶음이 남아 있다). 다음 쓰기가 성공하면 다시 저장소가 기준. */
  let memoryIsSource = false;

  const read = (): Bag => {
    if (memoryIsSource) return memory;
    try {
      const storage = getStorage();
      if (storage) return parse(storage.getItem(DRAFT_STORAGE_KEY));
    } catch {
      /* 메모리 칸으로 */
    }
    return memory;
  };

  const write = (bag: Bag) => {
    memory = bag;
    try {
      const storage = getStorage();
      if (storage) storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(bag));
      memoryIsSource = !storage;
    } catch {
      /* 가득 참 · 막힘 — 메모리 칸이 기준이 된다 */
      memoryIsSource = true;
    }
  };

  return {
    get(scope: string): string | null {
      const entry = read()[scope];
      return entry && entry.t.trim() ? entry.t : null;
    },
    /** 빈 글(공백뿐)이면 지운다. 너무 길면 앞 `MAX_DRAFT_CHARS` 자만. */
    set(scope: string, text: string) {
      if (!text.trim()) {
        this.clear(scope);
        return;
      }
      const t = Array.from(text).slice(0, MAX_DRAFT_CHARS).join("");
      write(trim({ ...read(), [scope]: { t, at: now() } }));
    },
    /** 저장된 글이 `text` 와 같을 때만 지운다(앞뒤 공백 무시) — 내부 메모로 보낸 글이 답장 보관으로 되살아나지 않게. */
    clearIfSame(scope: string, text: string): boolean {
      const entry = read()[scope];
      if (!entry || entry.t.trim() !== text.trim()) return false;
      this.clear(scope);
      return true;
    },
    clear(scope: string) {
      const bag = read();
      if (!(scope in bag)) return;
      const { [scope]: _removed, ...rest } = bag;
      void _removed;
      write(rest);
    },
  };
}

type SentListener = (sentText: string, source: object) => void;
const sentListeners = new Map<string, Set<SentListener>>();

/** 같은 탭 안에서 「이 대화 보내기가 받아들여졌다」를 알린다(저장소 이벤트 없이). */
export function notifyDraftSent(scope: string, sentText: string, source: object) {
  for (const listener of Array.from(sentListeners.get(scope) ?? [])) listener(sentText, source);
}

export function subscribeDraftSent(scope: string, listener: SentListener): () => void {
  const set = sentListeners.get(scope) ?? new Set<SentListener>();
  set.add(listener);
  sentListeners.set(scope, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) sentListeners.delete(scope);
  };
}

/**
 * 다른 화면이 같은 글을 보내기 성공했을 때, 이 화면 칸을 비워야 하나 —
 * 되살린 뒤 한 글자도 안 고쳤고(그대로) 보낸 글과 같을 때만. 고쳤으면 직원의 새 글이라 둔다.
 */
export function shouldEmptyRestoredField(input: {
  restoredText: string | null;
  currentText: string;
  sentText: string;
}): boolean {
  const { restoredText, currentText, sentText } = input;
  return restoredText !== null && currentText === restoredText && currentText.trim() === sentText.trim();
}

export type DraftAction = "save" | "clear" | "skip";

/**
 * 글이 바뀔 때 보관을 어떻게 할지 — 훅이 부르는 판정 하나.
 * - 내부 메모 칸(`enabled` false)은 답장 보관을 읽지도 지우지도 않는다.
 * - 되살리는 중(칸이 아직 옛 글)은 건너뛴다.
 * - 빈 글 = 지움(보내기 성공 · 직접 지움).
 * - 직원이 손대지 않은 자동 글(「해결됐어요」 초안 · AI 초안)은 보관하지 않는다 — 고치는 순간부터 보통 초안.
 *   (직원이 직접 넣은 정해 둔 문구 · 건물 정보는 자동 글이 아니라 보관한다.)
 */
export function decideDraftAction(input: {
  text: string;
  enabled: boolean;
  restoring: boolean;
  untouchedAuto: boolean;
}): DraftAction {
  if (!input.enabled || input.restoring) return "skip";
  if (!input.text.trim() || input.untouchedAuto) return "clear";
  return "save";
}

function browserStorage(): DraftStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** 화면 전체가 같이 쓰는 하나(PC · 폰 · 칸 모드 모두 같은 탭 안에서는 같은 저장소). */
export const composerDrafts = createDraftStore(browserStorage);
