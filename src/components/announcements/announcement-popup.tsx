"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import type { Locale } from "@/lib/i18n";
import { annDate } from "@/lib/announcement-display";
import { getAnnouncementDictionary } from "@/lib/announcement-i18n";
import { dismissPopupForWeek } from "@/app/announcements/popup-actions";
import {
  type HiddenPopupMap,
  filterPopupQueue,
  parseHiddenPopupMap,
  parseSessionSeen,
  popupHideStorageKey,
  popupSessionStorageKey,
} from "@/lib/announcement-rules";
import "./announcements-mobile.css";

const POPUP_STORAGE_EVENT = "foldy:announcement-popup-storage";
const HIDE_FOR_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_SEPARATOR = "\u0000";

type HidePreference = {
  announcementId: string | null;
  checked: boolean;
};

// 브라우저 기록 두 가지를 한 문자열로 읽는다 — 「7일 보지 않기」(localStorage, 사람별) + 이번 세션에 닫은 것(sessionStorage).
// 저장소가 막힌 환경(사생활 보호 창 등)에서는 빈 값 — 팝업은 서버 기록(읽음 · DB 7일 숨김)만으로 동작한다.
function readPopupSnapshot(userId: string): string {
  if (typeof window === "undefined") return SNAPSHOT_SEPARATOR;
  let hidden = "";
  let seen = "";
  try {
    const key = popupHideStorageKey(userId);
    const raw = window.localStorage.getItem(key);
    const pruned = JSON.stringify(parseHiddenPopupMap(raw, Date.now()));
    if (raw && raw !== pruned) window.localStorage.setItem(key, pruned);
    hidden = pruned;
  } catch {}
  try {
    seen = window.sessionStorage.getItem(popupSessionStorageKey(userId)) ?? "";
  } catch {}
  return `${hidden}${SNAPSHOT_SEPARATOR}${seen}`;
}

function subscribePopupSnapshot(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onCustomEvent = () => callback();
  const onStorage = () => callback();

  window.addEventListener(POPUP_STORAGE_EVENT, onCustomEvent);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(POPUP_STORAGE_EVENT, onCustomEvent);
    window.removeEventListener("storage", onStorage);
  };
}

function writeHiddenPopupMap(userId: string, map: HiddenPopupMap) {
  try {
    window.localStorage.setItem(popupHideStorageKey(userId), JSON.stringify(map));
  } catch {}
  window.dispatchEvent(new Event(POPUP_STORAGE_EVENT));
}

function markSeenThisSession(userId: string, announcementId: string) {
  try {
    const key = popupSessionStorageKey(userId);
    const seen = parseSessionSeen(window.sessionStorage.getItem(key));
    seen.add(announcementId);
    window.sessionStorage.setItem(key, JSON.stringify([...seen]));
  } catch {}
  window.dispatchEvent(new Event(POPUP_STORAGE_EVENT));
}

function subscribeHydration(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const id = window.requestAnimationFrame(() => callback());

  return () => window.cancelAnimationFrame(id);
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
  /** 브라우저 기록을 사람마다 나누는 키. */
  userId: string;
};

export function AnnouncementPopup({
  announcements,
  detailHrefBase,
  locale,
  userId,
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
  const popupSnapshot = useSyncExternalStore(
    subscribePopupSnapshot,
    () => readPopupSnapshot(userId),
    () => SNAPSHOT_SEPARATOR,
  );
  const { hiddenPopupMap, sessionSeen } = useMemo(() => {
    const [hidden = "", seen = ""] = popupSnapshot.split(SNAPSHOT_SEPARATOR);
    return {
      // 읽을 때(readPopupSnapshot) 이미 끝난 숨김을 걸렀다 — 여기서는 모양만 푼다.
      hiddenPopupMap: parseHiddenPopupMap(hidden || null, 0),
      sessionSeen: parseSessionSeen(seen || null),
    };
  }, [popupSnapshot]);

  // 이번 차례 — 7일 숨김 · 이번 세션에 닫은 것을 뺀다. 이 화면에서 방금 닫은 것은 「1 / 2」 번호가 이어지도록 남긴다.
  const queue = filterPopupQueue(announcements, hiddenPopupMap, sessionSeen, dismissedIds);
  const announcement = queue.find((item) => !dismissedIds.has(item.id));
  const hideForWeek =
    announcement?.id === hidePreference.announcementId && hidePreference.checked;
  const position = announcement ? queue.findIndex((item) => item.id === announcement.id) + 1 : 0;

  if (!isHydrated || !announcement) {
    return null;
  }

  // 닫기(확인 · 바깥 누름 · 끌어내림) · 「자세히 보기」 모두 여기로 — 이번 세션에는 다시 띄우지 않고,
  // 「7일 동안 보지 않기」를 켰으면 브라우저 + 서버에 7일 숨김을 남긴다.
  function dismissCurrentAnnouncement() {
    if (!announcement) {
      return;
    }
    const target = announcement;

    if (hideForWeek) {
      writeHiddenPopupMap(userId, {
        ...hiddenPopupMap,
        [target.id]: new Date(Date.now() + HIDE_FOR_WEEK_MS).toISOString(),
      });

      // 서버에 비동기로 저장 — UI를 즉시 업데이트하기 위해 transition 내부에서 fire-and-forget
      startTransition(() => {
        void dismissPopupForWeek(target.id, target.organizationId);
      });
    }

    setDismissedIds((current) => new Set(current).add(target.id));
    markSeenThisSession(userId, target.id);
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
            {announcement.publishedAt ? <span>{annDate(announcement.publishedAt)}</span> : null}
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
            <Link href={`${detailHrefBase}/${announcement.id}`} className="ntw-btn is-pri" onClick={dismissCurrentAnnouncement}>
              {copy.viewDetail}
            </Link>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
