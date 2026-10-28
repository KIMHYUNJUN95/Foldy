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

/**
 * 서버 액션이 `redirect()` 로 끝나면 클라이언트의 액션 프로미스는 NEXT_REDIRECT 에러로 거절된다
 * (digest = `NEXT_REDIRECT;{type};{url};{status};`). 그 대상 URL — 리다이렉트가 아니면 null.
 */
function redirectTargetOf(e: unknown): string | null {
  const digest =
    typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
  if (!digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? "";
}

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

// 수정 모드의 컨텍스트 링크 초기 상태 — 업무의 해석된 컨텍스트에서 만든다.
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
  // 페이지 헤더는 폼이 소유하므로 오른쪽 위 저장이 네이티브 submit 이 될 수 있다(`isPending` 유지).
  buildingLabels: Record<string, string>;
  copy: Copy;
  defaultDate: string | null;
  /** 지시 모드로 폼을 연다(모바일 "보낸 지시" 진입점). 대상을 고르면 토글이 켜진 채로 보인다. */
  defaultDirective?: boolean;
  locale: string;
  // 빠른 추가(Quick Add)에서 넘어온 미리 채운 제목(생성 모드만). 캘린더 날짜 미리 채우기(`defaultDate`)가
  // 계속 동작하도록 `initial` 과 따로 둔다.
  defaultTitle?: string;
  headerTitle: string;
  imgCopy: Dictionary["requestImages"];
  initial?: TaskInitial;
  /** 수정 모드용으로 미리 채운 컨텍스트 링크(업무의 해석된 컨텍스트에서). */
  initialCtx?: TaskInitialCtx | null;
  /** 첨부할 수 있는 최대 사진 수. 기본 5장; 프로젝트 업무는 20장으로 늘린다. */
  maxImages?: number;
  mode?: "create" | "edit";
  organizationId: string;
  /** 설정되면 프로젝트 업무다 — project_id(+ 선택 section_id)와 함께 저장되고
   *  업무별 공유 섹션은 숨긴다(프로젝트 멤버십이 공유를 결정). */
  projectId?: string;
  sectionId?: string;
  serverError: string | null;
  taskId?: string;
  users: ShareableUser[];
}) {
  const isEdit = mode === "edit";
  const formRef = useRef<HTMLFormElement>(null);
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);

  // 단일 날짜 모델(A안, 2026-07-24): 폼은 날짜를 하나만 노출하고 제출 때 due_at 에 매핑한다.
  // 수정할 때는 업무의 기준점에서 채운다(due 가 예전 scheduled 보다 우선).
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
  // 서버가 `?error=` 로 돌려보낸 값이 바뀌면 화면 오류도 따라 바꾼다(2026-10-26). 같은 라우트로의
  // 리다이렉트는 이 폼을 다시 마운트하지 않아, 예전엔 처음 값만 보이고 새 오류는 묻혔다.
  // (렌더 중 상태 맞추기 — effect 안 setState 대신 React 권장 패턴.)
  const [seenServerError, setSeenServerError] = useState(serverError);
  if (serverError !== seenServerError) {
    setSeenServerError(serverError);
    if (serverError) {
      setError(serverError);
      setIsSubmitting(false);
    }
  }

  // ── 작성 중 초안 보존 ──────────────────────────────────────
  // "예약 보기" 를 누르면 캘린더로 이동하고(router.push) 뒤로 가기가 이
  // 폼을 다시 마운트하므로 입력한 내용이 전부 사라진다. 작성 중인 값을 sessionStorage 에 복제해 두면
  // 왕복(또는 실수로 나가는 경우)에도 복원된다. 저장에 성공하거나 명시적으로
  // 목록으로 돌아갈 때 지운다. (아직 업로드하지 않은 새 사진은 File 객체라 직렬화할 수 없어서
  // 왕복해도 복원되지 않는 유일한 필드다.)
  const draftKey = `taskDraft:${mode}:${taskId ?? "new"}`;
  const hydratedRef = useRef(false);
  const submittedRef = useRef(false);
  // 재진입(더블탭) 차단 전용 — `submittedRef` 는 초안 저장 억제 용도로 이미 쓰이고 있어 이름을
  // 나눈다. ref 는 리렌더 없이 즉시(동기) 반영되므로, `isPending`/`isSubmitting` 같은 state 로는
  // 못 막는 "같은 이벤트 루프 안의 연속 두 번째 탭"까지 막는다.
  const submitLockRef = useRef(false);
  // 서버 오류로 돌아왔으면 잠금도 푼다 — 위의 렌더 중 맞추기는 ref 를 건드릴 수 없어 여기서.
  useEffect(() => {
    if (!serverError) return;
    submitLockRef.current = false;
    submittedRef.current = false;
  }, [serverError]);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(draftKey);
    } catch {
      /* 저장소 오류 무시 (사생활 보호 모드 / 용량 초과) */
    }
  }, [draftKey]);

  /** 제출을 되돌릴 수 있는 상태로 — 다시 누를 수 있고 초안 저장도 다시 켜진다. */
  const unlockSubmit = useCallback(() => {
    submitLockRef.current = false;
    submittedRef.current = false;
    setIsSubmitting(false);
  }, []);

  /**
   * 서버 액션 실행. 액션은 성공 · 검증 실패 모두 `redirect()` 로 끝난다(2026-10-26 정리):
   * - `?error=` 가 붙은 리다이렉트 = 실패 → 잠금을 풀고 오류를 보여 준다. **초안은 지우지 않는다.**
   * - 그 밖의 리다이렉트 = 성공 → 이제서야 초안을 지운다(예전엔 제출 전에 지워, 실패하면 입력이 날아갔다).
   * - 리다이렉트가 아닌 throw(네트워크 등) = 실패.
   * 리다이렉트 에러는 다시 던져 Next 가 이동을 마치게 한다.
   */
  const submitAction = useCallback(
    (action: (fd: FormData) => Promise<void>, formData: FormData) => {
      submittedRef.current = true;
      startTransition(async () => {
        try {
          await action(formData);
          unlockSubmit();
        } catch (e) {
          const target = redirectTargetOf(e);
          if (target === null) {
            unlockSubmit();
            setError(copy.errors.save_failed);
            return;
          }
          let code: string | null = null;
          try {
            code = new URL(target, window.location.origin).searchParams.get("error");
          } catch {
            code = null;
          }
          if (code) {
            unlockSubmit();
            setError(copy.errors[code] ?? copy.errors.save_failed);
          } else {
            clearDraft();
          }
          throw e;
        }
      });
    },
    [clearDraft, copy.errors, unlockSubmit],
  );

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
      /* 저장소 오류 무시 */
    }
  }, [draftKey, date, time, duration, priority, repeat, tags, shareIds, directive, linkedCtx, more, existingImgUrls]);

  // 마운트 시 한 번 복원한다(저장 effect 가 초기 상태로 덮어쓰기 전에).
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
      return; // 형식이 깨진 초안 — 무시
    }
    // 비제어 input: DOM 값을 직접 복원한다.
    const form = formRef.current;
    if (form) {
      const t = form.elements.namedItem("title") as HTMLInputElement | null;
      if (t && typeof d.title === "string") t.value = d.title;
      const ds = form.elements.namedItem("description") as HTMLTextAreaElement | null;
      if (ds && typeof d.description === "string") ds.value = d.description;
    }
    // 상태 필드: effect 본문에서 setState 를 동기 호출하지 않도록 마이크로태스크에서 적용하고
    // (react-hooks/set-state-in-effect), 페인트 전에 끝나므로 깜빡임도 없다.
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

  // 추적하는 값이 바뀔 때마다 저장한다(초기 복원이 끝난 뒤).
  useEffect(() => {
    if (!hydratedRef.current) return;
    persistDraft();
  }, [persistDraft]);

  // `custom` 은 저장된 반복 버킷으로 인정되지만 이번 범위에서는 사용자가 만들 수 없다
  // (규칙 빌더 없음). 수정 중인 업무가 이미 쓰고 있을 때만 읽기 전용으로 보여 준다.
  // 예전 값이 조용히 사라지지 않고 선택이 모호해 보이지 않게 하기 위해서다.
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
    // 구체적인 시각 / 반복에는 날짜 기준점이 필요하다 — 조용히 버리지 않고 제출을 막는다.
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
    // 단일 날짜 모델(A안): 그 날짜가 due_at 에 매핑되고 scheduled 는 비어 있다.
    formData.set("scheduledDate", "");
    formData.set("dueDate", date);
    formData.set("time", time);
    // 소요 시간은 같은 날 시간 블록이라 시각이 있을 때만 의미가 있다.
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
      // 남은 칸보다 많이 골랐으면 조용히 자르지 않고 개수 초과 안내를 띄운 채 멈춘다(2026-10-28) —
      // 업로더는 새 사진만 세므로 기존 사진 + 새 사진이 한도를 넘을 수 있다.
      if (newPhotos.length > newSlots) {
        setError(maxImages === 20 ? copy.photosCountError20 : imgCopy.errorCount);
        submitLockRef.current = false;
        setIsSubmitting(false);
        return;
      }
      if (newPhotos.length > 0 && newSlots > 0) {
        const requestId = crypto.randomUUID();
        try {
          const { imageUrls } = await uploadRequestImages({
            items: newPhotos,
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
      submitAction(updateTaskCore, formData);
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
    submitAction(createTask, formData);
  }

  // "더 보기 — 시간 · 우선순위 …" → 굵은 앞부분 + 흐린 힌트(모든 로케일이 em-dash 구분자를 쓴다).
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
      {/* 프로젝트 연결 — 프로젝트 업무 생성 때만 있음(숨김, createTask 가 읽음). */}
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

      {/* 일정 — 날짜 + 시간 + 반복을 Todoist 스타일 시트 하나에서. */}
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

      {/* 공유 — 생성 때만; 프로젝트 업무에서는 숨김(공유는 프로젝트가 결정). */}
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

      {/* 컨텍스트 링크 — 선택; 빠른 추가에서는 쓸 수 없고 상세 생성/수정에서만. */}
      <ContextLinkSection
        buildingLabels={buildingLabels}
        copy={copy}
        locale={locale}
        onClear={() => setLinkedCtx(null)}
        onOpenPicker={() => setCtxPickerOpen(true)}
        value={linkedCtx}
      />

      {/* 더 보기 — 접을 수 있는 고급 섹션(우선순위 / 태그 / 사진). */}
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
                  // 조합(IME) 중 Enter 는 글자 확정이다 — 태그로 넣지 않는다.
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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
