"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { OpsNavLink, useOpsNavigate } from "@/components/admin/ops/ops-nav";
import { useBuildingName } from "@/components/shared/building-names";

/**
 * 판매 캘린더의 건물 고르기 — **여러 건물을 함께 볼 수 있다**(2026-09-30).
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「건물 여러 곳 함께 보기」
 *
 * 2026-10-16 화이트 리디자인(시안 Sales-PC · SalesFilter-PC): 탭 줄 → 「건물 N곳 ⌄」 드롭다운의 체크 목록.
 * **동작은 그대로다** —
 * - 이름을 그냥 누르면 **그 건물만**. 「전체」는 선택을 비운다.
 * - 체크 네모 또는 **Ctrl/⌘/Shift + 이름 클릭**은 그 건물을 지금 선택에 넣거나 뺀다(바로 이동, 목록은 열린 채).
 *   하나 남으면 단일 선택, 다 빼면 전체.
 *
 * 주소(단일/토글/전체)는 전부 서버가 만들어 넘긴다 — URL 규칙(`property` 반복, 탭 순서)을 한곳
 * (`ops-calendar-properties.ts`)에서만 쥔다. 여기는 누름을 이동으로 바꾸기만 한다.
 */
export type OpsPropertyTab = {
  name: string;
  /** 그냥 누름 — 이 건물만. */
  href: string;
  /** 체크 · Ctrl/⌘/Shift + 클릭 — 지금 선택에 넣거나 뺀 주소. */
  toggleHref: string;
  /** 지금 선택에 들어 있는가. */
  selected: boolean;
};

export type OpsPropertyTabsCopy = {
  allProperties: string;
  propertyGroupLabel: string;
  propertyTabHint: string;
  propertyAdd: string;
  propertyRemove: string;
  propertySelectedCount: string;
  propertyClear: string;
  /** 「{first} 외 {n}」 — 여러 곳을 골랐을 때 방아쇠 글자. */
  scwScopeRoomsSome: string;
  /** 「{count}곳 함께 보기」 — 목록 닫기. */
  scwPropertyShow: string;
};

export function OpsPropertyTabs({
  allHref,
  copy,
  tabs,
}: {
  /** 「전체」 — 선택을 비운 주소. */
  allHref: string;
  copy: OpsPropertyTabsCopy;
  tabs: OpsPropertyTab[];
}) {
  const { navigate, pending } = useOpsNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 체크 · 수정키 클릭으로 이동 중인 건물 — 그 줄에 로딩 점을 띄운다. */
  const [pendingName, setPendingName] = useState<string | null>(null);
  const bName = useBuildingName();
  const selected = tabs.filter((tab) => tab.selected);
  const selectedCount = selected.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 격자의 「Esc = 켜 둔 것 전부 끄기」보다 먼저 — 목록만 닫는다.
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const toggle = (tab: OpsPropertyTab) => {
    setPendingName(tab.name);
    navigate(tab.toggleHref);
  };

  const onLabelClick = (tab: OpsPropertyTab) => (event: MouseEvent<HTMLAnchorElement>) => {
    // 가운데 버튼은 브라우저에 맡긴다(새 탭). Ctrl/⌘/Shift + 왼쪽 클릭만 「함께 보기」로 바꾼다.
    if (event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      toggle(tab);
      return;
    }
    setOpen(false);
  };

  const label =
    selectedCount === 0
      ? copy.propertySelectedCount.replace("{count}", String(tabs.length))
      : selectedCount === 1
        ? bName(selected[0].name)
        : copy.scwScopeRoomsSome.replace("{first}", bName(selected[0].name)).replace("{n}", String(selectedCount - 1));

  return (
    <div className="scw-pp" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`scw-pp__btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title={copy.propertyTabHint}
        type="button"
      >
        <span className="scw-pp__label">{label}</span>
        {pending ? (
          <span aria-hidden="true" className="ops__navspin" />
        ) : (
          <ChevronDown aria-hidden="true" className="scw-pp__chev" strokeWidth={2} />
        )}
      </button>
      {open && (
        <div aria-label={copy.propertyGroupLabel} className="scw-pp__pop" role="dialog">
          <div className="scw-pp__list" role="group">
            {tabs.map((tab) => {
              const toggleLabel = (tab.selected ? copy.propertyRemove : copy.propertyAdd).replace("{name}", bName(tab.name));
              return (
                <div className={`scw-pp__row${tab.selected ? " on" : ""}`} key={tab.name}>
                  <button
                    aria-label={toggleLabel}
                    aria-pressed={tab.selected}
                    className="scw-pp__ck"
                    onClick={() => toggle(tab)}
                    title={toggleLabel}
                    type="button"
                  >
                    <Check aria-hidden="true" strokeWidth={3.2} />
                  </button>
                  <OpsNavLink
                    aria-current={tab.selected && selectedCount === 1 ? "page" : undefined}
                    className="scw-pp__name"
                    href={tab.href}
                    onClick={onLabelClick(tab)}
                    title={copy.propertyTabHint}
                  >
                    {bName(tab.name)}
                    {pending && pendingName === tab.name && <span aria-hidden="true" className="ops__navspin" />}
                  </OpsNavLink>
                </div>
              );
            })}
          </div>
          <div className="scw-pp__foot">
            <OpsNavLink
              aria-current={selectedCount === 0 ? "page" : undefined}
              className={`scw-pp__all${selectedCount === 0 ? " on" : ""}`}
              href={allHref}
              onClick={() => setOpen(false)}
              title={copy.propertyClear}
            >
              {copy.allProperties}
            </OpsNavLink>
            <button className="scw-pp__done" onClick={() => setOpen(false)} type="button">
              {copy.scwPropertyShow.replace("{count}", String(selectedCount === 0 ? tabs.length : selectedCount))}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
