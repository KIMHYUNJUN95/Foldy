"use client";

import { createContext, use, type ReactNode } from "react";
import type { InboxChannelFilter } from "@/lib/guest-messages/inbox-model";
import { useInboxSearch } from "@/components/guest-messages/use-inbox-search";

type InboxSearch = ReturnType<typeof useInboxSearch>;

const InboxSearchContext = createContext<InboxSearch | null>(null);

/**
 * 손님 메시지 검색 자리(47 §5-10) — 페이지가 목록(`MobileInbox` · `MessagesConsole`)을 상태 탭 `key` 로 다시 그리므로,
 * 검색(러너 · 결과)은 그 바깥에서 산다. 상태 탭을 바꿔도 다시 묻지 않고, 탭을 바꾸기 직전 보낸 refresh 의 답도 새 목록에 들어온다.
 * 건물 · 채널이 바뀌면 검색 결과도 바뀌어야 하므로 페이지가 이 자리를 `building|channel` key 로 새로 만든다(주소 `q` 로 다시 찾음).
 * `initialQuery` 는 처음 한 번만 본다.
 */
export function InboxSearchProvider({
  building,
  channel,
  initialQuery,
  children,
}: {
  building: string | null;
  channel: InboxChannelFilter;
  initialQuery: string;
  children: ReactNode;
}) {
  const search = useInboxSearch({ building, channel }, initialQuery);
  return <InboxSearchContext value={search}>{children}</InboxSearchContext>;
}

export function useInboxSearchContext(): InboxSearch {
  const search = use(InboxSearchContext);
  if (!search) throw new Error("useInboxSearchContext: must be used inside InboxSearchProvider");
  return search;
}
