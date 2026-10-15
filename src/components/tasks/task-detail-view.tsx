"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageIcon, Pencil, Plus, Send, SkipForward, Trash2, UserMinus, UserPlus } from "lucide-react";
import {
  addTaskUpdate,
  completeTask,
  deleteTask,
  removeTaskParticipant,
  reopenTask,
  setTaskProgress,
  shareTaskWithUsers,
  skipOccurrenceOn,
} from "@/app/mobile/tasks/[id]/actions";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import { calendarHref } from "@/components/tasks/linked-context-block";
import { PhotoGallery } from "@/components/tasks/photo-gallery";
import { SharePicker } from "@/components/tasks/share-picker";
import { addMinutesHHMM, CheckMark, contextLabelOf, prioRingClass } from "@/components/tasks/task-card";
import { haptic } from "@/lib/haptics";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { ShareableUser, TaskDetail } from "@/lib/tasks";
import { formatCustomWeekdays, isStandardRecurrence } from "@/lib/tasks-recurrence";
import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tokyo-date";
import { cn } from "@/lib/utils";
import "./tasks-white.css";

type Copy = Dictionary["tasks"];

function longDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}
function clockTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}
/** "M/D HH:MM"(도쿄) — 업데이트 기록의 짧은 시각. 로케일 숫자 표기("7. 29. 15:10")보다 읽기 쉽다. */
function shortDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
function repeatLabel(rule: string, copy: Copy, locale: Locale): string {
  // 사용자 지정 요일 반복(`custom:1,3,5`)은 고정 매핑에 없으므로 먼저 처리한다 — 빠뜨리면
  // 어드민에서 만든 반복이 여기서 원문 그대로("custom:1,3,5") 노출된다.
  const customDays = formatCustomWeekdays(rule, locale);
  if (customDays) return copy.repeatWeeklyOn.replace("{w}", customDays);
  const map: Record<string, string> = {
    daily: copy.repeatDaily,
    weekly: copy.repeatWeekly,
    monthly: copy.repeatMonthly,
    weekdays: copy.repeatWeekdays,
    weekends: copy.repeatWeekends,
    yearly: copy.repeatYearly,
    custom: copy.repeatCustom,
  };
  return map[rule] ?? rule;
}
function durationText(mins: number, copy: Copy): string {
  return mins === 15
    ? copy.duration15
    : mins === 30
      ? copy.duration30
      : mins === 60
        ? copy.duration60
        : mins === 120
          ? copy.duration120
          : `${mins}${copy.durationMinUnit}`;
}
function prioLabel(p: string, copy: Copy): string {
  return p === "urgent"
    ? copy.prioUrgent
    : p === "important"
      ? copy.prioImportant
      : p === "medium"
        ? copy.prioMedium
        : copy.prioNormal;
}

/**
 * 투두 상세 — 화이트 리디자인(2026-10-15, 시안 TodoDetail-Phone).
 *
 * 상자 없이 위에서 아래로: 빵부스러기(「오늘 · 투두이스트」 + 수정 · 삭제) → 큰 고리 + 제목 → 설명 → 상태 세그먼트
 * 「대기 | 진행 중 | 완료」 → 사진 줄(+ 추가 · 「사진 n / 5」) → 정보 목록(일정 · 반복 · 우선순위 · 연결 · 태그 · 함께) →
 * 업데이트 기록 + 입력.
 *
 * 상태 세그먼트는 예전 동작에 그대로 붙는다: 대기/진행 중 = `setTaskProgress`, 완료 = `completeTask`(반복은 그 회차),
 * 완료 상태에서 대기 = `reopenTask`, 진행 중 = 되살린 뒤 `setTaskProgress(true)`. 반복인데 회차를 모르면(관리함에서 연
 * 시리즈) 완료 칸을 막고 안내를 보여 준다 — 앵커로 조용히 폴백하지 않는다.
 */
export function TaskDetailView({
  buildingLabels,
  canEditCore,
  completedOccurrenceDate,
  copy,
  crumbView,
  currentUserId,
  imgCopy,
  locale,
  occurrenceDate,
  returnView,
  task,
  users,
}: {
  buildingLabels: Record<string, string>;
  canEditCore: boolean;
  /** 이 회차가 "완료"로 기록돼 있을 때만 그 날짜(해결 여부와 무관한 `occurrenceDate`와 짝을 이룸). */
  completedOccurrenceDate: string | null;
  copy: Copy;
  /** 빵부스러기에 쓸 목록 이름(어느 탭에서 열었나). 모르면 「투두이스트」만. */
  crumbView?: string | null;
  currentUserId: string;
  imgCopy: Dictionary["requestImages"];
  locale: Locale;
  occurrenceDate: string | null;
  returnView: "today" | "tomorrow" | "calendar";
  task: TaskDetail;
  users: ShareableUser[];
}) {
  const router = useRouter();
  const w = copy.mobileWhite;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  const [updatePhotosOpen, setUpdatePhotosOpen] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [isUpdating, startUpdateTransition] = useTransition();
  const [isTogglingStatus, startStatusTransition] = useTransition();
  const [isSkippingOccurrence, startSkipTransition] = useTransition();
  // 누른 상태를 서버 응답 전에 먼저 보여 준다(세그먼트가 미끄러지듯 옮겨 감). 응답이 오면 실제 값으로 맞춰진다.
  const [pendingStatus, setPendingStatus] = useState<"open" | "in_progress" | "done" | null>(null);
  const updateBodyRef = useRef<HTMLInputElement>(null);
  const updateUploaderRef = useRef<AnnouncementImageUploaderHandle>(null);
  const shareFormRef = useRef<HTMLFormElement>(null);
  const shareInputRef = useRef<HTMLInputElement>(null);

  const isRecurring = isStandardRecurrence(task.recurrenceRule);
  // 반복 업무는 행 `status` 가 영원히 "open"(2026-07-30 회차 모델) 이라 완료 여부는 그 회차의 기록을
  // 본다. 일회성은 기존대로 행 status.
  const done = isRecurring ? !!completedOccurrenceDate : task.status === "completed";
  // 완료/되돌리기가 대상으로 삼을 회차 날짜. 열려 있으면 `occurrenceDate`, 이미 완료면
  // `completedOccurrenceDate` — 상세 페이지가 어느 한쪽만 채워서 내려준다.
  const actionOccurrenceDate = occurrenceDate ?? completedOccurrenceDate ?? undefined;
  // 상세가 회차 컨텍스트 없이(관리함의 시리즈 행 등, `?occurrence=` 없이) 열린 반복 업무는 어느
  // 날짜를 완료하는지 알 수 없어 앵커로 폴백해 버리면 사용자가 모르는 과거 회차가 완료돼 버린다
  // (수정 2). 그 경우 완료 칸 대신 안내만 보여준다.
  const hasOccurrenceContext = !isRecurring || !!occurrenceDate || !!completedOccurrenceDate;
  const existingParticipantIds = task.participants.map((p) => p.userId);
  const shareableForMore = users.filter((u) => !existingParticipantIds.includes(u.id));
  const canChooseRecurringDelete = !!occurrenceDate && isStandardRecurrence(task.recurrenceRule);
  const serverStatus: "open" | "in_progress" | "done" = done
    ? "done"
    : task.status === "in_progress"
      ? "in_progress"
      : "open";
  const shownStatus = pendingStatus ?? serverStatus;

  // 서버 왕복이 끝나면(새 props 와 함께) 낙관적 표시를 내려놓는다 — 실패해도 실제 값으로 돌아온다.
  useEffect(() => {
    if (isTogglingStatus) return;
    const id = requestAnimationFrame(() => setPendingStatus(null));
    return () => cancelAnimationFrame(id);
  }, [serverStatus, isTogglingStatus]);

  function skipCurrentOccurrence() {
    if (!occurrenceDate || isSkippingOccurrence) return;
    setConfirmDelete(false);
    startSkipTransition(async () => {
      await skipOccurrenceOn(task.id, occurrenceDate);
      const params = new URLSearchParams({
        view: returnView,
        skippedTask: task.id,
        skippedDate: occurrenceDate,
      });
      router.replace(`/mobile/tasks?${params.toString()}`);
    });
  }

  function changeStatus(next: "open" | "in_progress" | "done") {
    if (next === shownStatus || isTogglingStatus) return;
    if (next === "done" && !hasOccurrenceContext) return;
    haptic(next === "done" ? "success" : "light");
    setPendingStatus(next);
    startStatusTransition(async () => {
      if (next === "done") {
        await completeTask(task.id, actionOccurrenceDate);
        return;
      }
      if (done) {
        await reopenTask(task.id, actionOccurrenceDate);
        if (next === "in_progress") await setTaskProgress(task.id, true);
        return;
      }
      await setTaskProgress(task.id, next === "in_progress");
    });
  }

  function submitShare(ids: string[]) {
    setPickerOpen(false);
    if (shareInputRef.current && shareFormRef.current) {
      shareInputRef.current.value = JSON.stringify(ids);
      shareFormRef.current.requestSubmit();
    }
  }

  async function handleUpdateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUpdateError(null);
    const body = updateBodyRef.current?.value.trim() ?? "";
    const photos = updateUploaderRef.current?.getItems() ?? [];
    if (!body && photos.length === 0) return;

    const formData = new FormData();
    formData.set("taskId", task.id);
    formData.set("body", body);

    if (photos.length > 0) {
      try {
        const { imageUrls } = await uploadRequestImages({
          items: photos,
          organizationId: task.organizationId,
          requestId: crypto.randomUUID(),
          requestType: "task-update-images",
        });
        for (const url of imageUrls) formData.append("imageUrls", url);
      } catch {
        // Surface the failure instead of swallowing it: keep the typed text and the
        // selected photos in place so the user can retry. Nothing is submitted.
        setUpdateError(copy.errors.upload_failed);
        return;
      }
    }

    if (updateBodyRef.current) updateBodyRef.current.value = "";
    setUpdatePhotosOpen(false);
    haptic("light");
    startUpdateTransition(async () => {
      await addTaskUpdate(formData);
    });
  }

  // ── 정보 목록 ────────────────────────────────────────────────────────────────
  const today = tokyoToday();
  const anchor = tokyoDateOf(task.dueAt) ?? task.scheduledDate ?? null;
  const dateWord = (ymd: string) =>
    ymd === today ? copy.todayLabel : ymd === ymdShift(today, 1) ? copy.viewTomorrow : longDate(ymd, locale);
  const scheduleText = (() => {
    const parts: string[] = [];
    // 반복 회차로 열었으면 그 회차 날짜가 「일정」이다(앵커는 반복의 시작점일 뿐).
    const day = actionOccurrenceDate ?? anchor;
    if (day) parts.push(dateWord(day));
    if (task.timeLabel)
      parts.push(
        task.durationMinutes
          ? `${task.timeLabel} – ${addMinutesHHMM(task.timeLabel, task.durationMinutes)}`
          : task.timeLabel,
      );
    else if (day) parts.push(copy.allDay);
    const head = parts.join(" ");
    return task.timeLabel && task.durationMinutes ? `${head} · ${durationText(task.durationMinutes, copy)}` : head;
  })();
  const ctxLabel = contextLabelOf(task, buildingLabels, copy.contextPickerRoomSuffix);
  const ctx = task.resolvedContext;
  const resHref = ctx ? calendarHref(ctx) : null;
  const ctxText = ctx
    ? [ctxLabel, ctx.guestName && ctx.guestName !== ctxLabel ? ctx.guestName : null].filter(Boolean).join(" · ")
    : "";
  const maxPhotos = task.projectId ? 20 : 5;
  const crumb = crumbView ? `${crumbView} · ${copy.title}` : copy.title;

  return (
    <div className="tkw tkw-d">
      {/* 빵부스러기 + 수정 · 삭제 */}
      <div className="tkw-d__crumb">
        <span>{crumb}</span>
        {canEditCore ? (
          <>
            <Link aria-label={copy.editTask} className="tkw-icon" href={`/mobile/tasks/${task.id}/edit`}>
              <Pencil aria-hidden="true" />
            </Link>
            <button
              aria-label={copy.deleteAction}
              className="tkw-icon is-red"
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      {/* 큰 고리 + 제목 — 고리를 누르면 완료/되돌리기(상태 세그먼트의 완료와 같은 동작). */}
      <div className="tkw-d__title">
        {hasOccurrenceContext ? (
          <button
            aria-label={done ? copy.reopen : copy.complete}
            className={cn(
              "tkw-ck",
              prioRingClass(task.priority),
              shownStatus === "done" && (done ? "is-done" : "is-checking"),
            )}
            disabled={isTogglingStatus}
            onClick={() => changeStatus(shownStatus === "done" ? "open" : "done")}
            type="button"
          >
            <CheckMark />
          </button>
        ) : (
          <span aria-hidden="true" className={cn("tkw-ck is-static", prioRingClass(task.priority))} />
        )}
        <h1 className={cn(shownStatus === "done" && "is-done")}>{task.title}</h1>
      </div>

      {task.description ? <p className="tkw-d__desc">{task.description}</p> : null}
      {!canEditCore ? <p className="tkw-d__note">{copy.coreEditHint.replace("{name}", task.authorName)}</p> : null}

      {/* 상태 — 대기 | 진행 중 | 완료 */}
      <div aria-label={w.status} className="tkw-seg is-full" role="radiogroup">
        {(
          [
            ["open", copy.statusOpen],
            ["in_progress", copy.statusInProgress],
            ["done", copy.statusCompleted],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-checked={shownStatus === key}
            className={cn(shownStatus === key && "is-on")}
            disabled={isTogglingStatus || (key === "done" && !hasOccurrenceContext)}
            key={key}
            onClick={() => changeStatus(key)}
            role="radio"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {!hasOccurrenceContext ? <p className="tkw-d__note">{copy.completeNeedsOccurrence}</p> : null}

      {/* 사진 — 작업 사진은 수정 화면에서 붙인다(+ 칸이 그리로 간다). */}
      {task.imageUrls.length > 0 || canEditCore ? (
        <div className="tkw-ph">
          {task.imageUrls.map((url, i) => (
            <button
              aria-label={`${imgCopy.attachments} ${i + 1}`}
              className="tkw-imgs__t"
              key={`${url}-${i}`}
              onClick={() => setLightbox(i)}
              style={{ width: 64, height: 64 }}
              type="button"
            >
              <Image alt="" className="object-cover" fill sizes="64px" src={url} />
            </button>
          ))}
          {canEditCore && task.imageUrls.length < maxPhotos ? (
            <Link aria-label={w.addPhoto} className="tkw-ph__add" href={`/mobile/tasks/${task.id}/edit`}>
              <Plus aria-hidden="true" />
            </Link>
          ) : null}
          <span className="tkw-ph__n">
            {w.photoCount.replace("{n}", String(task.imageUrls.length)).replace("{max}", String(maxPhotos))}
          </span>
          <ImageLightbox
            closeLabel={copy.cancel}
            onClose={() => setLightbox(null)}
            openIndex={lightbox}
            urls={task.imageUrls}
          />
        </div>
      ) : null}

      <dl className="tkw-dl">
        <dt>{copy.scheduleTitle}</dt>
        <dd className={cn(!scheduleText && "is-muted")}>{scheduleText || copy.scheduleEmpty}</dd>
        {task.recurrenceRule ? (
          <>
            <dt>{copy.sectionRepeat}</dt>
            <dd>↻ {repeatLabel(task.recurrenceRule, copy, locale)}</dd>
          </>
        ) : null}
        <dt>{copy.sectionPriority}</dt>
        <dd>
          <span aria-hidden="true" className={cn("tkw-pdot", prioRingClass(task.priority))} />
          {prioLabel(task.priority, copy)}
        </dd>
        {ctx ? (
          <>
            <dt>{w.linked}</dt>
            <dd>
              {ctxText || "—"}
              {resHref ? (
                <>
                  {" "}
                  <Link href={resHref}>{w.reservation}</Link>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {task.tags.length ? (
          <>
            <dt>{copy.sectionTags}</dt>
            <dd className="is-muted">{task.tags.map((tg) => `#${tg}`).join(" ")}</dd>
          </>
        ) : null}
        {/* 함께 — 공유 중이면 사람들(누르면 참여자 시트), 개인이면 「공유하기」. 프로젝트 작업의 공유는 프로젝트
            멤버십이 정한다 — 서버가 거부하므로(`shareTaskWithUsers`) 진입점을 숨긴다. */}
        {task.isShared ? (
          <>
            <dt>{w.with}</dt>
            <dd>
              <button className="tkw-with" onClick={() => setPeopleOpen(true)} type="button">
                <span className="tkw-avs">
                  {task.participants.slice(0, 4).map((p) => (
                    <span className="tkw-av" key={p.userId}>
                      {p.name.slice(0, 1)}
                    </span>
                  ))}
                </span>
                <span>{task.participants.map((p) => p.name).join(" · ")}</span>
              </button>
            </dd>
          </>
        ) : !task.projectId ? (
          <>
            <dt>{w.with}</dt>
            <dd>
              <button className="tkw-link" onClick={() => setPickerOpen(true)} type="button">
                {w.share}
              </button>
            </dd>
          </>
        ) : null}
      </dl>

      {/* 업데이트 기록 */}
      <div className="tkw-up">
        <b>{copy.updateLog}</b>
        {task.updates.length === 0 ? <p className="tkw-up__empty">{copy.noUpdates}</p> : null}
        {task.updates.map((u) =>
          u.type === "note" ? (
            <div className="tkw-up__note" key={u.id}>
              <span aria-hidden="true" className="tkw-av">
                {u.byName.slice(0, 1)}
              </span>
              <span>
                <b>{u.byName}</b>
                <time dateTime={u.createdAt}>
                  {tokyoDateOf(u.createdAt) === today ? clockTime(u.createdAt, locale) : shortDateTime(u.createdAt)}
                </time>
                {u.body ? <p>{u.body}</p> : null}
                {u.imageUrls.length ? (
                  <PhotoGallery closeLabel={copy.cancel} size="sm" title={imgCopy.attachments} urls={u.imageUrls} />
                ) : null}
              </span>
            </div>
          ) : (
            <div className="tkw-up__sys" key={u.id}>
              {systemLabel(u.type, u.body, copy)}
              {u.byName ? ` · ${u.byName}` : ""} · {shortDateTime(u.createdAt)}
            </div>
          ),
        )}
        {updatePhotosOpen ? (
          <div className="tkw-up__photos">
            <AnnouncementImageUploader
              addImagesLabel={imgCopy.addPhotos}
              errorCountExceeded={imgCopy.errorCount}
              errorSizeExceeded={imgCopy.errorSize}
              errorTypeInvalid={imgCopy.errorType}
              imageAttachmentsLabel={imgCopy.attachments}
              imageLimitLabel={imgCopy.limit}
              imageRemoveLabel={imgCopy.remove}
              ref={updateUploaderRef}
            />
          </div>
        ) : null}
        <form className="tkw-up__form" onSubmit={handleUpdateSubmit}>
          <button
            aria-label={copy.sectionPhotos}
            aria-pressed={updatePhotosOpen}
            className={cn("tkw-up__ib", updatePhotosOpen && "is-on")}
            onClick={() => setUpdatePhotosOpen((v) => !v)}
            type="button"
          >
            <ImageIcon aria-hidden="true" />
          </button>
          <input
            aria-label={copy.updatePlaceholder}
            enterKeyHint="send"
            placeholder={copy.updatePlaceholder}
            ref={updateBodyRef}
          />
          <button aria-label={copy.updateLog} className="tkw-up__ib is-send" disabled={isUpdating} type="submit">
            <Send aria-hidden="true" />
          </button>
        </form>
        {updateError ? (
          <p className="tkw-err" role="alert">
            {updateError}
          </p>
        ) : null}
      </div>

      {/* Hidden share-more form (submitted by the picker) */}
      <form action={shareTaskWithUsers} className="hidden" ref={shareFormRef}>
        <input name="taskId" type="hidden" value={task.id} />
        <input defaultValue="[]" name="shareJson" ref={shareInputRef} type="hidden" />
      </form>

      {pickerOpen ? (
        <SharePicker
          copy={copy}
          initialSelected={[]}
          onApply={submitShare}
          onClose={() => setPickerOpen(false)}
          users={shareableForMore}
        />
      ) : null}

      {/* 참여자 — 함께 줄을 누르면. 더 부르기는 참여자에게도 열려 있고(Re-sharing), 남을 빼는 것만 작성자 전용. */}
      {peopleOpen ? (
        <BottomSheet ariaLabel={copy.participants} onClose={() => setPeopleOpen(false)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>
                {copy.participants}{" "}
                <span className="tkw-sec__n">
                  {copy.participantsCommon.replace("{count}", String(task.participants.length))}
                </span>
              </h2>
              <div className="tkw-people">
                {task.participants.map((p) => (
                  <div key={p.userId}>
                    <span aria-hidden="true" className="tkw-av">
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="tkw-people__n">
                      {p.name}
                      {p.userId === currentUserId ? copy.meSuffix : ""}
                    </span>
                    {p.role === "author" ? (
                      <span className="tkw-people__r">{copy.roleAuthor}</span>
                    ) : p.isFirstRecipient ? (
                      <span className="tkw-people__r">{copy.roleFirstRecipient}</span>
                    ) : null}
                    {canEditCore && p.role !== "author" && p.userId !== currentUserId ? (
                      <button
                        aria-label={copy.removeParticipant}
                        className="tkw-people__x"
                        onClick={() => {
                          close();
                          setConfirmRemove({ userId: p.userId, name: p.name });
                        }}
                        type="button"
                      >
                        <UserMinus aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="tkw-act" style={{ marginTop: 8 }}>
                <button
                  onClick={() => {
                    close();
                    setPickerOpen(true);
                  }}
                  type="button"
                >
                  <UserPlus aria-hidden="true" />
                  {copy.shareMore}
                </button>
                <button
                  className="is-red"
                  onClick={() => {
                    close();
                    setConfirmLeave(true);
                  }}
                  type="button"
                >
                  <UserMinus aria-hidden="true" />
                  {canEditCore ? copy.leaveWarnAuthor : copy.leaveSelf}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {confirmDelete && canChooseRecurringDelete && occurrenceDate ? (
        <BottomSheet ariaLabel={copy.recurDeleteTitle} onClose={() => setConfirmDelete(false)}>
          <div className="tkw-sheet">
            <p className="tkw-sheet__t">↻ {repeatLabel(task.recurrenceRule ?? "", copy, locale)}</p>
            <h2>{copy.recurDeleteTitle}</h2>
            <div className="tkw-act">
              <button disabled={isSkippingOccurrence} onClick={skipCurrentOccurrence} type="button">
                <SkipForward aria-hidden="true" />
                <span>
                  {copy.recurSkipOne.replace("{date}", longDate(occurrenceDate, locale))}
                  <span className="tkw-act__s">{copy.recurSkipOneSub}</span>
                </span>
              </button>
            </div>
            <form action={deleteTask} className="tkw-act">
              <input name="taskId" type="hidden" value={task.id} />
              <button className="is-red" onClick={() => haptic("warning")} style={{ borderTop: "1px solid #f3f3f6" }} type="submit">
                <Trash2 aria-hidden="true" />
                <span>
                  {copy.recurDeleteAll}
                  <span className="tkw-act__s">{copy.recurDeleteAllSub}</span>
                </span>
              </button>
            </form>
          </div>
        </BottomSheet>
      ) : null}

      {confirmDelete && !canChooseRecurringDelete ? (
        <BottomSheet ariaLabel={copy.deleteConfirmTitle} onClose={() => setConfirmDelete(false)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>{copy.deleteConfirmTitle}</h2>
              <p className="tkw-sheet__sub">{copy.deleteConfirmBody}</p>
              <div className="tkw-btns2">
                <button className="tkw-btn is-gray" onClick={close} type="button">
                  {copy.cancel}
                </button>
                <form action={deleteTask}>
                  <input name="taskId" type="hidden" value={task.id} />
                  <button className="tkw-btn is-red" onClick={() => haptic("warning")} type="submit">
                    {copy.confirm}
                  </button>
                </form>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {confirmLeave ? (
        <BottomSheet
          ariaLabel={canEditCore ? copy.leaveAuthorConfirmTitle : copy.leaveConfirmTitle}
          onClose={() => setConfirmLeave(false)}
        >
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>{canEditCore ? copy.leaveAuthorConfirmTitle : copy.leaveConfirmTitle}</h2>
              <p className="tkw-sheet__sub">{canEditCore ? copy.leaveAuthorConfirmBody : copy.leaveConfirmBody}</p>
              <div className="tkw-btns2">
                <button className="tkw-btn is-gray" onClick={close} type="button">
                  {copy.cancel}
                </button>
                <form action={removeTaskParticipant}>
                  <input name="taskId" type="hidden" value={task.id} />
                  <input name="userId" type="hidden" value={currentUserId} />
                  <button className="tkw-btn is-red" type="submit">
                    {copy.confirm}
                  </button>
                </form>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {confirmRemove ? (
        <BottomSheet
          ariaLabel={copy.removeParticipantConfirmTitle.replace("{name}", confirmRemove.name)}
          onClose={() => setConfirmRemove(null)}
        >
          {({ close }) => (
            <div className="tkw-sheet">
              <h2>{copy.removeParticipantConfirmTitle.replace("{name}", confirmRemove.name)}</h2>
              <p className="tkw-sheet__sub">{copy.removeParticipantConfirmBody.replace("{name}", confirmRemove.name)}</p>
              <div className="tkw-btns2">
                <button className="tkw-btn is-gray" onClick={close} type="button">
                  {copy.cancel}
                </button>
                <form action={removeTaskParticipant}>
                  <input name="taskId" type="hidden" value={task.id} />
                  <input name="userId" type="hidden" value={confirmRemove.userId} />
                  <button className="tkw-btn is-pri" type="submit">
                    {copy.confirm}
                  </button>
                </form>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}

function systemLabel(type: string, body: string | null, copy: Copy): string {
  switch (type) {
    case "system_shared":
      return copy.logShared;
    case "system_edited":
      return copy.editTask;
    case "completed":
      return copy.statusCompleted;
    case "reopened":
      return copy.reopen;
    case "status_changed":
      return body === "in_progress" ? copy.statusInProgress : copy.statusOpen;
    default:
      return type;
  }
}
