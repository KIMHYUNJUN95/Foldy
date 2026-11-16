"use client";

/**
 * 받는 사람(단일) / 참조(다중) 고르기 — 공용 `BottomSheet` 안에 검색 · 구성원 줄 · 확인 버튼.
 * 마운트 기반: 부모가 열 때만 렌더하고, 확인 · 끌어 닫기 · 스크림 · Esc 는 시트가 닫는 애니메이션 뒤 `onClose`.
 * 참고: docs/product/22-staff-suggestions-workflow.md 「화이트 리디자인 — 모바일」.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { ShareableUser } from "@/lib/tasks";
import "./suggestions-white.css";
import { SgIcon } from "./sg-icons";

// 공용 시트의 여는 시간(bottom-sheet.tsx SHEET_OPEN_MS)과 같게 — 다 올라온 뒤에 검색 칸에 포커스.
const SHEET_OPEN_MS = 480;

export function SuggestionsUserPicker({
  onClose,
  mode,
  users,
  roleLabel,
  groupLabel,
  title,
  sub,
  searchPlaceholder,
  emptyLabel,
  confirmSingle,
  confirmMulti,
  confirmEmpty,
  initialSelectedIds,
  excludeIds = [],
  onConfirm,
}: {
  onClose: () => void;
  mode: "single" | "multi";
  users: ShareableUser[];
  roleLabel: (role: string) => string;
  groupLabel: string;
  title: string;
  sub: string;
  searchPlaceholder: string;
  emptyLabel: string;
  confirmSingle: string;
  confirmMulti: string;
  confirmEmpty: string;
  initialSelectedIds: string[];
  excludeIds?: string[];
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelectedIds);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // 열자마자 포커스하면 iOS 키보드가 시트가 올라오는 도중에 떠서 화면 크기 · 시트 높이가 같이 움직여 끊긴다.
  // 터치 기기는 자동 포커스 없이(필요하면 검색 칸을 누른다), 키보드가 있는 기기만 다 열린 뒤에 포커스.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const timer = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), SHEET_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const list = useMemo(() => {
    const q = query.trim();
    return users
      .filter((u) => !excluded.has(u.id))
      .filter((u) => !q || u.name.includes(q) || roleLabel(u.role).includes(q));
  }, [users, excluded, query, roleLabel]);

  const toggle = (id: string) => {
    if (mode === "single") {
      setSelected([id]);
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const confirmLabel =
    mode === "single"
      ? selected.length > 0
        ? confirmSingle.replace("{name}", users.find((u) => u.id === selected[0])?.name ?? "")
        : confirmEmpty
      : confirmMulti.replace("{count}", String(selected.length));

  return (
    <BottomSheet
      ariaLabel={title}
      className="flex h-[88dvh] flex-col tablet:h-[min(86dvh,720px)]"
      header={
        <div className="sgw-pk__h">
          <b>{title}</b>
          <span>{sub}</span>
        </div>
      }
      onClose={onClose}
    >
      {({ close }) => (
        <div className="sgw-pk">
          <div className="sgw-pk__search">
            <span aria-hidden="true" className="sgw-pk__sic">
              {SgIcon.search}
            </span>
            <input
              aria-label={searchPlaceholder}
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              ref={searchRef}
              type="search"
              value={query}
            />
          </div>
          <div className="sgw-pk__list">
            {list.length === 0 ? (
              <p className="sgw-pk__empty">{emptyLabel}</p>
            ) : (
              <>
                <p className="sgw-pk__g">{groupLabel}</p>
                <div aria-label={groupLabel} role="group">
                  {list.map((m) => {
                    const on = selected.includes(m.id);
                    return (
                      <button
                        aria-pressed={on}
                        className="sgw-pk__row"
                        key={m.id}
                        onClick={() => toggle(m.id)}
                        type="button"
                      >
                        <span aria-hidden="true" className="sgw-pk__av">
                          {m.name.slice(0, 1)}
                        </span>
                        <span className="sgw-pk__b">
                          <span className="sgw-pk__n">{m.name}</span>
                          <span className="sgw-pk__r">{roleLabel(m.role)}</span>
                        </span>
                        <span aria-hidden="true" className="sgw-pk__radio">
                          {on ? SgIcon.check : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <button
            className="sgw-pk__go"
            data-press="off"
            onClick={() => {
              onConfirm(selected);
              close();
            }}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
