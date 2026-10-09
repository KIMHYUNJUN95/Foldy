"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import type { Locale } from "@/lib/i18n";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import { dismissPopupForWeek } from "@/app/announcements/popup-actions";

const POPUP_HIDE_STORAGE_KEY = "stayops:announcement-popup-hidden-until";
const POPUP_HIDE_STORAGE_EVENT = "stayops:announcement-popup-storage";
const HIDE_FOR_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type HiddenPopupMap = Record<string, string>;
type HidePreference = {
  announcementId: string | null;
  checked: boolean;
};

function readHiddenPopupSnapshot() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.localStorage.getItem(POPUP_HIDE_STORAGE_KEY);

    if (!raw) {
      return "";
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return "";
    }

    const now = Date.now();
    const nextMap = Object.fromEntries(
      Object.entries(parsed).filter((entry) => {
        const [, value] = entry;

        return typeof value === "string" && new Date(value).getTime() > now;
      }),
    ) as HiddenPopupMap;
    const nextSnapshot = JSON.stringify(nextMap);

    if (raw !== nextSnapshot) {
      window.localStorage.setItem(POPUP_HIDE_STORAGE_KEY, nextSnapshot);
    }

    return nextSnapshot;
  } catch {
    return "";
  }
}

function subscribeHiddenPopupSnapshot(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onCustomEvent = () => callback();
  const onStorage = (event: StorageEvent) => {
    if (event.key === POPUP_HIDE_STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener(POPUP_HIDE_STORAGE_EVENT, onCustomEvent);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(POPUP_HIDE_STORAGE_EVENT, onCustomEvent);
    window.removeEventListener("storage", onStorage);
  };
}

function writeHiddenPopupMap(map: HiddenPopupMap) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(POPUP_HIDE_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(POPUP_HIDE_STORAGE_EVENT));
  } catch {}
}

function subscribeHydration(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const id = window.requestAnimationFrame(() => callback());

  return () => window.cancelAnimationFrame(id);
}

function AlertIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="12" cy="16.7" r="1.05" fill="currentColor"/>
    </svg>
  );
}

// 연도 없이 월+일만 표시
function formatPopupDate(value: string, locale: string): string {
  const tag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    month: "long", day: "numeric", timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

export type PopupAnnouncement = {
  content: string;
  id: string;
  imageUrls: string[];
  isImportant: boolean;
  organizationId: string;
  publishedAt?: string | null;
  title: string;
};

type AnnouncementPopupProps = {
  announcements: PopupAnnouncement[];
  detailHrefBase: string;
  locale: Locale;
};

export function AnnouncementPopup({
  announcements,
  detailHrefBase,
  locale,
}: AnnouncementPopupProps) {
  const copy = getAnnouncementDictionary(locale);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [hidePreference, setHidePreference] = useState<HidePreference>({
    announcementId: null,
    checked: false,
  });
  const [, startTransition] = useTransition();
  const isHydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const hiddenPopupSnapshot = useSyncExternalStore(
    subscribeHiddenPopupSnapshot,
    readHiddenPopupSnapshot,
    () => "",
  );
  const hiddenPopupMap = useMemo<HiddenPopupMap>(() => {
    if (!hiddenPopupSnapshot) {
      return {};
    }

    try {
      return JSON.parse(hiddenPopupSnapshot) as HiddenPopupMap;
    } catch {
      return {};
    }
  }, [hiddenPopupSnapshot]);

  const announcement = useMemo(
    () =>
      announcements.find((item) => {
        if (dismissedIds.has(item.id)) {
          return false;
        }

        return !hiddenPopupMap?.[item.id];
      }),
    [announcements, dismissedIds, hiddenPopupMap],
  );
  const hideForWeek =
    announcement?.id === hidePreference.announcementId && hidePreference.checked;

  if (!isHydrated || !announcement) {
    return null;
  }

  function dismissCurrentAnnouncement() {
    if (!announcement) {
      return;
    }

    if (hideForWeek) {
      const nextMap: HiddenPopupMap = {
        ...hiddenPopupMap,
        [announcement.id]: new Date(Date.now() + HIDE_FOR_WEEK_MS).toISOString(),
      };

      writeHiddenPopupMap(nextMap);

      // 서버에 비동기로 저장 — UI를 즉시 업데이트하기 위해 transition 내부에서 fire-and-forget
      startTransition(() => {
        void dismissPopupForWeek(announcement.id, announcement.organizationId);
      });
    }

    setDismissedIds((current) => new Set(current).add(announcement.id));
  }

  return (
    <BottomSheet
      ariaLabel={copy.important}
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
      onClose={dismissCurrentAnnouncement}
    >
      {({ close }) => (
        <>
          {/* 중요 칩 + 날짜 */}
          <div className="flex items-center gap-[7px] pt-1.5">
            <span className="inline-flex items-center gap-[3px] text-[10.5px] font-extrabold text-red-600 bg-red-50 px-2 py-[3px] rounded-full border border-red-200">
              <AlertIcon />
              {copy.important}
            </span>
            {announcement.publishedAt && (
              <span className="text-[11.5px] font-bold text-slate-500">
                {formatPopupDate(announcement.publishedAt, locale)}
              </span>
            )}
          </div>

          {/* 제목 */}
          <h2 className="text-[19px] font-black leading-snug tracking-tight mt-3">
            {announcement.title}
          </h2>

          {/* 본문 (최대 6줄) */}
          <p className="text-[13.5px] font-medium leading-relaxed text-slate-600 mt-3 line-clamp-6 whitespace-pre-line">
            {announcement.content}
          </p>

          {/* 이미지 */}
          {announcement.imageUrls.length > 0 && (
            <AnnouncementImageGrid imageUrls={announcement.imageUrls} closeLabel={copy.close} imageAltLabel={copy.imageAttachments} />
          )}

          {/* 7일 숨기기 체크박스 */}
          <label className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-slate-500">
            <input
              checked={hideForWeek}
              className="size-4 rounded border border-slate-300 bg-surface accent-primary"
              onChange={(event) =>
                setHidePreference({
                  announcementId: announcement.id,
                  checked: event.target.checked,
                })
              }
              type="checkbox"
            />
            {copy.hideForWeek}
          </label>

          {/* CTA: 확인(ghost) + 자세히 보기(primary) */}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              className="flex-1 h-12 rounded-[13px] border border-border bg-surface text-sm font-extrabold text-slate-700"
              onClick={close}
            >
              {copy.confirm}
            </button>
            <Link
              href={`${detailHrefBase}/${announcement.id}`}
              className="flex-1 h-12 rounded-[13px] bg-primary text-sm font-extrabold text-white inline-flex items-center justify-center shadow-[0_12px_22px_-12px_rgb(122_82_230/0.55)]"
            >
              {copy.viewDetail}
            </Link>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
