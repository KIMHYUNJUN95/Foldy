"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { LegalDocument } from "@/lib/legal-content";

export type LegalOverlayDoc = "terms" | "privacy";

export type LegalOverlayCopy = {
  title: string;
  termsTab: string;
  privacyTab: string;
  confirm: string;
  openNew: string;
  close: string;
};

/** 넓은 화면(≥ 1200px, 로그인 머리 · 바닥 줄이 보이는 폭)만 가운데 팝업. 그보다 좁으면 하단 시트. */
const DESKTOP_QUERY = "(min-width: 1200px)";

/**
 * 이용약관 · 개인정보 처리방침을 **그 자리에서** 연다(화이트 리디자인 2026-10-09, 시안 「약관 보기」).
 *
 * 폰 · 폴드 · 태블릿 = 공용 하단 시트(태블릿 가로도 가운데 카드가 아니라 바닥에서 — 사용자 결정),
 * PC = 가운데 팝업(닫기 X · 「새 창에서 보기」). 링크 자체는 진짜 `href` 라 새 탭 · 자바스크립트 없이도 열린다.
 */
export function LegalLink({
  doc,
  href,
  className,
  children,
  copy,
  documents,
  hrefs,
}: {
  doc: LegalOverlayDoc;
  href: string;
  className?: string;
  children: ReactNode;
  copy: LegalOverlayCopy;
  documents: Record<LegalOverlayDoc, LegalDocument>;
  hrefs: Record<LegalOverlayDoc, string>;
}) {
  const [open, setOpen] = useState<null | "sheet" | "modal">(null);
  const [tab, setTab] = useState<LegalOverlayDoc>(doc);

  return (
    <>
      <a
        className={className}
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          setTab(doc);
          setOpen(window.matchMedia(DESKTOP_QUERY).matches ? "modal" : "sheet");
        }}
      >
        {children}
      </a>
      {open === "sheet" && (
        <BottomSheet
          ariaLabel={copy.title}
          className="flex h-[88dvh] max-h-[88dvh] flex-col"
          onClose={() => setOpen(null)}
          tabletLayout="bottom"
        >
          {({ close }) => (
            <LegalBody copy={copy} documents={documents} onTab={setTab} tab={tab}>
              <div className="-mx-5 border-t-[0.5px] border-[var(--separator)] px-5 pt-3">
                <button
                  className="h-[52px] w-full rounded-[14px] bg-primary text-[16px] font-semibold text-white"
                  onClick={close}
                  type="button"
                >
                  {copy.confirm}
                </button>
              </div>
            </LegalBody>
          )}
        </BottomSheet>
      )}
      {open === "modal" && (
        <LegalModal copy={copy} documents={documents} hrefs={hrefs} onClose={() => setOpen(null)} onTab={setTab} tab={tab} />
      )}
    </>
  );
}

function LegalBody({
  copy,
  documents,
  tab,
  onTab,
  children,
  header,
  gutter = "-mx-5 px-5",
}: {
  copy: LegalOverlayCopy;
  documents: Record<LegalOverlayDoc, LegalDocument>;
  tab: LegalOverlayDoc;
  onTab: (tab: LegalOverlayDoc) => void;
  children?: ReactNode;
  header?: ReactNode;
  /** 바깥 여백만큼 선 · 스크롤 영역을 끝까지 늘린다(시트 20px · 팝업 28px). */
  gutter?: string;
}) {
  const doc = documents[tab];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header ?? <p className="pb-3 text-[18px] font-bold text-foreground">{copy.title}</p>}
      <div className={`${gutter} flex gap-6 border-b border-[var(--separator)]`} role="tablist">
        {(["terms", "privacy"] as const).map((key) => (
          <button
            aria-selected={tab === key}
            className={`-mb-px h-11 border-b-2 text-[15px] ${
              tab === key ? "border-foreground font-semibold text-foreground" : "border-transparent text-text-3"
            }`}
            key={key}
            onClick={() => onTab(key)}
            role="tab"
            type="button"
          >
            {key === "terms" ? copy.termsTab : copy.privacyTab}
          </button>
        ))}
      </div>
      <div className={`${gutter} min-h-0 flex-1 overflow-y-auto py-5`} key={tab}>
        <p className="rounded-[14px] bg-[#f7f7f9] px-4 py-[14px] text-[15px] leading-[1.65] text-[#3a3746]">{doc.summary}</p>
        <div className="mt-5 space-y-6">
          {doc.sections.map((section) => (
            <section id={section.id} key={section.heading}>
              <h3 className="text-[15px] font-bold text-foreground">{section.heading}</h3>
              {section.paragraphs?.map((paragraph) => (
                <p className="mt-2 text-[15px] leading-[1.7] text-[#3a3746]" key={paragraph}>
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-[1.7] text-[#3a3746]">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

function LegalModal({
  copy,
  documents,
  hrefs,
  tab,
  onTab,
  onClose,
}: {
  copy: LegalOverlayCopy;
  documents: Record<LegalOverlayDoc, LegalDocument>;
  hrefs: Record<LegalOverlayDoc, string>;
  tab: LegalOverlayDoc;
  onTab: (tab: LegalOverlayDoc) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-label={copy.title}
        aria-modal="true"
        className="flex max-h-[min(780px,88dvh)] w-full max-w-[640px] flex-col rounded-[24px] bg-white px-7 pt-7 shadow-[0_30px_80px_-30px_rgba(2,6,23,0.6)]"
        role="dialog"
      >
        <LegalBody
          copy={copy}
          documents={documents}
          header={
            <div className="flex items-start justify-between pb-3">
              <p className="text-[20px] font-bold text-foreground">{copy.title}</p>
              <button
                aria-label={copy.close}
                className="-mr-2 -mt-1 flex size-10 items-center justify-center rounded-[10px] text-[#6b6878] hover:bg-[#f7f7f9]"
                onClick={onClose}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          }
          gutter="-mx-7 px-7"
          onTab={onTab}
          tab={tab}
        >
          <div className="-mx-7 flex items-center justify-between border-t-[0.5px] border-[var(--separator)] px-7 py-4">
            <a className="flex items-center gap-1.5 text-[14px] text-[#6b6878] hover:text-foreground" href={hrefs[tab]} rel="noreferrer" target="_blank">
              {copy.openNew}
              <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
            <button className="h-11 rounded-[12px] bg-primary px-6 text-[15px] font-semibold text-white" onClick={onClose} type="button">
              {copy.confirm}
            </button>
          </div>
        </LegalBody>
      </div>
    </div>,
    document.body,
  );
}
