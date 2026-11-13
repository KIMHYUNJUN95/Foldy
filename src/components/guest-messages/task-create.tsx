"use client";

/**
 * 손님 메시지 → 업무 한 번에(6단계, 2026-11-13) — PC 오른쪽 패널(시안 R2Task) · 모바일 공용 `BottomSheet`(시안 R2PhoneTask) 공용 조각.
 * docs/product/47-guest-messaging.md §6-4 · §5-7
 *
 * - 종류는 그 사람이 만들 수 있는 것만(`creatableKinds` — 서버가 다시 본다).
 * - 미리 채움: 건물 · 방(예약에서) · 손님 · 고른 손님 말(번역 + 원문). 직원이 저장 전에 고친다(고친 칸은 다시 덮지 않는다).
 * - 손님 사진은 옮기지 않는다 — 첨부는 정보만 저장돼 있어 「사진은 Beds24 에 있어요」로 알린다.
 * - 대화 줄: 링크마다 「수리 · 점검 · 처리 끝 · 오전 11:20 · 열기」(시안 R2PhoneThread) — 업무 상태는 대화를 열 때 읽은 값.
 * 시각 규칙: 세로 구분선 · 카드 테두리 없음 · 구분선 0.5px · 드롭다운(칩 아님) · 입력칸 흰 바탕 1px · 둥근 12 · 위에 걸친 라벨.
 */

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type MutableRefObject } from "react";
import {
  createTaskFromGuestMessage,
  getTaskFormContext,
  type CreateTaskFromMessageResult,
  type TaskFormContext,
  type TaskFromMessageErrorKey,
} from "@/actions/guest-message-tasks";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";
import { fill, formatShortRange, formatTime, newIdempotencyKey, type GmCopy } from "@/components/guest-messages/gm-format";
import type { InboxMessage, InboxThread } from "@/lib/guest-messages/inbox-model";
import {
  buildTaskPrefill,
  linkTargetHref,
  type LinkSurface,
  type LinkTargetType,
  type ThreadLinkView,
} from "@/lib/guest-messages/task-link-model";
import { maintenanceCategories } from "@/lib/maintenance-constants";
import { lostItemCategories } from "@/lib/lost-found-constants";
import { haptic } from "@/lib/haptics";
import { messagePlainText } from "@/lib/guest-messages/message-body";

export type TaskCategoryCopy = {
  maintenance: Record<string, string>;
  lostFound: Record<string, string>;
};

const BUILDING_ONLY = "__building__";

/** 종류 아이콘(시안 R2PhoneTask · R2Main 과 같은 그림). */
export function TaskKindIcon({ kind, size = 16 }: { kind: LinkTargetType; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "maintenance":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
        </svg>
      );
    case "lost_found":
      return (
        <svg {...common}>
          <path d="M20 7 12 3 4 7v10l8 4 8-4z" />
          <path d="M4 7l8 4 8-4M12 11v10" />
        </svg>
      );
    case "task":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      );
    case "complaint":
      return (
        <svg {...common}>
          <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />
        </svg>
      );
  }
}

function statusText(link: ThreadLinkView, copy: GmCopy): string {
  const table = copy.linkStatus[link.targetType] as Record<string, string>;
  return table[link.state.status] ?? table.unknown;
}

/** 대화 안 링크 한 줄 — 「수리 · 점검 · 처리 끝 · 온수 안 나옴 · 오전 11:20 · 열기」. */
export function TaskLinkLine({
  link,
  copy,
  locale,
  surface,
}: {
  link: ThreadLinkView;
  copy: GmCopy;
  locale: string;
  surface: LinkSurface;
}) {
  const when = link.state.doneAt ?? link.createdAt;
  const rawTitle = link.title?.trim() || "";
  // 제목은 손님 말이 그대로 들어가 길 수 있다 — 대화 줄은 한눈에 읽히게 짧게(전체는 업무 상세에서).
  const title = Array.from(rawTitle).length > 40 ? `${Array.from(rawTitle).slice(0, 39).join("").trimEnd()}…` : rawTitle;
  return (
    <p className="gm-tlink" data-done={link.state.done ? "" : undefined}>
      <span className="gm-tlink__text">
        <span className="gm-tlink__icon">
          <TaskKindIcon kind={link.targetType} size={14} />
        </span>
        <b className="gm-tlink__kind">{copy.taskKind[link.targetType]}</b>
        <span className="gm-tlink__meta"> · {statusText(link, copy)}</span>
        {title ? <span className="gm-tlink__title"> · {title}</span> : null}
        <span className="gm-tlink__meta"> · {formatTime(when, locale)}</span>
      </span>
      {link.state.deleted ? null : (
        <Link className="gm-link gm-tlink__open" href={linkTargetHref(link.targetType, link.targetId, surface)}>
          {copy.linkOpen}
        </Link>
      )}
    </p>
  );
}

/** PC 예약 패널 「업무 만들기」 — 종류 단추(2열) + 연결된 업무 목록(시안 R2Main). */
export function TaskPanelSection({
  kinds,
  links,
  copy,
  locale,
  onPick,
}: {
  kinds: LinkTargetType[];
  links: ThreadLinkView[];
  copy: GmCopy;
  locale: string;
  onPick: (kind: LinkTargetType) => void;
}) {
  return (
    <section className="gm-tpanel" aria-label={copy.taskMake}>
      <h3 className="gm-tpanel__title">{copy.taskMake}</h3>
      {kinds.length > 0 ? (
        <>
          <p className="gm-hint gm-tpanel__hint">{copy.taskMakeHint}</p>
          <div className="gm-tkinds">
            {kinds.map((kind) => (
              <button key={kind} type="button" className="gm-tkind" onClick={() => onPick(kind)}>
                <TaskKindIcon kind={kind} />
                <span>{copy.taskKind[kind]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="gm-hint">{copy.taskNoKinds}</p>
      )}
      {links.length === 0 ? (
        <span className="gm-hint">{copy.taskLinkedNone}</span>
      ) : (
        <div className="gm-tpanel__links" aria-label={copy.taskLinkedTitle}>
          {links.map((link) => (
            <TaskLinkLine key={link.id} link={link} copy={copy} locale={locale} surface="admin" />
          ))}
        </div>
      )}
    </section>
  );
}

/** 폰 「업무 만들기」 시트 안 — 고른 말 미리 보기 + 종류 목록(시안 R2PhoneTask). */
export function TaskKindList({
  kinds,
  copy,
  pickedPreview,
  prefilledLine,
  onPick,
  onPickMessages,
}: {
  kinds: LinkTargetType[];
  copy: GmCopy;
  pickedPreview: string | null;
  prefilledLine: string | null;
  onPick: (kind: LinkTargetType) => void;
  onPickMessages: () => void;
}) {
  return (
    <div className="gm-sheet gm-tsheet">
      <h2 className="gm-sheet__title">{copy.taskMake}</h2>
      {prefilledLine ? <span className="gm-hint gm-tsheet__sub">{prefilledLine}</span> : null}
      <button type="button" className="gm-tpicked" onClick={onPickMessages}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M7 7h10M7 12h10M7 17h6" />
        </svg>
        <span>{pickedPreview ?? copy.taskPickedNone}</span>
      </button>
      {kinds.length === 0 ? <p className="gm-hint">{copy.taskNoKinds}</p> : null}
      <div className="gm-tkindlist">
        {kinds.map((kind, index) => (
          <button key={kind} type="button" className="gm-tkindrow" onClick={() => onPick(kind)}>
            <span className="gm-tkindrow__icon" data-first={index === 0 ? "" : undefined}>
              <TaskKindIcon kind={kind} size={19} />
            </span>
            <span className="gm-tkindrow__text">
              <b>{copy.taskKind[kind]}</b>
              <span>{copy.taskKindHint[kind]}</span>
            </span>
          </button>
        ))}
      </div>
      {kinds.length > 0 ? <span className="gm-hint gm-tsheet__foot">{copy.taskOnlyAllowed}</span> : null}
    </div>
  );
}

function errorFor(key: TaskFromMessageErrorKey, copy: GmCopy): string {
  switch (key) {
    case "missing_title":
      return copy.taskErrMissingTitle;
    case "missing_building":
      return copy.taskErrMissingBuilding;
    case "invalid_room":
      return copy.taskErrInvalidRoom;
    case "forbidden":
      return copy.forbidden;
    case "not_found":
      return copy.notFound;
    default:
      return copy.actionFailed;
  }
}

/** 말 하나의 사진 수 — 본문 사진 + 통로가 준 첨부. */
export function messagePhotoCount(m: InboxMessage): number {
  return m.images.length + m.attachmentCount;
}

/** 고른 손님 말(대화 순서). */
export function pickedMessages(thread: InboxThread, pickedIds: ReadonlySet<string>): InboxMessage[] {
  return thread.messages.filter((m) => m.direction === "guest" && pickedIds.has(m.id));
}

/** 고른 말 한 줄 미리 보기 — 「붙일 말 · 「샤워기에서…」 · 사진 1장」. */
export function pickedPreviewLine(messages: InboxMessage[], copy: GmCopy): string | null {
  if (messages.length === 0) return null;
  const first = messages[0];
  const plain = messagePlainText(first.body);
  const text = (
    first.bodyTranslated?.trim() ||
    plain.text ||
    (plain.imageCount > 0 ? copy.photoLabel : copy.attachmentOnly)
  ).replace(/\s+/g, " ");
  const short = Array.from(text).length > 36 ? `${Array.from(text).slice(0, 35).join("")}…` : text;
  const photos = messages.reduce((n, m) => n + messagePhotoCount(m), 0);
  return [
    copy.taskSelectedTag,
    `「${short}」`,
    messages.length > 1 ? fill(copy.taskPickedCount, { n: messages.length }) : null,
    photos > 0 ? fill(copy.attachments, { n: photos }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 만들기 칸의 쓰던 값 — 폰에서 「손님 말 고르기」로 시트를 닫았다 다시 열어도(칸이 새로 그려져도) 고친 제목 · 내용 · 급함 · 분류 ·
 * 건물 · 방 · 요청 id 가 그대로 남게 부르는 쪽이 들고 있는다(`draftRef`). 만들기에 성공하거나 시트를 닫으면 부르는 쪽이 비운다.
 */
export type TaskFormDraft = {
  kind: LinkTargetType;
  title: string;
  body: string;
  titleDirty: boolean;
  bodyDirty: boolean;
  seenPrefill: string;
  urgent: boolean | null;
  category: string;
  building: string | null;
  room: string | null;
  submission: { kind: LinkTargetType; id: string };
};

export function TaskCreateForm({
  thread,
  kind,
  kinds,
  onKindChange,
  pickedIds,
  copy,
  locale,
  categoryCopy,
  variant,
  onCreated,
  onClose,
  onPickMessages,
  draftRef,
  onBackgroundError,
}: {
  thread: InboxThread;
  kind: LinkTargetType;
  kinds: LinkTargetType[];
  onKindChange: (kind: LinkTargetType) => void;
  pickedIds: ReadonlySet<string>;
  copy: GmCopy;
  locale: string;
  categoryCopy: TaskCategoryCopy;
  variant: "pc" | "phone";
  onCreated: (result: Extract<CreateTaskFromMessageResult, { ok: true }>) => void;
  onClose: () => void;
  /** 폰 — 시트를 닫고 대화에서 말을 고르러 간다. */
  onPickMessages?: () => void;
  /** 폰 — 칸이 닫혔다 다시 열려도 쓰던 값을 잇는다. */
  draftRef?: MutableRefObject<TaskFormDraft | null>;
  /** 저장 중에 칸이 닫혔으면(시트를 내림) 실패 문구를 여기로 — 부르는 쪽 토스트. */
  onBackgroundError?: (message: string) => void;
}) {
  const row = thread.conversation;
  const buildingName = useBuildingName();
  const roomPlace = useRoomPlaceLabel();
  const ids = useId();
  const [context, setContext] = useState<TaskFormContext | null>(null);
  const [contextError, setContextError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 다시 열린 칸이면 쓰던 값에서 시작한다(같은 종류일 때만 — 종류마다 분류 · 요청 id 가 다르다).
  const [saved] = useState(() => (draftRef?.current && draftRef.current.kind === kind ? draftRef.current : null));
  const submissionRef = useRef<{ kind: LinkTargetType; id: string }>(saved?.submission ?? { kind, id: newIdempotencyKey() });
  if (submissionRef.current.kind !== kind) submissionRef.current = { kind, id: newIdempotencyKey() };
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const picked = useMemo(() => pickedMessages(thread, pickedIds), [thread, pickedIds]);
  const prefill = useMemo(
    () =>
      buildTaskPrefill(
        picked.map((m) => ({
          // 업무 글에는 앵커 · 사진 주소 대신 글만(47 §5-8).
          body: messagePlainText(m.body).text,
          translated: m.translatedLang === locale ? m.bodyTranslated : null,
          timeLabel: formatTime(m.sentAt, locale),
        })),
        { guestSaid: copy.taskGuestSaid, original: copy.taskOriginal },
      ),
    [picked, locale, copy.taskGuestSaid, copy.taskOriginal],
  );
  const [title, setTitle] = useState(saved?.title ?? prefill.title);
  const [body, setBody] = useState(saved?.body ?? prefill.body);
  const [titleDirty, setTitleDirty] = useState(saved?.titleDirty ?? false);
  const [bodyDirty, setBodyDirty] = useState(saved?.bodyDirty ?? false);
  const prefillKey = `${prefill.title}\u0000${prefill.body}`;
  const [seenPrefill, setSeenPrefill] = useState(saved?.seenPrefill ?? prefillKey);
  if (seenPrefill !== prefillKey) {
    // 고른 말이 바뀌면 고치지 않은 칸만 다시 채운다(직원이 쓴 글을 덮지 않는다).
    setSeenPrefill(prefillKey);
    if (!titleDirty) setTitle(prefill.title);
    if (!bodyDirty) setBody(prefill.body);
  }
  const [urgent, setUrgent] = useState<boolean | null>(saved?.urgent ?? null);
  const [category, setCategory] = useState(saved?.category ?? "other");
  const [building, setBuilding] = useState<string | null>(saved?.building ?? null);
  const [room, setRoom] = useState<string | null>(saved?.room ?? null);
  const [seenKind, setSeenKind] = useState(kind);
  if (seenKind !== kind) {
    setSeenKind(kind);
    setCategory("other");
    setError(null);
    // 「건물 전체」는 수리 · 점검만 — 다른 종류로 바꾸면 방을 다시 고르게 한다(그대로 두면 서버가 방 없음으로 거절).
    if (kind !== "maintenance" && room === BUILDING_ONLY) setRoom(null);
  }

  // 쓰던 값을 부르는 쪽에 남긴다(폰 고르기 모드로 칸이 닫혀도 잇게).
  useEffect(() => {
    if (!draftRef) return;
    draftRef.current = {
      kind,
      title,
      body,
      titleDirty,
      bodyDirty,
      seenPrefill,
      urgent,
      category,
      building,
      room,
      submission: submissionRef.current,
    };
  }, [draftRef, kind, title, body, titleDirty, bodyDirty, seenPrefill, urgent, category, building, room]);

  useEffect(() => {
    let cancelled = false;
    void getTaskFormContext(row.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setContextError(true);
        return;
      }
      setContext(result);
      setBuilding((current) => current ?? result.place?.propertyName ?? null);
      setRoom((current) => current ?? result.place?.roomLabel ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const needsPlace = kind === "maintenance" || kind === "lost_found";
  const urgentValue = urgent ?? Boolean(context?.stayingNow);
  const rooms = context?.places.find((p) => p.propertyName === building)?.rooms ?? [];
  const photoCount = picked.reduce((n, m) => n + messagePhotoCount(m), 0);
  const place = [row.propertyName ? buildingName(row.propertyName) : null, row.roomLabel ? roomPlace(row.roomLabel) : null]
    .filter((v, i, all) => v && all.indexOf(v) === i)
    .join(" · ");
  const stay = formatShortRange(thread.reservation.checkInDate, thread.reservation.checkOutDate);
  const guestLine = [row.guestName || copy.guestUnknown, stay].filter(Boolean).join(" · ");
  const categories =
    kind === "maintenance"
      ? maintenanceCategories.map((value) => ({ value, label: categoryCopy.maintenance[value] ?? value }))
      : kind === "lost_found"
        ? lostItemCategories.map((value) => ({ value, label: categoryCopy.lostFound[value] ?? value }))
        : [];

  const submit = () => {
    if (pending) return;
    if (!title.trim()) {
      setError(copy.taskErrMissingTitle);
      haptic("error");
      return;
    }
    if (needsPlace && !building) {
      setError(copy.taskErrMissingBuilding);
      haptic("error");
      return;
    }
    if (needsPlace && !room) {
      setError(copy.taskErrInvalidRoom);
      haptic("error");
      return;
    }
    setError(null);
    startTransition(async () => {
      // 응답을 못 받으면(연결 끊김) 던진다 — 오류 화면 대신 실패 문구. 요청 id 는 그대로라 다시 누르면 같은 한 건(서버가 멱등).
      const result: CreateTaskFromMessageResult = await createTaskFromGuestMessage({
        conversationId: row.id,
        kind,
        messageIds: picked.map((m) => m.id),
        title: title.trim(),
        body: body.trim(),
        urgent: (kind === "maintenance" || kind === "task") && urgentValue,
        category,
        propertyName: needsPlace ? building : null,
        roomLabel: needsPlace && room !== BUILDING_ONLY ? room : null,
        buildingOnly: kind === "maintenance" && room === BUILDING_ONLY,
        submissionId: submissionRef.current.id,
      }).catch((): CreateTaskFromMessageResult => ({ ok: false, errorKey: "failed" }));
      if (result.ok) {
        // 성공 햅틱은 서버가 저장을 확인한 뒤에만(16 「햅틱 — 공용 규칙」).
        haptic("success");
        submissionRef.current = { kind, id: newIdempotencyKey() };
        onCreated(result);
      } else {
        haptic("error");
        const message = errorFor(result.errorKey, copy);
        // 저장 중에 시트를 내렸으면 칸 안 문구는 아무도 못 본다 — 부르는 쪽 토스트로.
        if (mountedRef.current) setError(message);
        else onBackgroundError?.(message);
      }
    });
  };

  const select = (
    label: string,
    value: string | null,
    options: Array<{ value: string; label: string }>,
    onChange: (value: string) => void,
    placeholder: string,
  ) =>
    variant === "pc" ? (
      <AdmDropdown
        options={options}
        value={value ?? ""}
        onChange={onChange}
        ariaLabel={label}
        placeholder={placeholder}
        searchable={options.length > 12}
      />
    ) : (
      <select className="gm-select gm-tform__select" aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        {value ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );

  const buildingOptions = (context?.places ?? []).map((p) => ({ value: p.propertyName, label: buildingName(p.propertyName) }));
  const roomOptions = [
    ...(kind === "maintenance" ? [{ value: BUILDING_ONLY, label: copy.taskBuildingOnly }] : []),
    ...rooms.map((r) => ({ value: r, label: roomPlace(r) })),
  ];
  const fromReservation = Boolean(context?.place && building === context.place.propertyName && room === context.place.roomLabel);

  return (
    <div className={`gm-tform gm-tform--${variant}`}>
      <div className="gm-tform__head">
        <h2 className="gm-tform__title">{copy.taskMake}</h2>
        {variant === "pc" ? (
          <button type="button" className="gm-iconbtn gm-tform__close" aria-label={copy.taskClose} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </div>

      {kinds.length > 1 ? (
        variant === "pc" ? (
          <div className="gm-tseg" role="radiogroup" aria-label={copy.taskKindsLabel} data-count={kinds.length}>
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === kind}
                className="gm-tseg__item"
                onClick={() => {
                  haptic("light");
                  onKindChange(k);
                }}
              >
                {copy.taskKindShort[k]}
              </button>
            ))}
          </div>
        ) : (
          <select
            className="gm-select gm-tform__select"
            aria-label={copy.taskKindsLabel}
            value={kind}
            onChange={(event) => onKindChange(event.target.value as LinkTargetType)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {copy.taskKind[k]}
              </option>
            ))}
          </select>
        )
      ) : null}

      <div className="gm-tform__rows">
        {needsPlace ? (
          <>
            <div className="gm-tform__row">
              <span className="gm-tform__k">{copy.taskFieldBuilding}</span>
              <div className="gm-tform__v">
                {context
                  ? select(
                      copy.taskFieldBuilding,
                      building,
                      buildingOptions,
                      (value) => {
                        setBuilding(value || null);
                        setRoom(null);
                      },
                      copy.taskPickBuilding,
                    )
                  : <span className="gm-hint">{contextError ? copy.actionFailed : copy.loading}</span>}
              </div>
            </div>
            <div className="gm-tform__row">
              <span className="gm-tform__k">{copy.taskFieldRoom}</span>
              <div className="gm-tform__v">
                {context && building ? select(copy.taskFieldRoom, room, roomOptions, (value) => setRoom(value || null), copy.taskPickRoom) : <span className="gm-hint">—</span>}
                {fromReservation ? <span className="gm-hint gm-tform__note">{copy.taskFromReservation}</span> : null}
              </div>
            </div>
          </>
        ) : (
          <div className="gm-tform__row">
            <span className="gm-tform__k">{copy.taskFieldPlace}</span>
            <div className="gm-tform__v">
              <span>{place || copy.unknownValue}</span>
              {place ? <span className="gm-hint gm-tform__note">{copy.taskFromReservation}</span> : null}
            </div>
          </div>
        )}
        <div className="gm-tform__row">
          <span className="gm-tform__k">{copy.taskFieldGuest}</span>
          <div className="gm-tform__v">
            <span>{guestLine}</span>
          </div>
        </div>
      </div>

      <label className="gm-field" htmlFor={`${ids}-title`}>
        <span className="gm-field__label">{kind === "lost_found" ? copy.taskFieldItemName : copy.taskFieldTitle}</span>
        <input
          id={`${ids}-title`}
          className="gm-field__input gm-tform__input"
          value={title}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleDirty(true);
          }}
        />
      </label>
      <label className="gm-field" htmlFor={`${ids}-body`}>
        <span className="gm-field__label">{kind === "lost_found" ? copy.taskFieldMemo : copy.taskFieldBody}</span>
        <textarea
          id={`${ids}-body`}
          className="gm-field__input gm-tform__textarea"
          value={body}
          rows={variant === "pc" ? 5 : 4}
          onChange={(event) => {
            setBody(event.target.value);
            setBodyDirty(true);
          }}
        />
      </label>

      <div className="gm-tform__picked">
        <span className="gm-hint">{picked.length > 0 ? fill(copy.taskPickedCount, { n: picked.length }) : copy.taskSelectHint}</span>
        {onPickMessages ? (
          <button type="button" className="gm-link" onClick={onPickMessages}>
            {copy.taskPickMessages}
          </button>
        ) : null}
      </div>
      {photoCount > 0 ? <span className="gm-hint">{fill(copy.taskPhotosInBeds24, { n: photoCount })}</span> : null}

      {categories.length > 0 ? (
        <div className="gm-tform__row gm-tform__row--plain">
          <span className="gm-tform__k">{copy.taskFieldCategory}</span>
          <div className="gm-tform__v">{select(copy.taskFieldCategory, category, categories, setCategory, copy.taskFieldCategory)}</div>
        </div>
      ) : null}

      {kind === "maintenance" || kind === "task" ? (
        <label className="gm-tform__check">
          <input type="checkbox" checked={urgentValue} onChange={(event) => setUrgent(event.target.checked)} />
          <span>{context?.stayingNow ? copy.taskUrgentStaying : copy.taskUrgent}</span>
        </label>
      ) : null}

      {error ? (
        <span className="gm-hint gm-urgent" role="alert">
          {error}
        </span>
      ) : null}

      <div className="gm-tform__foot">
        <span className="gm-hint">{fill(copy.taskSaveHint, { kind: copy.taskKind[kind] })}</span>
        <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={pending} onClick={submit}>
          {pending ? copy.taskCreating : copy.taskCreate}
        </button>
      </div>
    </div>
  );
}
