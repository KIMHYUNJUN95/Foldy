"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import "./transport.css";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { CalendarPanel } from "./transport-date-sheet";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { getCanonicalPropertyName } from "@/lib/room-label-normalization";
import {
  matchDestinationByLabel,
  transportDestinationRequiresMemo,
  type TransportDestination,
} from "@/lib/transport-destinations";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import {
  createTransportItemAction,
  updateTransportItemAction,
  deleteTransportItemAction,
  addTransportItemImageAction,
  submitTransportReportAction,
} from "@/app/mobile/attendance/transport/actions";
import type {
  TransportItemRow,
  TransportReportRow,
  LinkedTransportCandidate,
} from "@/lib/transport-reimbursement";

type TransportItem = {
  id: string;
  date: string;         // 'YYYY-MM-DD'
  building: string;
  context: string;
  amount: number;
  receiptCount: number;
  mode: "linked" | "manual";
  missingReceipt?: boolean;
  rooms?: string;
  memo?: string;
};

type Props = {
  locale: string;
  userName: string;
  organizationId: string;
  report: TransportReportRow;
  initialItems: TransportItemRow[];
  linkedCandidates: LinkedTransportCandidate[];
  monthKey: string;   // 'YYYY-MM'
  monthLabel: string;
  /** 출근지 목록 — 캘린더와 같은 건물 집합 + 사무실 + 기타. 서버가 내려준다. */
  destinations: TransportDestination[];
  /** 출근지별로 이 사용자가 마지막에 넣은 금액. 입력칸을 미리 채우는 데 쓴다. */
  recentAmounts: Record<string, { amountYen: number; usageDate: string }>;
};

function mapItemRow(row: TransportItemRow): TransportItem {
  const ctx = row.workContext ?? {};
  return {
    id: row.id,
    date: row.usageDate,
    building: ctx.buildingLabel ?? "",
    context: ctx.contextSummary ?? "",
    amount: row.amountYen,
    receiptCount: row.images.length,
    mode: row.entryMode,
    missingReceipt: row.images.length === 0,
    rooms: ctx.roomLabel ?? undefined,
    memo: row.memo ?? undefined,
  };
}

// 이미지 파일을 압축 후 Storage에 업로드하고 storagePath 반환.
async function uploadTransportImage(
  file: File,
  organizationId: string,
  reportId: string,
  itemId: string,
): Promise<string> {
  const compressed = await compressImageFile(file);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const filename = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${organizationId}/transport-reimbursements/${reportId}/${itemId}/${filename}`;

  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.storage
    .from("request-images")
    .upload(storagePath, compressed, { contentType: compressed.type, upsert: false });

  if (error) throw new Error("upload_failed");
  return storagePath;
}

function ChevDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v5M12 16v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 3H15L17 5H21C21.6 5 22 5.4 22 6V19C22 19.6 21.6 20 21 20H3C2.4 20 2 19.6 2 19V6C2 5.4 2.4 5 3 5H7L9 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 11V8a2 2 0 00-4 0v3M14 11V7a2 2 0 00-4 0v4M10 11V9a2 2 0 00-4 0v7a6 6 0 006 6h2a6 6 0 006-6v-3a2 2 0 00-4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// Detail-sheet row icons (ported from "05" mockup)
function CalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M4 9.5h16M8 4v3M16 4v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
function WonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 9l1.6 6 1.7-4.2L12.5 15l1.6-6M6.8 11.3h10.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2M10 20.5v-3h4v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function DoorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 20.5V4.5a1 1 0 011-1h10a1 1 0 011 1v16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4 20.5h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="14.5" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}
function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 4.5h14v11l-4 4H5v-15z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 19.5v-4h4M8.5 9h7M8.5 12.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20l.8-3.6L15.4 5.8a2 2 0 012.8 2.8L7.6 19.2 4 20z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7h14M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7M6.5 7l.8 12A1.5 1.5 0 008.8 20h6.4a1.5 1.5 0 001.5-1.4l.8-12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.2l2.6 2.6L16 9.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AlertTriangleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </svg>
  );
}

function fmtYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

/** 'YYYY-MM-DD' → { full: "6월 2일", weekday: "월" } (Tokyo 기준) */
function fmtDateParts(isoDate: string, localeTag: string): { full: string; weekday: string } {
  const dt = new Date(`${isoDate}T00:00:00+09:00`);
  const full = new Intl.DateTimeFormat(localeTag, {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(dt);
  const weekday = new Intl.DateTimeFormat(localeTag, {
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(dt);
  return { full, weekday };
}

/** 'YYYY-MM-DD' → "6월 2일 (월)" (날짜 필드 표시) */
function fmtDateFull(isoDate: string, localeTag: string): string {
  const { full, weekday } = fmtDateParts(isoDate, localeTag);
  return `${full} (${weekday})`;
}

/** 'YYYY-MM-DD' → 'M/D' (리스트 행 날짜 표시) */
function shortDateLabel(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00+09:00`);
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  return `${m}/${d}`;
}

/** context "201, 202, 301" → "201 · 202 · 301" */
function roomsLabel(item: TransportItem): string {
  const raw = item.rooms ?? item.context;
  if (!raw) return "-";
  return raw.replace(/\s*,\s*/g, " · ");
}

// Tokyo 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환.
function getTodayTokyo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

function AddItemSheet({
  dict,
  localeTag,
  organizationId,
  reportId,
  monthKey,
  destinations,
  recentAmounts,
  linkedCandidates,
  usedDates,
  onClose,
  onCreated,
}: {
  dict: Dictionary;
  localeTag: string;
  organizationId: string;
  reportId: string;
  monthKey: string;
  destinations: TransportDestination[];
  recentAmounts: Record<string, { amountYen: number; usageDate: string }>;
  linkedCandidates: LinkedTransportCandidate[];
  /** 이미 교통비를 넣은 날짜 — 같은 날 두 번 넣는 실수를 눈에 띄게 한다. */
  usedDates: Set<string>;
  onClose: () => void;
  onCreated: (item: TransportItem) => void;
}) {
  const t = dict.transport;
  const [inputMode, setInputMode] = useState<"linked" | "manual">("manual");
  const [usageDate, setUsageDate] = useState(getTodayTokyo());
  const [showCal, setShowCal] = useState(false);
  const [amount, setAmount] = useState("");
  // 라벨이 아니라 **키**를 들고 있는다. 라벨은 로케일마다 달라서 저장·기억의 키가 될 수 없다.
  const [destinationKey, setDestinationKey] = useState("");
  const [showBuildingList, setShowBuildingList] = useState(false);
  const [memo, setMemo] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const buildingWrapRef = useRef<HTMLDivElement>(null);

  // 자동 연결에서 고른 근무 기록. **고르지 않으면 `linked` 로 저장하지 않는다** —
  // 예전에는 버튼만 눌러도 `entry_mode: 'linked'` 로 찍혀서, 연결된 것이 없는데 연결됐다고
  // 적힌 행이 남았다(29건 전부 `attendance_session_id` 가 null 이었다).
  const [linkedKey, setLinkedKey] = useState<string | null>(null);
  const linked = linkedCandidates.find((c) => c.key === linkedKey) ?? null;

  const destination = destinations.find((d) => d.key === destinationKey) ?? null;
  const needsMemo = transportDestinationRequiresMemo(destinationKey);
  const recent = destinationKey ? recentAmounts[destinationKey] : undefined;

  useEffect(() => {
    if (!showBuildingList) return;
    function onOutside(e: MouseEvent) {
      if (buildingWrapRef.current && !buildingWrapRef.current.contains(e.target as Node)) {
        setShowBuildingList(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showBuildingList]);

  // 기타는 메모가 없으면 보낼 수 없다. 서버도 같은 판정을 한 번 더 한다 —
  // 화면만 막으면 다른 경로로 들어온 요청이 그대로 통과한다.
  const memoMissing = needsMemo && memo.trim().length === 0;
  // 자동 연결을 골랐으면 근무 기록을 실제로 하나 집어야 한다.
  const linkMissing = inputMode === "linked" && !linked;
  const canSubmit =
    Boolean(parseInt(amount.replace(/[^\d]/g, ""), 10)) && !memoMissing && !linkMissing && !pending;

  async function handleSubmit() {
    const amountNum = parseInt(amount.replace(/[^\d]/g, ""), 10);
    if (!amountNum || amountNum <= 0) return;
    if (memoMissing || linkMissing) return;
    setPending(true);
    try {
      const result = await createTransportItemAction({
        targetMonth: monthKey,
        usageDate,
        amountYen: amountNum,
        entryMode: inputMode,
        attendanceSessionId: linked?.attendanceSessionId ?? null,
        propertyId: linked?.propertyId ?? destination?.propertyId ?? null,
        destinationKey: linked?.propertyId ?? (destinationKey || undefined),
        buildingLabel: linked?.buildingLabel || destination?.label || undefined,
        contextSummary: linked?.contextSummary || undefined,
        memo: memo.trim() || null,
      });
      if (!result.ok) {
        setPending(false);
        return;
      }
      const itemId = result.itemId;
      // 이미지가 있으면 compress → upload → DB 등록
      let receiptCount = 0;
      for (const file of files) {
        try {
          const path = await uploadTransportImage(file, organizationId, reportId, itemId);
          await addTransportItemImageAction(itemId, path);
          receiptCount++;
        } catch {
          // 이미지 업로드 실패는 비치명적; 항목 자체는 생성 완료
        }
      }
      onCreated({
        id: itemId,
        date: usageDate,
        building: linked?.buildingLabel || destination?.label || "",
        context: linked?.contextSummary ?? "",
        amount: amountNum,
        receiptCount,
        mode: inputMode,
        missingReceipt: receiptCount === 0,
        memo: memo.trim() || undefined,
      });
      onClose();
    } catch {
      setPending(false);
    }
  }

  // 캘린더는 별도 시트로 분리 — 폼 시트와 동시에 뜨지 않으므로(둘 중 하나만 렌더)
  // 겹침이 없고, 캘린더를 쓸어내리면(드래그 dismiss) 폼으로 자동 복귀한다.
  // AddItemSheet 자체는 계속 마운트되어 폼 입력 상태가 보존된다.
  if (showCal) {
    return (
      <BottomSheet key="trn-cal-sheet" onClose={() => setShowCal(false)}>
        {({ close }) => (
          <CalendarPanel
            value={usageDate}
            dict={dict}
            localeTag={localeTag}
            onConfirm={(d) => {
              setUsageDate(d);
              close();
            }}
            onBack={close}
          />
        )}
      </BottomSheet>
    );
  }

  return (
    <BottomSheet key="trn-form-sheet" onClose={onClose} className="max-h-[88dvh] flex flex-col">
      <div className="trn trn-form">
        <div className="trn-sh-h">{t.addSheetTitle}</div>

        <div className="trn-row2">
          <div className="trn-tf">
            <div className="trn-tf-l">{t.fieldDate}</div>
            <button
              type="button"
              className="trn-tf-in trn-tf-btn"
              onClick={() => setShowCal(true)}
            >
              <span className="trn-date-val">{fmtDateFull(usageDate, localeTag)}</span>
              <CalIcon />
            </button>
          </div>
          <div className="trn-tf">
            <div className="trn-tf-l">{t.fieldAmount} <b>*</b></div>
            <div className="trn-tf-in trn-amt-in">
              <input
                className="trn-input trn-input-amt"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                aria-label={t.fieldAmount}
              />
              <span className="trn-un">{t.amountUnit}</span>
            </div>
            {/*
              금액을 미리 채웠으면 **언제 것인지 같이 보여준다.** 근거 없이 숫자만 들어가 있으면
              확인 없이 넘기게 되고, 운임이 바뀐 날에 틀린 값이 그대로 확정된다.
            */}
            {recent && amount === String(recent.amountYen) ? (
              <div className="trn-prefill">
                {t.destinationSameAs.replace("{date}", shortDateLabel(recent.usageDate))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldBuilding}</div>
          <div className="trn-bld-wrap" ref={buildingWrapRef}>
            <button
              type="button"
              className="trn-bld-trigger"
              data-open={showBuildingList ? "true" : undefined}
              onClick={() => setShowBuildingList((v) => !v)}
              aria-label={t.fieldBuilding}
            >
              {destination ? (
                <span className="trn-bld-val">{destination.label}</span>
              ) : (
                <span className="trn-bld-ph">{t.fieldBuildingPlaceholder}</span>
              )}
              <ChevDownIcon />
            </button>
            {showBuildingList && (
              <div className="trn-bld-list">
                {destinations.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    className="trn-bld-opt"
                    onClick={() => {
                      setDestinationKey(d.key);
                      setShowBuildingList(false);
                      // 지난번 금액을 미리 채운다. **이미 친 값은 건드리지 않는다** —
                      // 오늘 금액을 먼저 입력한 사람의 값을 덮으면 그게 더 나쁜 실수다.
                      const known = recentAmounts[d.key];
                      if (known && !amount.trim()) setAmount(String(known.amountYen));
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldReceipt}</div>
          <div className="trn-shots">
            {files.map((f, i) => (
              <div key={i} className="trn-shot" title={f.name} />
            ))}
            <button
              type="button"
              className="trn-shot-add"
              aria-label={t.addPhoto}
              onClick={() => fileInputRef.current?.click()}
            >
              <CameraIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) {
                  setFiles((prev) => [...prev, ...Array.from(e.target.files!)].slice(0, 5));
                }
              }}
            />
          </div>
          <div className="trn-hint">
            <AlertIcon />
            {t.fieldReceiptHint}
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">
            {t.fieldMemo}
            {needsMemo ? <span className="trn-req" aria-hidden="true"> *</span> : null}
          </div>
          <div className="trn-tf-in">
            <input
              className="trn-input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={t.fieldMemoPlaceholder}
              aria-label={t.fieldMemo}
              required={needsMemo}
            />
            {/* 기타는 어디에 왜 썼는지가 없으면 나중에 정산할 수 없다. */}
            {memoMissing ? (
              <div className="trn-err">{t.destinationOtherMemoRequired}</div>
            ) : null}
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldInputMode}</div>
          <div className="trn-seg">
            <button
              type="button"
              className={inputMode === "linked" ? "trn-on" : ""}
              onClick={() => setInputMode("linked")}
            >
              <LinkIcon />
              {t.modeAutoLink}
            </button>
            <button
              type="button"
              className={inputMode === "manual" ? "trn-on" : ""}
              onClick={() => setInputMode("manual")}
            >
              <HandIcon />
              {t.modeManual}
            </button>
          </div>
        </div>

        {/*
          자동 연결 — 그 달의 **실제 근무 기록**(출퇴근 · 청소)을 보여주고 하나를 고르게 한다.
          고르면 날짜·건물이 채워지고 `attendance_session_id` 로 근태와 이어진다. 「출근 안 한 날
          교통비」가 자연히 걸러지는 것이 이 모드의 값어치다.

          고르기 전에는 저장이 잠긴다 — 예전에는 버튼만 눌러도 `linked` 로 찍혀서 연결된 것이
          없는데 연결됐다고 적힌 행이 남았다.
        */}
        {inputMode === "linked" ? (
          <div className="trn-tf">
            <div className="trn-tf-l">{t.linkPickLabel}</div>
            {linkedCandidates.length === 0 ? (
              <div className="trn-link-empty">{t.linkNoCandidates}</div>
            ) : (
              <div className="trn-link-list">
                {linkedCandidates.map((candidate) => (
                  <button
                    key={candidate.key}
                    type="button"
                    className={`trn-link-opt${linkedKey === candidate.key ? " on" : ""}`}
                    onClick={() => {
                      setLinkedKey(candidate.key);
                      setUsageDate(candidate.date);
                      // 건물 FK 가 있으면 그것으로, 없으면 이름으로 맞춘다. 근무지의 FK 가
                      // 비어 있는 상태에서도 「사무실」 같은 출근지가 제대로 잡혀야 한다.
                      const matched = candidate.propertyId
                        ? (destinations.find((d) => d.key === candidate.propertyId) ?? null)
                        : matchDestinationByLabel(
                            destinations,
                            candidate.buildingLabel,
                            getCanonicalPropertyName,
                          );
                      if (matched) setDestinationKey(matched.key);
                      const known = matched ? recentAmounts[matched.key] : undefined;
                      if (known && !amount.trim()) setAmount(String(known.amountYen));
                    }}
                  >
                    <span className="trn-link-d">{shortDateLabel(candidate.date)}</span>
                    <span className="trn-link-c">
                      {candidate.contextSummary || candidate.buildingLabel || "—"}
                    </span>
                    {usedDates.has(candidate.date) ? (
                      <span className="trn-link-used">{t.linkAlreadyAdded}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <button
          type="button"
          className="trn-add-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {pending ? <span className="trn-spin" /> : null}
          {t.addSheetSubmit}
        </button>
      </div>
    </BottomSheet>
  );
}

function DetailRow({
  icon,
  label,
  children,
  amount = false,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  amount?: boolean;
}) {
  return (
    <div className="trn-row">
      <span className="trn-ri">{icon}</span>
      <span className="trn-rk">{label}</span>
      <span className={`trn-rv${amount ? " trn-rv-amt" : ""}`}>{children}</span>
    </div>
  );
}

function DetailSheet({
  item,
  dict,
  localeTag,
  onClose,
  onEdit,
  onDelete,
}: {
  item: TransportItem;
  dict: Dictionary;
  localeTag: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = dict.transport;
  const { full, weekday } = fmtDateParts(item.date, localeTag);
  const isLinked = item.mode === "linked";
  const memo = item.memo ?? `${item.building} ${t.homeTransportSub}`;

  return (
    <BottomSheet onClose={onClose} className="max-h-[82dvh] flex flex-col">
      {({ close }) => (
        <div className="trn trn-detail">
          <div className="trn-detail-title">{t.detailTitle}</div>

          {/* Receipt photo strip */}
          {item.receiptCount > 0 ? (
            <div className="trn-dshots">
              {Array.from({ length: Math.min(item.receiptCount, 2) }).map((_, i) => (
                <div key={i} className="trn-dshot" style={{ width: "50%" }}>
                  <span className="trn-dshot__l">{t.receiptLabel(i + 1)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="trn-dshot-empty">{t.detailNoReceipt}</div>
          )}

          {/* Rows */}
          <DetailRow icon={<CalIcon />} label={t.fieldDate}>
            {full} ({weekday})
          </DetailRow>
          <DetailRow icon={<WonIcon />} label={t.fieldAmount} amount>
            {fmtYen(item.amount)}
          </DetailRow>
          <DetailRow icon={<BuildingIcon />} label={t.fieldBuilding}>
            {item.building}
          </DetailRow>
          <DetailRow icon={<DoorIcon />} label={t.detailRoom}>
            {roomsLabel(item)}
          </DetailRow>
          <DetailRow icon={<LinkIcon />} label={t.detailInput}>
            <span className={`trn-mode ${isLinked ? "trn-mode-link" : "trn-mode-manual"}`}>
              {isLinked ? <LinkIcon /> : <HandIcon />}
              {isLinked ? t.detailModeAuto : t.detailModeManual}
            </span>
          </DetailRow>
          <DetailRow icon={<NoteIcon />} label={t.detailMemoShort}>
            {memo}
          </DetailRow>

          {/* Actions — slide the detail out first, then open the next sheet */}
          <div className="trn-dacts">
            <button
              type="button"
              className="trn-a-edit"
              onClick={() => {
                onEdit();
                close();
              }}
            >
              <EditIcon />
              {t.detailEdit}
            </button>
            <button
              type="button"
              className="trn-a-del"
              onClick={() => {
                onDelete();
                close();
              }}
            >
              <TrashIcon />
              {t.detailDelete}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/** Edit sheet — 실제 서버 액션으로 저장. */
function EditItemSheet({
  item,
  dict,
  localeTag,
  organizationId,
  reportId,
  onClose,
  onSaved,
}: {
  item: TransportItem;
  dict: Dictionary;
  localeTag: string;
  organizationId: string;
  reportId: string;
  onClose: () => void;
  onSaved: (patch: Pick<TransportItem, "amount" | "context" | "memo" | "mode">) => void;
}) {
  const t = dict.transport;
  const { full, weekday } = fmtDateParts(item.date, localeTag);
  const [amount, setAmount] = useState(String(item.amount));
  const [context, setContext] = useState(item.context);
  const [memo, setMemo] = useState(item.memo ?? "");
  const [mode, setMode] = useState<"linked" | "manual">(item.mode);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSave(close: () => void) {
    const amountNum = Math.max(0, parseInt(amount.replace(/[^\d]/g, ""), 10) || 0);
    setPending(true);
    try {
      const result = await updateTransportItemAction({
        itemId: item.id,
        amountYen: amountNum,
        memo: memo.trim() || null,
        contextSummary: context.trim() || undefined,
      });
      if (!result.ok) {
        setPending(false);
        return;
      }
      // 새 이미지 추가
      for (const file of files) {
        try {
          const path = await uploadTransportImage(file, organizationId, reportId, item.id);
          await addTransportItemImageAction(item.id, path);
        } catch {
          // 이미지 업로드 실패는 비치명적
        }
      }
      onSaved({ amount: amountNum, context: context.trim(), memo: memo.trim(), mode });
      close();
    } catch {
      setPending(false);
    }
  }

  return (
    <BottomSheet onClose={onClose} className="max-h-[88dvh] flex flex-col">
      {({ close }) => (
      <div className="trn trn-form">
        <div className="trn-sh-h">{t.editSheetTitle}</div>

        <div className="trn-row2">
          <div className="trn-tf">
            <div className="trn-tf-l">{t.fieldDate}</div>
            <div className="trn-tf-in">
              {full} ({weekday})
            </div>
          </div>
          <div className="trn-tf">
            <div className="trn-tf-l">{t.fieldAmount} <b>*</b></div>
            <div className="trn-tf-in trn-amt-in">
              <input
                className="trn-input trn-input-amt"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label={t.fieldAmount}
              />
              <span className="trn-un">{t.amountUnit}</span>
            </div>
          </div>
        </div>

        <div className="trn-row2">
          <div className="trn-tf">
            <div className="trn-tf-l">{t.fieldBuilding}</div>
            <div className="trn-tf-in">
              {item.building} <ChevDownIcon />
            </div>
          </div>
          <div className="trn-tf">
            <div className="trn-tf-l">{t.detailRoom}</div>
            <div className="trn-tf-in">
              <input
                className="trn-input"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="201, 202"
                aria-label={t.fieldContext}
              />
            </div>
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldReceipt}</div>
          <div className="trn-shots">
            {Array.from({ length: Math.max(1, Math.min(item.receiptCount, 2)) }).map((_, i) =>
              i < item.receiptCount ? (
                <div key={i} className="trn-shot" />
              ) : (
                <button key={i} type="button" className="trn-shot-add" aria-label={t.addPhoto} onClick={() => fileInputRef.current?.click()}>
                  <CameraIcon />
                </button>
              ),
            )}
            {item.receiptCount < 2 && (
              <button type="button" className="trn-shot-add" aria-label={t.addPhoto} onClick={() => fileInputRef.current?.click()}>
                <CameraIcon />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) {
                  setFiles((prev) => [...prev, ...Array.from(e.target.files!)].slice(0, 5));
                }
              }}
            />
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldMemo}</div>
          <div className="trn-tf-in">
            <input
              className="trn-input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={t.fieldMemoPlaceholder}
              aria-label={t.fieldMemo}
            />
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldInputMode}</div>
          <div className="trn-seg">
            <button
              type="button"
              className={mode === "linked" ? "trn-on" : ""}
              onClick={() => setMode("linked")}
            >
              <LinkIcon />
              {t.modeAutoLink}
            </button>
            <button
              type="button"
              className={mode === "manual" ? "trn-on" : ""}
              onClick={() => setMode("manual")}
            >
              <HandIcon />
              {t.modeManual}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="trn-add-submit"
          disabled={pending}
          onClick={() => handleSave(close)}
        >
          {pending ? <span className="trn-spin" /> : null}
          {t.editSheetSubmit}
        </button>
      </div>
      )}
    </BottomSheet>
  );
}

/** Delete confirmation — center-aligned alert modal (intentional BottomSheet exception). */
function DeleteConfirmSheet({
  item,
  dict,
  onCancel,
  onConfirm,
}: {
  item: TransportItem;
  dict: Dictionary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = dict.transport;
  const [pending, setPending] = useState(false);

  return (
    <BottomSheet
      onClose={onCancel}
      ariaLabel={t.deleteTitle}
      header={
        <div className="trn">
          <div className="trn-confirm-head">
            <div className="trn-confirm-ic">
              <AlertTriangleIcon />
            </div>
            <div>
              <div className="trn-confirm-title">{t.deleteTitle}</div>
              <div className="trn-confirm-body">{t.deleteBody}</div>
            </div>
          </div>
        </div>
      }
    >
      {({ close }) => (
        <div className="trn">
          <div className="trn-confirm-card">
            <span className="k">
              {shortDateLabel(item.date)} · {item.building}
            </span>
            <span className="v">{fmtYen(item.amount)}</span>
          </div>
          <div className="trn-confirm-acts">
            <button
              type="button"
              className="trn-confirm-cancel"
              disabled={pending}
              onClick={() => {
                if (pending) return;
                close();
              }}
            >
              {t.deleteCancel}
            </button>
            <button
              type="button"
              className="trn-confirm-delete"
              disabled={pending}
              onClick={() => {
                if (pending) return;
                setPending(true);
                close();
                onConfirm();
              }}
            >
              {pending ? <span className="trn-spin" /> : <TrashIcon />}
              {t.deleteConfirm}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/** Lightweight action-feedback toast (auto-dismiss). */
function Toast({
  message,
  tone,
  onDone,
}: {
  message: string;
  tone: "ok" | "del";
  onDone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 2200);
    const t2 = setTimeout(onDone, 2200 + 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={`trn-toast${leaving ? " trn-toast-out" : ""}`} role="status">
      <span className={tone === "ok" ? "trn-toast-ic-ok" : "trn-toast-ic-del"}>
        {tone === "ok" ? <CheckCircleIcon /> : <TrashIcon />}
      </span>
      {message}
    </div>,
    document.body,
  );
}

// report status → i18n 키 매핑
const STATUS_KEY_MAP: Record<string, string> = {
  submitted: "statusSubmitted",
  reviewing: "statusReviewing",
  approved: "statusApproved",
  rejected: "statusRejected",
  changes_requested: "statusChangesRequested",
};

export function TransportStatement({
  locale,
  userName,
  organizationId,
  report,
  initialItems,
  monthKey,
  monthLabel,
  destinations,
  recentAmounts,
  linkedCandidates,
}: Props) {
  const dict = getDictionary(locale);
  const t = dict.transport;
  const localeTag = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
  const router = useRouter();

  const [items, setItems] = useState<TransportItem[]>(() => initialItems.map(mapItemRow));
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 한 번에 하나의 시트만: detail 슬라이드아웃 후 edit/delete 진입
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const intentRef = useRef<"edit" | "delete" | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "del" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = items.reduce((s, x) => s + x.amount, 0);
  const selectedItem = items.find((x) => x.id === selectedId) ?? null;

  // draft / rejected / changes_requested 상태에서 편집 허용 (보완 요청 시 수정 후 재제출)
  const isEditable =
    report.status === "draft" ||
    report.status === "rejected" ||
    report.status === "changes_requested";

  const dismissToast = useCallback(() => setToast(null), []);

  // Detail sheet 슬라이드아웃 완료 → 다음 시트 열기(또는 선택 해제)
  const handleDetailClosed = useCallback(() => {
    const intent = intentRef.current;
    intentRef.current = null;
    if (intent === "edit") setShowEdit(true);
    else if (intent === "delete") setShowDelete(true);
    else setSelectedId(null);
  }, []);

  const handleSaved = useCallback(
    (patch: Pick<TransportItem, "amount" | "context" | "memo" | "mode">) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedId
            ? {
                ...it,
                ...patch,
                missingReceipt: it.receiptCount > 0 ? undefined : it.missingReceipt,
              }
            : it,
        ),
      );
      setToast({ message: t.toastSaved, tone: "ok" });
      router.refresh();
    },
    [selectedId, t.toastSaved, router],
  );

  const handleDelete = useCallback(() => {
    const id = selectedId;
    // 확인 모달 슬라이드아웃(320ms) 후 실제 삭제 + 토스트
    setTimeout(async () => {
      if (!id) return;
      const result = await deleteTransportItemAction(id);
      setShowDelete(false);
      setSelectedId(null);
      if (result.ok) {
        setItems((prev) => prev.filter((it) => it.id !== id));
        setToast({ message: t.toastDeleted, tone: "del" });
        router.refresh();
      }
    }, 340);
  }, [selectedId, t.toastDeleted, router]);

  async function handleSubmit() {
    setSubmitting(true);
    const result = await submitTransportReportAction(monthKey);
    setSubmitting(false);
    if (!result.ok) {
      if (result.error === "missing_evidence") {
        setToast({ message: t.submitErrorMissingEvidence, tone: "del" });
      } else if (result.error === "no_items") {
        setToast({ message: t.submitErrorNoItems, tone: "del" });
      }
      return;
    }
    setToast({ message: t.submitSuccess, tone: "ok" });
    router.refresh();
  }

  // draft 이외 status 표시용 칩 라벨
  const statusKey = STATUS_KEY_MAP[report.status];
  const statusLabel = statusKey ? (t as Record<string, unknown>)[statusKey] as string : null;

  // 화이트 리디자인(2026-10-13, 시안 AttTransportM-Phone · Fold · Tablet): 제목 · 「달 · 상태」 · + 추가 → (보완 요청 · 반려면
  // 관리자 메모) → 「달 합계 · n건」 + 큰 금액 → 날짜 줄(출근지 · 영수증) → 안내 한 줄 → 제출. 태블릿 가로는 왼쪽 합계 · 제출 | 오른쪽 날짜 줄.
  // 쓰이지 않던(눌러도 아무 일 없던) 「엑셀」 버튼은 뺐다.
  void userName; // 정산서 머리의 이름 줄은 리디자인에서 뺐다(제목 · 달로 충분).
  const missingN = items.filter((x) => x.missingReceipt || x.receiptCount === 0).length;
  const sentBack = report.status === "changes_requested" || report.status === "rejected";
  const monthShort = monthLabel.replace(/^\d{4}\D*\s*/, "") || monthLabel;
  const subState = report.status === "draft" ? t.subDraft : statusLabel;

  return (
    <div className="trn trnw">
      <div className="trnw-left">
        <div className="ptitle-row trnw-title">
          <div>
            <h1 className="ptitle">{t.homeTransportTitle}</h1>
            <div className="ptitle__sub">
              {monthShort}
              {subState ? (
                <>
                  {" · "}
                  <b className={sentBack ? "is-danger" : undefined}>{subState}</b>
                </>
              ) : null}
            </div>
          </div>
          {isEditable ? (
            <button type="button" className="trnw-add" onClick={() => setShowAddSheet(true)}>
              {t.addShort}
            </button>
          ) : null}
        </div>

        {sentBack && report.reviewNote ? (
          <div className="trnw-note">
            <span>{t.reviewNoteLabel}</span>
            <p>{report.reviewNote}</p>
          </div>
        ) : null}

        <div className="trnw-total">
          <span>{t.monthTotalLine.replace("{month}", monthShort).replace("{n}", String(items.length))}</span>
          <b>{fmtYen(total)}</b>
        </div>

        <div className="trnw-actions">
          {missingN > 0 && isEditable ? (
            <p className="trnw-warn">
              <AlertTriangleIcon />
              {(sentBack ? t.missingFixLine : t.missingLine).replace("{n}", String(missingN))}
            </p>
          ) : null}
          {isEditable ? (
            <button type="button" className="trnw-submit" disabled={submitting || items.length === 0} onClick={handleSubmit}>
              {submitting ? <span className="trn-spin" /> : null}
              {sentBack ? t.resubmitBtn : t.submitMonthBtn.replace("{month}", monthShort)}
            </button>
          ) : (
            <p className="trnw-locked">{t.lockedNote}</p>
          )}
          {isEditable ? (
            <button type="button" className="trnw-add-wide" onClick={() => setShowAddSheet(true)}>
              {t.addLong}
            </button>
          ) : null}
        </div>
      </div>

      <div className="trnw-right">
        <div className="trnw-right__h">
          <b>{t.monthItems.replace("{month}", monthShort)}</b>
          {isEditable ? <span>{t.tapToEdit}</span> : null}
        </div>
        {items.length === 0 ? <p className="trnw-empty">{t.emptyItems}</p> : null}
        {items.map((item) => {
          const missing = item.missingReceipt || item.receiptCount === 0;
          return (
            <button
              type="button"
              key={item.id}
              className="trnw-line"
              onClick={() => {
                setSelectedId(item.id);
                setShowEdit(false);
                setShowDelete(false);
              }}
            >
              <span className="trnw-line__d">{shortDateLabel(item.date)}</span>
              <span className="trnw-line__b">
                <span className="trnw-line__t">{item.building}</span>
                <span className={`trnw-line__s${missing ? " is-danger" : ""}`}>
                  {item.context ? `${item.context} · ` : ""}
                  {missing ? t.badgeMissing : t.receiptN.replace("{n}", String(item.receiptCount))}
                </span>
              </span>
              <b className="trnw-line__v">{fmtYen(item.amount)}</b>
            </button>
          );
        })}
      </div>

      {showAddSheet && isEditable && (
        <AddItemSheet
          dict={dict}
          localeTag={localeTag}
          organizationId={organizationId}
          reportId={report.id}
          monthKey={monthKey}
          destinations={destinations}
          recentAmounts={recentAmounts}
          linkedCandidates={linkedCandidates}
          usedDates={new Set(items.map((i) => i.date))}
          onClose={() => setShowAddSheet(false)}
          onCreated={(item) => {
            setItems((prev) => [...prev, item]);
            router.refresh();
          }}
        />
      )}

      {/* Detail sheet — only shows when neither edit nor delete is active (one sheet at a time) */}
      {selectedItem && !showEdit && !showDelete && (
        <DetailSheet
          item={selectedItem}
          dict={dict}
          localeTag={localeTag}
          onClose={handleDetailClosed}
          onEdit={() => {
            intentRef.current = "edit";
          }}
          onDelete={() => {
            intentRef.current = "delete";
          }}
        />
      )}

      {/* Edit sheet — opens after the detail finishes sliding out */}
      {selectedItem && showEdit && isEditable && (
        <EditItemSheet
          item={selectedItem}
          dict={dict}
          localeTag={localeTag}
          organizationId={organizationId}
          reportId={report.id}
          onClose={() => {
            setShowEdit(false);
            setSelectedId(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm — opens after the detail finishes sliding out */}
      {selectedItem && showDelete && isEditable && (
        <DeleteConfirmSheet
          item={selectedItem}
          dict={dict}
          onCancel={() => {
            setShowDelete(false);
            setSelectedId(null);
          }}
          onConfirm={handleDelete}
        />
      )}

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDone={dismissToast} />
      )}
    </div>
  );
}
