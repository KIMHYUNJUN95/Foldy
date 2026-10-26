"use client";

/**
 * 근태 정정 요청 — 폼("Attendance Correction Request.html" 의 프레임 F), Step 6 에서 연결한
 * 실제 백엔드. 같은 디자인: 사유 칩 · 희망 출근/퇴근 시각 · 희망 사이트 · 메모 ·
 * 사진(≤5) · 고정 제출 바. 이제 동작함: 희망 사이트 상자가 공용 드래그 닫기
 * 선택 시트를 열고, 사진은 앱의 압축 + `request-images` 업로드를 쓰며, 제출은
 * `createAttendanceCorrectionRequest` 를 호출한다(본인 한정 + 이번/지난달만, 서버에서 강제).
 * 세션에 연결된 요청(`sessionId` + 컨텍스트)과 세션 없는 EXCEPTION 요청을 지원한다.
 * 화이트 리디자인(2026-10-13, 시안 AttCorr-Phone · Fold · Tablet): 제목 · 한 줄 설명 → (기록 없는 날이면 근무 날짜)
 * → 사유 6가지 → 출근 · 퇴근 · 현장 · 메모(테두리 이름표 칸) → 사진 → 보내기. 태블릿 가로는 오른쪽에 내 정정 요청(최근 30일).
 */

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./attendance.css";
import { AIc, AttIcon } from "./att-icons";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  TimePickerSheet,
  formatTimeDisplay,
} from "./time-picker-sheet";
import {
  compressImageFile,
  type PreviewItem,
} from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";
import {
  createAttendanceCorrectionRequest,
  type CreateCorrectionInput,
} from "@/app/mobile/attendance/actions";
import type { AttendanceCorrectionReason, AttendanceCorrectionStatus } from "@/lib/attendance";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { tokyoToday } from "@/lib/annual-leave";
import { HireDatePicker } from "./hire-date-picker";
import { haptic } from "@/lib/haptics";

type AttendanceCopy = Dictionary["attendance"];

type SessionContext = {
  dateLabel: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  siteName: string | null;
};

export type MyCorrectionItem = {
  id: string;
  status: AttendanceCorrectionStatus;
  reasonKey: string;
  targetDateLabel: string | null;
  desiredClockInLabel: string | null;
  desiredClockOutLabel: string | null;
};

const MAX_PHOTOS = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const REASON_VALUES: AttendanceCorrectionReason[] = [
  "missing_clock_in",
  "missing_clock_out",
  "wrong_time",
  "wrong_site",
  "auth_failed",
  "other",
];

/** 'YYYY-MM-DD' → 「10월 1일 (수)」 — 고정 날짜라 UTC 로 그려 서버 · 클라이언트가 같다. */
function formatWorkDate(iso: string, locale: string): string {
  const tag = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
  return new Intl.DateTimeFormat(tag, {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function AttendanceCorrectionForm({
  organizationId,
  sessionId,
  sessionContext,
  sites,
  myRequests,
  locale,
}: {
  organizationId: string;
  sessionId: string | null;
  sessionContext: SessionContext | null;
  sites: { id: string; name: string }[];
  /** 태블릿 가로 오른쪽 목록 — 내 정정 요청(최근 30일). */
  myRequests: MyCorrectionItem[];
  locale: string;
}) {
  const copy = getDictionary(locale).attendance;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [reason, setReason] = useState<AttendanceCorrectionReason>("missing_clock_out");
  const [inTime, setInTime] = useState<string>(sessionContext?.clockInTime ?? "");
  const [outTime, setOutTime] = useState<string>(sessionContext?.clockOutTime ?? "");
  const [siteId, setSiteId] = useState<string | null>(null);
  // 세션 없는 예외 요청의 근무 날짜(2026-10-01). 예전에는 늘 「오늘」로 접수돼 지난 날짜 누락을 낼 수 없었다.
  // 서버가 같은 범위(당월·전월, 오늘 이전)를 다시 검사한다.
  const [workDate, setWorkDate] = useState<string>(() => tokyoToday());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const minWorkDate = useMemo(() => {
    const [y, m] = tokyoToday().split("-").map(Number);
    return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  }, []);
  const [memo, setMemo] = useState<string>("");
  const [photos, setPhotos] = useState<PreviewItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inPickerOpen, setInPickerOpen] = useState(false);
  const [outPickerOpen, setOutPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const siteName = useMemo(
    () => (siteId ? (sites.find((s) => s.id === siteId)?.name ?? null) : null),
    [siteId, sites],
  );

  const reasonLabels: Record<AttendanceCorrectionReason, string> = {
    missing_clock_in: copy.reasonMissingIn,
    missing_clock_out: copy.reasonMissingOut,
    wrong_time: copy.reasonWrongTime,
    wrong_site: copy.reasonWrongSite,
    auth_failed: copy.reasonAuthFailed,
    other: copy.reasonOther,
  };

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selected.length === 0) return;
    if (selected.some((f) => !ALLOWED_TYPES.includes(f.type))) {
      setError(copy.corrErrImageType);
      return;
    }
    if (selected.some((f) => f.size > MAX_BYTES)) {
      setError(copy.corrErrImageSize);
      return;
    }
    if (photos.length + selected.length > MAX_PHOTOS) {
      setError(copy.corrErrPhotoLimit(MAX_PHOTOS));
      return;
    }
    setError(null);
    const items = await Promise.all(
      selected.map(async (file) => {
        const compressed = await compressImageFile(file);
        return {
          id: `${Date.now()}-${Math.random()}`,
          file: compressed,
          previewUrl: URL.createObjectURL(compressed),
        } satisfies PreviewItem;
      }),
    );
    setPhotos((prev) => [...prev, ...items]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      let imageUrls: string[] = [];
      if (photos.length > 0) {
        try {
          const uploaded = await uploadRequestImages({
            items: photos.slice(0, MAX_PHOTOS),
            organizationId,
            requestId: crypto.randomUUID(),
            requestType: "attendance-corrections",
          });
          imageUrls = uploaded.imageUrls;
        } catch {
          setError(copy.corrErrPhotoUpload);
          return;
        }
      }

      const input: CreateCorrectionInput = {
        sessionId,
        reasonType: reason,
        memo: memo.trim() ? memo.trim() : null,
        desiredInTime: inTime || null,
        desiredOutTime: outTime || null,
        desiredSiteId: siteId,
        targetDate: sessionId ? null : workDate,
        imageUrls,
      };
      const res = await createAttendanceCorrectionRequest(input);
      if (res.ok) {
        haptic("success");
        router.push(`/mobile/attendance/correction/status?id=${res.id}`);
        return;
      }
      haptic("error");
      setError(
        res.reason === "out_of_range"
          ? copy.corrErrOutOfRange
          : res.reason === "forbidden"
            ? copy.corrErrForbidden
            : res.reason === "invalid"
              ? copy.corrErrInvalid
              : resultGenericSub(copy),
      );
    });
  }

  const statusLabel: Record<AttendanceCorrectionStatus, string> = {
    requested: copy.stepRequested,
    in_review: copy.stepInReview,
    approved: copy.stepApproved,
    rejected: copy.stepRejected,
    cancelled: copy.stepCancelled,
  };
  const sub = sessionContext
    ? [sessionContext.dateLabel, sessionContext.siteName].filter(Boolean).join(" · ")
    : copy.corrSubExceptionShort;

  return (
    <div className="att att--corrw">
      <div className="corrw-form">
        <div className="ptitle-row">
          <div>
            <h1 className="ptitle">{copy.corrFormTitle}</h1>
            <div className="ptitle__sub">{sub}</div>
          </div>
        </div>

        {sessionContext ? null : (
          <div className="nf">
            <span className="nf__l">{copy.corrFieldWorkDate}</span>
            <button type="button" className="nf__in" onClick={() => setDatePickerOpen(true)}>
              <span>{formatWorkDate(workDate, locale)}</span>
              <AIc>{AttIcon.calendar}</AIc>
            </button>
          </div>
        )}

        <div className="corrw-reason">
          <div className="corrw-q">{copy.corrReasonQ}</div>
          <div className="corrw-chips">
            {REASON_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={reason === v}
                className={`corrw-chip${reason === v ? " on" : ""}`}
                onClick={() => setReason(v)}
              >
                {reasonLabels[v]}
              </button>
            ))}
          </div>
        </div>

        <div className="corrw-duo">
          <div className="nf">
            <span className="nf__l">{copy.corrFieldClockIn}</span>
            <button type="button" className="nf__in mono" onClick={() => setInPickerOpen(true)}>
              <span className={inTime ? "" : "nf__ph"}>{formatTimeDisplay(inTime, locale)}</span>
            </button>
          </div>
          <div className="nf">
            <span className="nf__l">{copy.corrFieldClockOut}</span>
            <button type="button" className="nf__in mono" onClick={() => setOutPickerOpen(true)}>
              <span className={outTime ? "" : "nf__ph"}>{formatTimeDisplay(outTime, locale)}</span>
            </button>
          </div>
        </div>

        <div className="nf">
          <span className="nf__l">{copy.corrSiteField}</span>
          <button type="button" className="nf__in" onClick={() => setPickerOpen(true)}>
            <span className={siteName ? "" : "nf__ph"}>{siteName ?? copy.corrSiteNone}</span>
            <AIc>{AttIcon.caret}</AIc>
          </button>
        </div>

        <div className="nf">
          <label className="nf__l" htmlFor="corrw-memo">
            {copy.corrFieldMemo} · {copy.corrFieldMemoOpt}
          </label>
          <textarea
            id="corrw-memo"
            className="nf__in nf__ta"
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={copy.corrFieldMemoPlaceholder}
          />
        </div>

        <div className="corrw-photos">
          <div className="corrw-q">
            {copy.corrFieldPhoto} <span>{copy.corrFieldTimeOpt} · {copy.corrPhotoCount.replace("{n}", String(photos.length))}</span>
          </div>
          <div className="corrw-photos__row">
            {photos.map((p) => (
              <div
                key={p.id}
                className="corrw-thumb"
                style={{ backgroundImage: `url(${p.previewUrl})` }}
              >
                <button type="button" onClick={() => removePhoto(p.id)} aria-label={copy.corrFieldPhotoDelete}>
                  {AttIcon.x}
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <button type="button" className="corrw-add" onClick={() => fileRef.current?.click()} aria-label={copy.corrFieldPhotoAdd}>
                <AIc>{AttIcon.plus}</AIc>
              </button>
            ) : null}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
        </div>

        {error ? (
          <p className="corrw-err" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="corrw-submit" onClick={submit} disabled={isPending}>
          {isPending ? copy.corrSubmitting : copy.corrSubmit}
        </button>
        <p className="corrw-help">{copy.corrFieldHelper}</p>
      </div>

      <aside className="corrw-mine">
        <div className="corrw-mine__h">
          <b>{copy.corrMyRequests}</b>
          <span>{copy.corrRecent30}</span>
        </div>
        {myRequests.length === 0 ? <p className="corrw-mine__empty">{copy.corrMyRequestsEmpty}</p> : null}
        {myRequests.map((r) => (
          <Link key={r.id} href={`/mobile/attendance/correction/status?id=${r.id}`} className="corrw-mine__row">
            <span className="corrw-mine__b">
              <b>{r.targetDateLabel ?? copy.corrDetailNoSession}</b>
              <span>
                {(copy[r.reasonKey as keyof typeof copy] as string | undefined) ?? r.reasonKey} ·{" "}
                {r.desiredClockInLabel ?? "—"} → {r.desiredClockOutLabel ?? "—"}
              </span>
            </span>
            <span className={`corrw-mine__s is-${r.status}`}>{statusLabel[r.status]}</span>
          </Link>
        ))}
      </aside>

      {/* 출근 시각 선택기 */}
      {inPickerOpen && (
        <TimePickerSheet
          value={inTime}
          label={copy.corrFieldClockIn}
          confirmLabel={copy.corrTimeConfirm}
          locale={locale}
          onConfirm={(v) => setInTime(v)}
          onClose={() => setInPickerOpen(false)}
        />
      )}

      {/* 퇴근 시각 선택기 */}
      {outPickerOpen && (
        <TimePickerSheet
          value={outTime}
          label={copy.corrFieldClockOut}
          confirmLabel={copy.corrTimeConfirm}
          locale={locale}
          onConfirm={(v) => setOutTime(v)}
          onClose={() => setOutPickerOpen(false)}
        />
      )}

      {/* 근무 날짜 선택기(세션 없는 예외 요청만) */}
      {datePickerOpen && (
        <HireDatePicker
          locale={locale}
          value={workDate}
          title={copy.corrFieldWorkDate}
          minDate={minWorkDate}
          onApply={(v) => setWorkDate(v)}
          onClose={() => setDatePickerOpen(false)}
        />
      )}

      {/* 희망 사이트 선택기 — 표준 BottomSheet */}
      {pickerOpen && (
        <BottomSheet onClose={() => setPickerOpen(false)} ariaLabel={copy.corrPickerAriaLabel}>
          {({ close }) => (
            <div className="att">
              <h3 className="rsheet__t">{copy.corrPickerTitle}</h3>
              <div className="cpick">
                <button
                  type="button"
                  className={`cpick__item${siteId === null ? " on" : ""}`}
                  onClick={() => {
                    setSiteId(null);
                    close();
                  }}
                >
                  {copy.corrSiteNone}
                </button>
                {sites.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`cpick__item${siteId === s.id ? " on" : ""}`}
                    onClick={() => {
                      setSiteId(s.id);
                      close();
                    }}
                  >
                    <AIc>{AttIcon.pin}</AIc>
                    {s.name}
                  </button>
                ))}
                {sites.length === 0 ? (
                  <div className="cpick__empty">{copy.corrPickerEmpty}</div>
                ) : null}
              </div>
            </div>
          )}
        </BottomSheet>
      )}

    </div>
  );
}

function resultGenericSub(copy: AttendanceCopy): string {
  return copy.resultGenericSub;
}
