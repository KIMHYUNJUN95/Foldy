"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import type { Locale } from "@/lib/i18n";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import { dismissPopupForWeek } from "@/app/announcements/popup-actions";
import "./announcements-mobile.css";

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
  // 「1 / 2」 — 이번에 띄울 공지 묶음(이미 7일 숨긴 것 제외) 안에서 몇 번째인지. 닫은 것도 묶음에 남아 번호가 올라간다.
  const queue = announcements.filter((item) => !hiddenPopupMap?.[item.id]);
  const position = announcement ? queue.findIndex((item) => item.id === announcement.id) + 1 : 0;

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
    // 공지마다 새 시트 — 같은 시트를 다시 쓰면 닫힌 상태가 남아 다음 팝업(「2 / 2」)이 뜨지 않았다.
    <BottomSheet
      key={announcement.id}
      ariaLabel={copy.white.mPopupLabel}
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
      onClose={dismissCurrentAnnouncement}
    >
      {({ close }) => (
        // 화이트 리디자인(2026-10-15, 시안 NoticePopup-Phone) — 표시 · 날짜 · 「1 / 2」 → 제목 → 본문 6줄 → 사진 → 7일 숨기기 → 확인 / 자세히 보기.
        <div className="ntw ntw-pop">
          <div className="ntw-pop__top">
            {announcement.isImportant ? <span className="is-red">{copy.white.important}</span> : null}
            {announcement.publishedAt ? <span>{formatPopupDate(announcement.publishedAt, locale)}</span> : null}
            {queue.length > 1 ? (
              <span className="ntw-pop__n num">{copy.white.mPopupCount.replace("{i}", String(position)).replace("{n}", String(queue.length))}</span>
            ) : null}
          </div>
          <h2>{announcement.title}</h2>
          <p className="ntw-pop__body">{announcement.content}</p>
          {announcement.imageUrls.length > 0 ? (
            <AnnouncementImageGrid imageUrls={announcement.imageUrls} closeLabel={copy.close} imageAltLabel={copy.imageAttachments} variant="plain" />
          ) : null}
          <label className="ntw-check">
            <input
              checked={hideForWeek}
              onChange={(event) =>
                setHidePreference({
                  announcementId: announcement.id,
                  checked: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span className="ntw-check__box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            {copy.hideForWeek}
          </label>
          <div className="ntw-pop__btns">
            <button type="button" className="ntw-btn is-gray" onClick={close}>
              {copy.confirm}
            </button>
            <Link href={`${detailHrefBase}/${announcement.id}`} className="ntw-btn is-pri">
              {copy.viewDetail}
            </Link>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
