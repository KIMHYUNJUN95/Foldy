import type { InboxStatusFilter } from "@/lib/guest-messages/inbox-model";
import { leavesStatusList, ROW_NEXT_VALUES, type RowNext } from "@/lib/guest-messages/row-leave";
import { SPLIT_PANE_NAME } from "@/lib/split-pane";

/**
 * 손님 메시지 — 태블릿 칸(iframe) 안 대화 화면 → 바깥 목록 창 신호(2026-11-20, 47 §5-9). **순수하다.**
 * - `gm-row`: 그 대화가 곧 바뀔 상태(`next`) — 서버를 기다리기 전에 알리고, 실패하면 `next: null` 로 다시 편다(16 「줄 접힘」).
 *   접을지는 **바깥 창이** 자기 탭 · 검색 상태로 정한다(`leavesStatusList`) — 칸은 바깥 목록의 탭을 모른다.
 * - `gm-write`: 그 대화에 쓰기가 성공했다 — 바깥 창에도 쓰기 표시를 남기고 그 대화를 바로 다시 읽는다(메뉴 숫자도 같이 고쳐짐).
 * 같은 출처 + 보낸 창이 이 창의 칸(이름 `stayops-pane`, 부모가 이 창)일 때만 받는다.
 */
export const ROW_MESSAGE = "gm-row";
export const GUEST_WRITE_MESSAGE = "gm-write";

export type PaneMessage =
  | { type: typeof ROW_MESSAGE; id: string; next: RowNext | null }
  | { type: typeof GUEST_WRITE_MESSAGE; id: string };


type WindowLike = { location: { origin: string } };
type PostingWindow = WindowLike & { parent: unknown; postMessage?: unknown };

/** 칸 안 대화 → 바깥 목록에 「이 대화가 곧 `next` 가 된다」(`null` = 실패, 다시 편다). 칸이 아니면(폰 · PC) 보내지 않는다. */
export function postRowChange(win: PostingWindow, id: string, next: RowNext | null) {
  if (win.parent === win) return;
  const parent = win.parent as { postMessage: (data: PaneMessage, origin: string) => void };
  parent.postMessage({ type: ROW_MESSAGE, id, next }, win.location.origin);
}
type PaneEvent = { origin: string; source: unknown; data: unknown };

function isPaneOf(source: unknown, self: WindowLike): boolean {
  if (!source || source === self) return false;
  try {
    const win = source as { parent?: unknown; name?: unknown };
    return win.parent === self && win.name === SPLIT_PANE_NAME;
  } catch {
    return false;
  }
}

export function readPaneMessage(event: PaneEvent, self: WindowLike): PaneMessage | null {
  if (event.origin !== self.location.origin || !isPaneOf(event.source, self)) return null;
  const data = event.data as { type?: unknown; id?: unknown; next?: unknown } | null;
  if (!data || typeof data !== "object" || typeof data.id !== "string") return null;
  if (data.type === GUEST_WRITE_MESSAGE) return { type: GUEST_WRITE_MESSAGE, id: data.id };
  if (data.type === ROW_MESSAGE && (data.next === null || (ROW_NEXT_VALUES as readonly unknown[]).includes(data.next)))
    return { type: ROW_MESSAGE, id: data.id, next: data.next as RowNext | null };
  return null;
}

export function createPaneMessageHandler(deps: {
  self: WindowLike;
  freshness: { markWrite(conversationId: string): void };
  applyIds: (ids: string[]) => unknown;
  /** 바깥 목록의 지금 탭 · 검색 상태 — 바뀌면 새 처리기를 만든다. */
  rowRule: { searching: boolean; filter: InboxStatusFilter };
  setRowLeaving: (id: string, leaving: boolean) => void;
}) {
  return (event: PaneEvent) => {
    const message = readPaneMessage(event, deps.self);
    if (!message) return;
    if (message.type === GUEST_WRITE_MESSAGE) {
      deps.freshness.markWrite(message.id);
      void deps.applyIds([message.id]);
      return;
    }
    deps.setRowLeaving(message.id, message.next !== null && leavesStatusList({ ...deps.rowRule, next: message.next }));
  };
}
