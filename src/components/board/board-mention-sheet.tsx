"use client";

import { useEffect, useState, useTransition } from "react";
import { Search, Check, Users } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { BoardAvatar } from "@/components/board/board-avatar";
import { cn } from "@/lib/utils";

// MentionableMember는 actions.ts(server action)에서 export된 타입을 재사용.
// 타입 전용 import이므로 client boundary를 넘지 않음.
import type { MentionableMember } from "@/app/mobile/board/[id]/actions";
export type { MentionableMember };

type MentionSheetCopy = {
  // TODO i18n: mentionSearchPlaceholder
  mentionSearchPlaceholder: string;
  // TODO i18n: mentionAll
  mentionAll: string;
  // TODO i18n: mentionAllSubtitle
  mentionAllSubtitle: string;
  // TODO i18n: mentionDone
  mentionDone: (count: number) => string;
  // TODO i18n: mentionEmpty
  mentionEmpty: string;
};

export function BoardMentionSheet({
  onClose,
  onConfirm,
  initialSelection,
  copy,
  // searchMentions는 server action — 부모에서 prop으로 주입해 이 컴포넌트가 직접 actions.ts를 import하지 않게 함.
  // (dynamic route segment 때문에 actions.ts 경로가 page-specific이므로 역전 주입이 더 안전함)
  searchFn,
}: {
  onClose: () => void;
  onConfirm: (selection: { users: MentionableMember[]; mentionAll: boolean }) => void;
  initialSelection?: { userIds: string[]; mentionAll: boolean };
  copy: MentionSheetCopy;
  searchFn: (query: string) => Promise<MentionableMember[] | { error: string }>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MentionableMember[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(initialSelection?.userIds ?? []),
  );
  const [allSelected, setAllSelected] = useState(initialSelection?.mentionAll ?? false);
  const [, startTransition] = useTransition();

  // 초기 전체 멤버 목록 로드 (빈 쿼리)
  useEffect(() => {
    startTransition(async () => {
      const res = await searchFn("");
      if (!("error" in res)) setResults(res);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 200ms 디바운스 검색
  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await searchFn(query);
        if (!("error" in res)) setResults(res);
      });
    }, 200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function toggleUser(user: MentionableMember) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.add(user.id);
      return next;
    });
  }

  function confirm() {
    // results에서 선택된 유저만 필터 — query가 빈 상태에서도 전체 목록에 포함돼 있어야 함.
    // selectedUserIds에 있지만 현재 results에 없는 경우(검색 중 선택 후 쿼리 변경)를 대비해
    // name은 알 수 없으므로 id만 전달. 실제 이름은 서버가 DB에서 재확인.
    const users = results.filter((r) => selectedUserIds.has(r.id));
    onConfirm({ users, mentionAll: allSelected });
  }

  const totalSelected = (allSelected ? 1 : 0) + selectedUserIds.size;

  // @ALL 행을 보여줄 조건: 쿼리가 없거나 "전체/all/every" prefix 일 때
  const showAllOption = !query || /^(전체|全員|all|every)/i.test(query.trim()); // i18n-ignore: multilingual search aliases for @ALL.

  return (
    <BottomSheet
      onClose={onClose}
      className="max-h-[82dvh] flex flex-col"
      ariaLabel={copy.mentionSearchPlaceholder}
    >
      {/* 검색바 */}
      <div className="mb-1.5 mt-1 flex h-[42px] items-center gap-[9px] rounded-[12px] border border-border bg-background px-[14px]">
        <Search className="size-[17px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.mentionSearchPlaceholder}
          autoFocus
          className="flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* 멤버 리스트 — overscroll-contain: 리스트 끝에서 배경/시트로 스크롤 체이닝 방지 */}
      <div className="flex-1 overflow-y-auto overscroll-contain pt-1">
        {/* @ALL 옵션 (항상 최상단) */}
        {showAllOption && (
          <button
            type="button"
            onClick={() => setAllSelected((v) => !v)}
            className={cn(
              "flex w-full items-center gap-[11px] px-[14px] py-[9px] text-left",
              allSelected && "bg-primary/[0.07]",
            )}
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
              <Users className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-extrabold tracking-[-0.01em]">
                @{copy.mentionAll}
              </div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-muted-foreground">
                {copy.mentionAllSubtitle}
              </div>
            </div>
            {allSelected && <Check className="size-5 shrink-0 text-primary" aria-hidden="true" />}
          </button>
        )}

        {/* 멤버 행 */}
        {results.length === 0 && query ? (
          <div className="px-4 py-8 text-center text-[12.5px] font-semibold text-muted-foreground">
            {copy.mentionEmpty}
          </div>
        ) : (
          results.map((m, idx) => {
            const selected = selectedUserIds.has(m.id);
            const lowerQuery = query.toLowerCase();
            const lowerName = m.name.toLowerCase();
            const matchStart = lowerQuery ? lowerName.indexOf(lowerQuery) : -1;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleUser(m)}
                className={cn(
                  "flex w-full items-center gap-[11px] px-[14px] py-[9px] text-left",
                  idx > 0 && "border-t border-border/60",
                  selected && "bg-primary/[0.07]",
                )}
              >
                <BoardAvatar initial={m.name.charAt(0)} color={m.avatarColor} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold tracking-[-0.01em]">
                    {matchStart >= 0 ? (
                      <>
                        {m.name.slice(0, matchStart)}
                        <span className="text-primary">
                          {m.name.slice(matchStart, matchStart + query.length)}
                        </span>
                        {m.name.slice(matchStart + query.length)}
                      </>
                    ) : (
                      m.name
                    )}
                  </div>
                  {m.role && (
                    <div className="mt-0.5 text-[11.5px] font-semibold text-muted-foreground">
                      {m.role}
                    </div>
                  )}
                </div>
                {selected && <Check className="size-5 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })
        )}
      </div>

      {/* 확정 버튼 */}
      <div className="mt-2 shrink-0">
        <button
          type="button"
          onClick={confirm}
          disabled={totalSelected === 0}
          className="h-[48px] w-full rounded-[14px] bg-primary text-[14px] font-extrabold text-white disabled:bg-[#f4f4f7] disabled:text-[#9a97a6]"
        >
          {copy.mentionDone(totalSelected)}
        </button>
      </div>
    </BottomSheet>
  );
}
