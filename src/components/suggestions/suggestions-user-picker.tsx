"use client";

/**
 * Frame 8 — member picker sheet (수신자 / 참조 선택).
 * Feedback Box.html 핸드오프의 `framePicker()` 시각 이식: 큰 하단 시트에
 * 검색 필드, 구성원 행, 확인 버튼이 있다. 이제 데이터 기반이며 필수
 * 단일 선택 받는 사람과 선택적 다중 선택 참조(mode prop) 둘 다에 쓴다. 시각 처리
 * (시트, 행, 라디오)는 디자인 슬라이스에서 바뀌지 않았다.
 * 참고: docs/product/22-staff-suggestions-workflow.md.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSheetDragDismiss } from "@/components/shell/use-sheet-drag-dismiss";
import type { ShareableUser } from "@/lib/tasks";
import { SgIcon } from "./sg-icons";

export function SuggestionsUserPicker({
  open,
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
  open: boolean;
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
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const drag = useSheetDragDismiss({ shown: open, onDismiss: onClose });

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const list = useMemo(() => {
    const q = query.trim();
    return users
      .filter((u) => !excluded.has(u.id))
      .filter((u) => !q || u.name.includes(q) || roleLabel(u.role).includes(q));
  }, [users, excluded, query, roleLabel]);

  if (!hydrated || !open) return null;

  const toggle = (id: string) => {
    if (mode === "single") {
      setSelected([id]);
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const confirm = () => {
    onConfirm(selected);
    onClose();
  };

  const confirmLabel =
    mode === "single"
      ? selected.length > 0
        ? confirmSingle.replace("{name}", users.find((u) => u.id === selected[0])?.name ?? "")
        : confirmEmpty
      : confirmMulti.replace("{count}", String(selected.length));

  return createPortal(
    <div className="sg">
      <div className="dim show" onClick={onClose} style={drag.scrimStyle} aria-hidden="true" />
      <div
        className="sheet show"
        data-sheet
        style={{
          height: "88%",
          display: "flex",
          flexDirection: "column",
          paddingBottom: 0,
          ...drag.sheetStyle,
        }}
        role="dialog"
        aria-modal="true"
      >
        <div {...drag.handleProps}>
          <div className="sheet__grab">
            <div className="sheet__handle" />
          </div>
          <p className="sheet__title" style={{ padding: "0 0 2px" }}>
            {title}
          </p>
          <p className="sheet__sub">{sub}</p>
        </div>
        <div className="search">
          <span className="ic search__ic">{SgIcon.search}</span>
          <input
            type="search"
            enterKeyHint="search"
            autoFocus
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", margin: "0 -2px" }}>
          {list.length === 0 ? (
            <p className="sheet__sub" style={{ padding: "20px 2px" }}>
              {emptyLabel}
            </p>
          ) : (
            <>
              <p className="glabel">{groupLabel}</p>
              {list.map((m, i) => {
                const on = selected.includes(m.id);
                return (
                  <div key={m.id}>
                    <button
                      type="button"
                      className={`urow${on ? " on" : ""}`}
                      onClick={() => toggle(m.id)}
                    >
                      <span className="urow__av">{m.name.slice(0, 1)}</span>
                      <div className="urow__b">
                        <div className="urow__n">{m.name}</div>
                        <div className="urow__r">{roleLabel(m.role)}</div>
                      </div>
                      <span className="urow__radio">{on ? SgIcon.check : null}</span>
                    </button>
                    {i < list.length - 1 ? <div className="usep" /> : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div style={{ padding: "12px 0 max(18px, env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            className="ctxbar__save"
            style={{ width: "100%", height: "50px", borderRadius: "14px", fontSize: "14.5px" }}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
