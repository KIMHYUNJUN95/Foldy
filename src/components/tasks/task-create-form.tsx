"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { CalendarDays, ChevronDown, ChevronRight, Megaphone, Share2, Users, X } from "lucide-react";
import { createTask } from "@/app/mobile/tasks/new/actions";
import { updateTaskCore } from "@/app/mobile/tasks/[id]/actions";
import { TaskSchedulePicker } from "@/components/tasks/task-schedule-sheet";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import { SharePicker } from "@/components/tasks/share-picker";
import { ContextLinkSection, type LinkedContext } from "@/components/tasks/context-link-section";
import { ContextPickerSheet } from "@/components/tasks/context-picker-sheet";
import type { Dictionary } from "@/lib/i18n";
import type { ShareableUser } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import "./tasks-white.css";

type Copy = Dictionary["tasks"];

// 우선순위 1~4 (Todoist) 순서로 표시: urgent(1) · important(2) · medium(3) · normal(4).
const PRIOS = ["urgent", "important", "medium", "normal"] as const;

type TaskInitial = {
  title: string;
  description: string;
  scheduled: string;
  due: string;
  time: string;
  duration: number;
  priority: string;
  repeat: string;
  tags: string[];
  imageUrls: string[];
};

// Context link initial state for edit mode — constructed from the task's resolved context.
type TaskInitialCtx = Pick<
  LinkedContext,
  | "propertyId"
  | "roomId"
  | "propertyName"
  | "roomLabel"
  | "reservationId"
  | "guestName"
  | "channel"
  | "checkinDate"
  | "checkoutDate"
>;

export function TaskCreateForm({
  buildingLabels,
  copy,
  defaultDate,
  defaultDirective = false,
  defaultTitle,
  headerTitle,
  imgCopy,
  initial,
  initialCtx,
  locale,
  maxImages = 5,
  mode = "create",
  organizationId,
  projectId,
  sectionId,
  serverError,
  taskId,
  users,
}: {
  // Page header is owned by the form so the top-right Save can be a native submit (keeps `isPending`).
  buildingLabels: Record<string, string>;
  copy: Copy;
  defaultDate: string | null;
  /** 지시 모드로 폼을 연다(모바일 "보낸 지시" 진입점). 대상을 고르면 토글이 켜진 채로 보인다. */
  defaultDirective?: boolean;
  locale: string;
  // Prefilled title carried over from Quick Add (create mode only). Kept separate from
  // `initial` so the Calendar date-prefill (`defaultDate`) keeps working.
  defaultTitle?: string;
  headerTitle: string;
  imgCopy: Dictionary["requestImages"];
  initial?: TaskInitial;
  /** Pre-populated context link for edit mode (from the task's resolved context). */
  initialCtx?: TaskInitialCtx | null;
  /** Max attachable photos. 5 by default; project tasks raise it to 20. */
  maxImages?: number;
  mode?: "create" | "edit";
  organizationId: string;
  /** When set, this is a project task — persisted with project_id (+ optional section_id) and the
   *  per-task Share section is hidden (project membership governs sharing). */
  projectId?: string;
  sectionId?: string;
  serverError: string | null;
  taskId?: string;
  users: ShareableUser[];
}) {
  const isEdit = mode === "edit";
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);

  // Single-date model (A안, 2026-07-24): the form exposes ONE date, mapped to due_at on submit.
  // For edit, seed it from the task's anchor (due wins over legacy scheduled).
  const [date, setDate] = useState<string>(initial?.due || initial?.scheduled || defaultDate || "");
  const [time, setTime] = useState<string>(initial?.time ?? "");
  const [duration, setDuration] = useState<number>(initial?.duration ?? 0);
  const [repeat, setRepeat] = useState<string>(initial?.repeat ?? "");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [priority, setPriority] = useState<string>(initial?.priority ?? "normal");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [existingImgUrls, setExistingImgUrls] = useState<string[]>(initial?.imageUrls ?? []);
  const [shareIds, setShareIds] = useState<string[]>([]);
  /**
   * 지시로 보내기 — 켜면 대상자의 일정으로 잡히고 **내 오늘/내일/관리함에는 들어오지 않는다**.
   * 대상이 없으면 지시가 성립하지 않으므로 공유 대상을 고른 뒤에만 노출한다(서버도 같은 조건).
   */
  const [directive, setDirective] = useState(defaultDirective);
  const [linkedCtx, setLinkedCtx] = useState<LinkedContext | null>(initialCtx ?? null);
  const [ctxPickerOpen, setCtxPickerOpen] = useState(false);
  const [more, setMore] = useState(isEdit);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(serverError);
  const [isPending, startTransition] = useTransition();
  // 업로드 대기 중 표시용 — `isPending` 은 업로드 `await` 가 끝난 뒤 `startTransition` 이 불릴 때만
  // 켜져서, 그 사이(사진 있음 + 느린 회선)에 버튼이 살아 있어 두 번 눌릴 수 있었다.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── In-progress draft persistence ──────────────────────────────────────────
  // Tapping "예약 보기" navigates to the calendar (router.push) and a back-navigation remounts this
  // form fresh, wiping everything typed. We mirror the in-progress values into sessionStorage so a
  // round-trip (or any accidental leave) restores them. Cleared on a successful save and on an
  // explicit back-to-list. (New, not-yet-uploaded photos are File objects and can't be serialized,
  // so they are the one field a round-trip does not restore.)
  const draftKey = `taskDraft:${mode}:${taskId ?? "new"}`;
  const hydratedRef = useRef(false);
  const submittedRef = useRef(false);
  // 재진입(더블탭) 차단 전용 — `submittedRef` 는 초안 저장 억제 용도로 이미 쓰이고 있어 이름을
  // 나눈다. ref 는 리렌더 없이 즉시(동기) 반영되므로, `isPending`/`isSubmitting` 같은 state 로는
  // 못 막는 "같은 이벤트 루프 안의 연속 두 번째 탭"까지 막는다.
  const submitLockRef = useRef(false);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore storage errors (private mode / quota) */
    }
  }, [draftKey]);

  const persistDraft = useCallback(() => {
    if (typeof window === "undefined" || submittedRef.current) return;
    const form = formRef.current;
    const titleVal = (form?.elements.namedItem("title") as HTMLInputElement | null)?.value ?? "";
    const descVal =
      (form?.elements.namedItem("description") as HTMLTextAreaElement | null)?.value ?? "";
    const draft = {
      title: titleVal,
      description: descVal,
      date,
      time,
      duration,
      priority,
      repeat,
      tags,
      shareIds,
      directive,
      linkedCtx,
      more,
      existingImgUrls,
    };
    try {
      window.sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, date, time, duration, priority, repeat, tags, shareIds, directive, linkedCtx, more, existingImgUrls]);

  // Restore once on mount (before the persist effect can overwrite with initial state).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (typeof window === "undefined") return;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(draftKey);
    } catch {
      return;
    }
    if (!raw) return;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // malformed draft — ignore
    }
    // Uncontrolled inputs: restore their DOM value directly.
    const form = formRef.current;
    if (form) {
      const t = form.elements.namedItem("title") as HTMLInputElement | null;
      if (t && typeof d.title === "string") t.value = d.title;
      const ds = form.elements.namedItem("description") as HTMLTextAreaElement | null;
      if (ds && typeof d.description === "string") ds.value = d.description;
    }
    // State fields: applied in a microtask so setState is not called synchronously in the effect
    // body (react-hooks/set-state-in-effect), and still before paint so there is no flicker.
    queueMicrotask(() => {
      if (typeof d.date === "string") setDate(d.date);
      if (typeof d.time === "string") setTime(d.time);
      if (typeof d.duration === "number") setDuration(d.duration);
      if (typeof d.priority === "string") setPriority(d.priority);
      if (typeof d.repeat === "string") setRepeat(d.repeat);
      if (Array.isArray(d.tags)) setTags(d.tags.filter((x): x is string => typeof x === "string"));
      if (Array.isArray(d.shareIds))
        setShareIds(d.shareIds.filter((x): x is string => typeof x === "string"));
      // `?directive=1` 로 들어온 경우(보낸 지시 화면의 "지시 보내기")는 그 의도가 이긴다 —
      // 예전 초안이 토글을 꺼 버리면 사용자가 눈치채지 못한 채 평범한 공유로 나간다.
      // 초기값이 이미 true 면 초안의 false 를 무시하면 되므로, prop 대신 현재 상태로 판단한다
      // (effect 의존성에 prop 을 더하지 않아도 되고, 동작은 같다).
      if (typeof d.directive === "boolean") setDirective((cur) => cur || d.directive === true);
      if (d.linkedCtx === null || (d.linkedCtx && typeof d.linkedCtx === "object"))
        setLinkedCtx(d.linkedCtx as LinkedContext | null);
      if (typeof d.more === "boolean") setMore(d.more);
      if (Array.isArray(d.existingImgUrls))
        setExistingImgUrls(d.existingImgUrls.filter((x): x is string => typeof x === "string"));
    });
  }, [draftKey]);

  // Persist whenever a tracked value changes (after the initial restore has run).
  useEffect(() => {
    if (!hydratedRef.current) return;
    persistDraft();
  }, [persistDraft]);

  // `custom` is a recognized stored recurrence bucket but is NOT user-creatable in this slice
  // (no rule builder). It is surfaced read-only only when the task being edited already uses it,
  // so a legacy value is not silently lost and the selection never looks ambiguous.
  const hadCustom = initial?.repeat === "custom";

  function addTag() {
    const t = tagDraft.trim();
    if (!t || tags.includes(t) || tags.length >= 10) return;
    setTags((p) => [...p, t]);
    setTagDraft("");
  }

  const shareNames = users.filter((u) => shareIds.includes(u.id)).map((u) => u.name);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 동기 재진입 가드 — 사진 업로드 await 가 끝나기 전까지 `isPending` 이 켜지지 않아, 그 사이
    // 두 번째 탭이 여기까지 다시 들어올 수 있었다. ref 는 리렌더를 기다리지 않으므로 첫 두 탭도 막는다.
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);
    const form = formRef.current;
    if (!form) {
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }
    const formData = new FormData(form);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      setError(copy.errors.missing_title);
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }
    // A specific time / repeat needs a date anchor — block submission instead of silently dropping it.
    if (time && !date) {
      setError(copy.errors.time_needs_date);
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }
    if (repeat && !date) {
      setError(copy.errors.repeat_needs_date);
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }
    // Single-date model (A안): the one date maps to due_at; scheduled stays empty.
    formData.set("scheduledDate", "");
    formData.set("dueDate", date);
    formData.set("time", time);
    // Duration is a same-day time block; only meaningful with a time-of-day.
    formData.set("durationMinutes", time && duration > 0 ? String(duration) : "");
    formData.set("priority", priority);
    formData.set("repeat", repeat);
    formData.set("tagsJson", JSON.stringify(tags));
    formData.set("shareJson", JSON.stringify(shareIds));
    formData.set("directive", directive && shareIds.length > 0 ? "1" : "0");
    formData.set("ctxPropertyId", linkedCtx?.propertyId ?? "");
    formData.set("ctxRoomId", linkedCtx?.roomId ?? "");
    formData.set("ctxReservationId", linkedCtx?.reservationId ?? "");
    formData.set("ctxGuestName", linkedCtx?.guestName ?? "");

    if (isEdit) {
      formData.set("taskId", taskId ?? "");
      for (const url of existingImgUrls) formData.append("imageUrls", url);
      const newPhotos = uploaderRef.current?.getItems() ?? [];
      const newSlots = Math.max(0, maxImages - existingImgUrls.length);
      if (newPhotos.length > 0 && newSlots > 0) {
        const requestId = crypto.randomUUID();
        try {
          const { imageUrls } = await uploadRequestImages({
            items: newPhotos.slice(0, newSlots),
            organizationId,
            requestId,
            requestType: "task-images",
          });
          for (const url of imageUrls) formData.append("imageUrls", url);
        } catch {
          setError(copy.errors.save_failed);
          submitLockRef.current = false;
          setIsSubmitting(false);
          return;
        }
      }
      submittedRef.current = true;
      clearDraft();
      startTransition(async () => {
        await updateTaskCore(formData);
      });
      return;
    }

    const requestId = crypto.randomUUID();
    try {
      const photos = uploaderRef.current?.getItems() ?? [];
      const { imageUrls } = await uploadRequestImages({
        items: photos,
        organizationId,
        requestId,
        requestType: "task-images",
      });
      for (const url of imageUrls) formData.append("imageUrls", url);
    } catch {
      setError(copy.errors.save_failed);
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }
    submittedRef.current = true;
    clearDraft();
    startTransition(async () => {
      await createTask(formData);
    });
  }

  // "더 보기 — 시간 · 우선순위 …" → bold lead + muted hint (every locale uses an em-dash separator).
  const dashIdx = copy.moreToggle.indexOf("—");
  const moreLead = dashIdx === -1 ? copy.moreToggle : copy.moreToggle.slice(0, dashIdx).trim();
  const moreHint = dashIdx === -1 ? "" : copy.moreToggle.slice(dashIdx + 1).trim();

  const fmtDate = (ymd: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(ymd)
      ? new Intl.DateTimeFormat(locale, {
          month: "long",
          day: "numeric",
          weekday: "short",
          timeZone: "UTC",
        }).format(new Date(`${ymd}T00:00:00Z`))
      : "";
  const fmtTime = (hhmm: string) => {
    if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h >= 12 ? copy.pmLabel : copy.amLabel} ${h12}:${String(m).padStart(2, "0")}`;
  };
  const repeatSummary =
    repeat === "daily"
      ? copy.repeatDaily
      : repeat === "weekly"
        ? copy.repeatWeekly
        : repeat === "monthly"
          ? copy.repeatMonthly
          : repeat === "weekdays"
            ? copy.repeatWeekdays
            : repeat === "weekends"
              ? copy.repeatWeekends
              : repeat === "custom"
                ? copy.repeatCustom
                : repeat === "yearly"
                  ? copy.repeatYearly
                  : "";
  const durationSummary =
    duration === 15
      ? copy.duration15
      : duration === 30
        ? copy.duration30
        : duration === 60
          ? copy.duration60
          : duration === 120
            ? copy.duration120
            : duration > 0
              ? `${duration}${copy.durationMinUnit}`
              : "";

  return (
    <form className="tkw tkw-form" onSubmit={handleSubmit} ref={formRef}>
      {/* Project linkage — present only for project-task creation (hidden, read by createTask). */}
      {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
      {sectionId ? <input name="sectionId" type="hidden" value={sectionId} /> : null}
      {/* 머리 — 제목 + 오른쪽 저장(뒤로가기는 화면 스와이프). 화이트 리디자인(2026-10-15): 이름표 칸 · 칩. */}
      <div className="tkw-form__head">
        <h1>{headerTitle}</h1>
        <button className="tkw-btn is-pri" disabled={isPending || isSubmitting} type="submit">
          {copy.save}
        </button>
      </div>

      {error ? <p className="tkw-form__err">{error}</p> : null}

      <label className="tkw-nf">
        <span className="tkw-nf__l">{copy.titlePlaceholder}</span>
        <input
          autoComplete="off"
          className="tkw-nf__in is-title"
          defaultValue={initial?.title ?? defaultTitle ?? ""}
          name="title"
          onInput={persistDraft}
          required
        />
      </label>
      <label className="tkw-nf">
        <span className="tkw-nf__l">{copy.descPlaceholder}</span>
        <textarea
          className="tkw-nf__in is-ta"
          defaultValue={initial?.description ?? ""}
          name="description"
          onInput={persistDraft}
          rows={2}
        />
      </label>

      {/* Schedule — one date + time + repeat, all in a single Todoist-style sheet. */}
      <span className="tkw-nf">
        <span className="tkw-nf__l">{copy.scheduleTitle}</span>
        <button className="tkw-nf__in" onClick={() => setScheduleOpen(true)} type="button">
          <CalendarDays aria-hidden="true" style={date ? { color: "#7a52e6" } : undefined} />
          {date ? (
            <span className="tkw-nf__v">
              {fmtDate(date)}
              {time || repeat ? (
                <small>
                  {[time ? `${fmtTime(time)}${durationSummary ? ` · ${durationSummary}` : ""}` : null, repeat ? `↻ ${repeatSummary}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              ) : null}
            </span>
          ) : (
            <span className="tkw-nf__v is-ph">{copy.scheduleEmpty}</span>
          )}
          {date ? (
            <span
              aria-label={copy.clearDate}
              className="tkw-nf__x"
              onClick={(e) => {
                e.stopPropagation();
                setDate("");
                setTime("");
                setDuration(0);
                setRepeat("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setDate("");
                  setTime("");
                  setDuration(0);
                  setRepeat("");
                }
              }}
              role="button"
              tabIndex={0}
            >
              <X aria-hidden="true" />
            </span>
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </button>
      </span>

      {/* Share — creation only; hidden for project tasks (sharing is governed by the project). */}
      {!isEdit && !projectId ? (
        <div className="tkw-fsec">
          <span className="tkw-nf">
            <span className="tkw-nf__l">{copy.sectionShare}</span>
            <button className="tkw-nf__in" onClick={() => setPickerOpen(true)} type="button">
              {shareIds.length ? (
                <Users aria-hidden="true" style={{ color: "#7a52e6" }} />
              ) : (
                <Share2 aria-hidden="true" />
              )}
              <span className={cn("tkw-nf__v", !shareNames.length && "is-ph")}>
                {shareNames.length ? shareNames.join(", ") : copy.sharePrivate}
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </span>
          {/* 지시 토글 — 대상을 고른 뒤에만 뜬다. 공유(동료끼리 같이 봄)와 지시(대상자가 수행)는
              다른 행위라 한 화면에서 분명히 갈라 준다. */}
          {shareIds.length ? (
            <button
              aria-checked={directive}
              className="tkw-swrow"
              onClick={() => setDirective((v) => !v)}
              role="switch"
              type="button"
            >
              <Megaphone aria-hidden="true" className="size-[18px] shrink-0" style={{ color: directive ? "#7a52e6" : "#8b8898" }} />
              <span className="tkw-swrow__b">
                <b>{copy.sendAsDirective}</b>
                <span>{copy.sendAsDirectiveSub}</span>
              </span>
              <span aria-hidden="true" className="tkw-sw__t" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Context link — optional; not available in quick-add, only detailed create/edit. */}
      <ContextLinkSection
        buildingLabels={buildingLabels}
        copy={copy}
        locale={locale}
        onClear={() => setLinkedCtx(null)}
        onOpenPicker={() => setCtxPickerOpen(true)}
        value={linkedCtx}
      />

      {/* More — collapsible advanced section (priority / tags / photos). */}
      <button aria-expanded={more} className="tkw-moretog" onClick={() => setMore((v) => !v)} type="button">
        <ChevronDown aria-hidden="true" />
        {moreLead}
        {moreHint ? <span>— {moreHint}</span> : null}
      </button>

      {more ? (
        <>
          <div className="tkw-fsec">
            <span className="tkw-fsec__l">{copy.sectionPriority}</span>
            <div className="tkw-chips" role="radiogroup" aria-label={copy.sectionPriority}>
              {PRIOS.map((p) => (
                <button
                  aria-checked={priority === p}
                  className={cn("tkw-chip", priority === p && "is-on")}
                  key={p}
                  onClick={() => setPriority(p)}
                  role="radio"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn("tkw-pdot", p === "urgent" ? "is-u" : p === "important" ? "is-i" : p === "medium" ? "is-m" : "")}
                  />
                  {p === "urgent"
                    ? copy.prioUrgent
                    : p === "important"
                      ? copy.prioImportant
                      : p === "medium"
                        ? copy.prioMedium
                        : copy.prioNormal}
                </button>
              ))}
            </div>
          </div>
          <div className="tkw-fsec">
            <span className="tkw-fsec__l">
              {copy.sectionTags} <small>{copy.tagsMax}</small>
            </span>
            {tags.length ? (
              <div className="tkw-chips">
                {tags.map((tg) => (
                  <button
                    aria-label={`#${tg} · ${imgCopy.remove}`}
                    className="tkw-chip is-on"
                    key={tg}
                    onClick={() => setTags((p) => p.filter((x) => x !== tg))}
                    type="button"
                  >
                    #{tg}
                    <X aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="tkw-tagin">
              <input
                aria-label={copy.tagPlaceholder}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={copy.tagPlaceholder}
                value={tagDraft}
              />
              <button onClick={addTag} type="button">
                {copy.addTag}
              </button>
            </div>
          </div>
          <div className="tkw-fsec">
            <span className="tkw-fsec__l">
              {copy.sectionPhotos} <small>{maxImages === 20 ? copy.photosMax20 : copy.photosMax}</small>
            </span>
            {isEdit && existingImgUrls.length > 0 ? (
              <div className="tkw-imgs">
                {existingImgUrls.map((url, i) => (
                  <div className="tkw-imgs__t" key={i}>
                    <Image alt="" aria-hidden="true" className="object-cover" fill sizes="76px" src={url} />
                    <button
                      aria-label={imgCopy.remove}
                      className="tkw-imgs__x"
                      onClick={() => setExistingImgUrls((p) => p.filter((_, j) => j !== i))}
                      type="button"
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {existingImgUrls.length < maxImages ? (
              <div className="tkw-uploader">
                <AnnouncementImageUploader
                  addImagesLabel={imgCopy.addPhotos}
                  errorCountExceeded={maxImages === 20 ? copy.photosCountError20 : imgCopy.errorCount}
                  errorSizeExceeded={imgCopy.errorSize}
                  errorTypeInvalid={imgCopy.errorType}
                  imageAttachmentsLabel={imgCopy.attachments}
                  imageLimitLabel={maxImages === 20 ? copy.photosMax20 : imgCopy.limit}
                  imageRemoveLabel={imgCopy.remove}
                  maxImages={maxImages}
                  ref={uploaderRef}
                />
              </div>
            ) : (
              <p className="tkw-hint">{maxImages === 20 ? copy.photosMax20 : copy.photosMax}</p>
            )}
          </div>
        </>
      ) : null}

      {scheduleOpen ? (
        <TaskSchedulePicker
          copy={copy}
          hadCustom={hadCustom}
          initialDate={date}
          initialDuration={duration}
          initialRepeat={repeat}
          initialTime={time}
          locale={locale}
          onApply={(v) => {
            setDate(v.date);
            setTime(v.time);
            setDuration(v.duration);
            setRepeat(v.repeat);
            setScheduleOpen(false);
          }}
        />
      ) : null}

      {pickerOpen ? (
        <SharePicker
          copy={copy}
          initialSelected={shareIds}
          onApply={(ids) => {
            setShareIds(ids);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
          users={users}
        />
      ) : null}

      {ctxPickerOpen ? (
        <ContextPickerSheet
          buildingLabels={buildingLabels}
          copy={copy}
          initialPropertyName={linkedCtx?.propertyName ?? undefined}
          onClose={() => setCtxPickerOpen(false)}
          onSelect={(ctx) => {
            setLinkedCtx(ctx);
            setCtxPickerOpen(false);
          }}
        />
      ) : null}
    </form>
  );
}
