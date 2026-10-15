"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { BOARD_REACTION_EMOJIS, type BoardReaction } from "./board-types";

/**
 * 반응 칩 줄 — 화이트 리디자인(2026-10-15). 수가 있는 반응만 칩으로(내 반응은 옅은 보라), 끝의 「+」 를 누르면 아직 없는
 * 반응이 그 자리에서 펼쳐진다. 누르면 칩이 살짝 눌리고 숫자가 아래에서 올라온다(레이아웃 애니메이션 없음).
 * `trailing` 은 같은 줄 오른쪽 회색 글(피드: 「#태그 · 댓글 n」, 상세: 「누구 외 n명이 반응」).
 */
export function BoardReactionBar({
  reactions,
  onToggle,
  addLabel,
  trailing,
  className = "bdw-foot",
}: {
  reactions: BoardReaction[];
  onToggle?: (emoji: string) => void;
  addLabel: string;
  trailing?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string | null>(null);
  const byEmoji = new Map(reactions.map((r) => [r.emoji, r]));
  const shown = BOARD_REACTION_EMOJIS.filter((e) => (byEmoji.get(e)?.count ?? 0) > 0);
  const rest = open ? BOARD_REACTION_EMOJIS.filter((e) => !shown.includes(e)) : [];

  function tap(emoji: string) {
    if (!onToggle) return;
    haptic("light");
    setTicked(emoji);
    setOpen(false);
    onToggle(emoji);
  }

  return (
    <div className={className}>
      {shown.map((emoji) => {
        const r = byEmoji.get(emoji)!;
        return (
          <button
            aria-pressed={r.isMine}
            className={`bdw-rx${r.isMine ? " is-mine" : ""}`}
            disabled={!onToggle}
            key={emoji}
            onClick={() => tap(emoji)}
            type="button"
          >
            <span aria-hidden="true">{emoji}</span>
            <b className={ticked === emoji ? "is-tick" : undefined} key={`${emoji}-${r.count}`}>
              {r.count}
            </b>
          </button>
        );
      })}
      {rest.map((emoji) => (
        <button aria-pressed={false} className="bdw-rx is-new" key={emoji} onClick={() => tap(emoji)} type="button">
          {emoji}
        </button>
      ))}
      {onToggle ? (
        <button
          aria-expanded={open}
          aria-label={addLabel}
          className="bdw-rx is-add"
          onClick={() => {
            haptic("light");
            setOpen((v) => !v);
          }}
          type="button"
        >
          <Plus aria-hidden="true" strokeWidth={2} />
        </button>
      ) : null}
      {trailing}
    </div>
  );
}

/** 낙관적 반응 — 누른 반응의 내 표시 · 수를 뒤집는다(없던 반응이면 1로 더한다). */
export function toggleReactionIn(list: BoardReaction[], emoji: string): BoardReaction[] {
  if (!list.some((r) => r.emoji === emoji)) return [...list, { emoji, count: 1, isMine: true }];
  return list.map((r) =>
    r.emoji === emoji ? { ...r, isMine: !r.isMine, count: Math.max(0, r.isMine ? r.count - 1 : r.count + 1) } : r,
  );
}
