"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import "./transport.css";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { ImageLightbox } from "@/components/shell/image-lightbox";
import { useBuildingName } from "@/components/shared/building-names";
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
  deleteTransportItemImageAction,
  refreshTransportReceiptUrlsAction,
  submitTransportReportAction,
} from "@/app/mobile/attendance/transport/actions";
import type {
  TransportItemRow,
  TransportReportRow,
  LinkedTransportCandidate,
} from "@/lib/transport-reimbursement";
import { haptic } from "@/lib/haptics";
import { TRANSPORT_RECEIPT_BUCKET } from "@/lib/transport-receipt-bucket";
import {
  canChangeEntryMode,
  isReceiptUrlStale,
  mergeChosenFiles,
  removeReceiptImage,
  receiptCountForm,
  receiptSlotsLeft,
  transportErrorKind,
  TRANSPORT_MAX_RECEIPTS,
} from "@/lib/transport-receipt-ui";

/** 서명 주소는 10분 — 8분 넘게 묵었으면 사진을 열기 전에 새로 받는다. */
const URL_STALE_MS = 8 * 60 * 1000;

type ReceiptImage = { id: string; url: string | null };

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
  /** 붙은 사진 — `url` 은 서버가 만든 10분짜리 서명 주소(못 받았으면 null). */
  images: ReceiptImage[];
  /** 사진 중 하나라도 주소를 못 받았다. */
  imageUrlsFailed: boolean;
  /** 주소를 받은 시각(ms) — 오래 묵었으면 열기 전에 새로 받는다. */
  urlsAt: number;
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
    images: row.images.map((img) => ({ id: img.id, url: img.signedUrl ?? null })),
    imageUrlsFailed: Boolean(row.imageUrlsFailed),
    urlsAt: Date.now(),
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
  // 확장자는 압축 결과의 MIME 에서 — 파일 이름에 점이 없거나(「사진」) 공백이 섞이면 서버 경로 검사(SAFE_FILE)에 걸린다.
  const fromMime = compressed.type.startsWith("image/") ? compressed.type.slice(6).replace("jpeg", "jpg") : "";
  const fromName = file.name.includes(".") ? (file.name.split(".").pop()?.toLowerCase() ?? "") : "";
  const ext = [fromMime, fromName].find((value) => /^[a-z0-9]{1,8}$/.test(value)) ?? "jpg";
  const filename = `${crypto.randomUUID()}.${ext}`;
  const storagePath = `${organizationId}/transport-reimbursements/${reportId}/${itemId}/${filename}`;

  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.storage
    .from(TRANSPORT_RECEIPT_BUCKET)
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
// 상세 시트 행 아이콘("05" 목업에서 가져옴)
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

/** 방 컨텍스트 "201, 202, 301" → "201 · 202 · 301" */
function roomsLabel(item: TransportItem): string {
  const raw = item.rooms ?? item.context;
  if (!raw) return "-";
  return raw.replace(/\s*,\s*/g, " · ");
}

// Tokyo 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환.
function getTodayTokyo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/** 영수증 사진 상한 — 항목마다 5장(서버 `addTransportItemImageAction` 도 같은 수로 막는다). */
const MAX_RECEIPTS = TRANSPORT_MAX_RECEIPTS;

/** 서버 오류 코드 → 이 화면 문구. 모르는 코드는 「저장하지 못했어요」. */
function errorMessage(t: Dictionary["transport"], code: string | undefined): string {
  switch (transportErrorKind(code)) {
    case "locked":
      return t.errLocked;
    case "forbidden":
      return t.errForbidden;
    case "amount":
      return t.amountRequired;
    case "memo":
      return t.destinationOtherMemoRequired;
    case "date":
      return t.errDate;
    case "entryMode":
      return t.errEntryMode;
    case "auth":
      return t.errAuth;
    case "limit":
      return t.receiptTruncated.replace("{max}", String(MAX_RECEIPTS));
    default:
      return t.saveFailed;
  }
}

function receiptCountLabel(t: Dictionary["transport"], n: number): string {
  return receiptCountForm(n) === "one" ? t.receiptOne : t.receiptN.replace("{n}", String(n));
}

/** 올린 뒤 항목의 사진 목록(주소 포함)을 새로 받는다. 못 받으면 null. */
async function fetchItemImages(itemId: string): Promise<{ images: ReceiptImage[]; failed: boolean } | null> {
  try {
    const res = await refreshTransportReceiptUrlsAction(itemId);
    if (!res.ok) return null;
    return { images: res.images.map((i) => ({ id: i.id, url: i.url })), failed: res.imageUrlsFailed };
  } catch {
    return null;
  }
}

/**
 * 고른 파일 한 장의 미리보기 — 파일마다 주소를 한 번만 만들고, 빠지면(unmount) 거둔다(`revokeObjectURL`).
 * 다른 파일이 늘거나 빠져도 이 칸은 다시 그려지지 않는다.
 */
function ChosenPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 자원(object URL)을 만들고 거두는 동기화
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element -- 고른 파일의 blob 미리보기
  return url ? <img src={url} alt="" /> : null;
}

/**
 * 붙은 사진 보기 — 썸네일 · 크게 보기 · 못 불러옴 · 다시 받기를 상세 · 수정 시트가 같이 쓴다.
 * 주소가 없거나(`url` null) 그림이 깨지면(`onError`) 「사진을 불러오지 못했어요」+ 다시 불러오기.
 */
function useReceiptViewer(
  item: TransportItem,
  onRefreshUrls: (itemId: string) => Promise<boolean>,
) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const usable = item.images.filter((img) => img.url && !broken.has(img.id));
  const hasFailed = item.imageUrlsFailed || usable.length < item.images.length;

  const refreshOnce = useCallback(async () => {
    if (refreshing) return false;
    setRefreshing(true);
    try {
      return await onRefreshUrls(item.id);
    } finally {
      setRefreshing(false);
    }
  }, [item.id, onRefreshUrls, refreshing]);

  const retry = useCallback(async () => {
    if (refreshing) return;
    haptic("light");
    const ok = await refreshOnce();
    if (ok) setBroken(new Set());
    else haptic("error");
  }, [refreshOnce, refreshing]);

  // 시트가 열릴 때 주소가 묵었으면 한 번만 새로 받는다(10분 만료) — 큰 화면을 열 때까지 기다리지 않는다.
  const autoRefreshed = useRef(false);
  useEffect(() => {
    if (autoRefreshed.current || item.images.length === 0) return;
    if (!isReceiptUrlStale(item.urlsAt, Date.now(), URL_STALE_MS)) return;
    autoRefreshed.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버에서 새 주소를 받아 오는 동기화(열릴 때 한 번)
    void refreshOnce().then((ok) => {
      if (ok) setBroken(new Set());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번
  }, []);

  const open = useCallback(
    async (imageId: string) => {
      if (refreshing) return;
      // 주소가 오래 묵었으면 먼저 새로 받는다. 못 받으면 만료된 주소로 열지 않는다.
      if (isReceiptUrlStale(item.urlsAt, Date.now(), URL_STALE_MS)) {
        const ok = await refreshOnce();
        if (!ok) {
          haptic("error");
          return;
        }
        setBroken(new Set());
      }
      setOpenIndex(Math.max(0, usable.findIndex((img) => img.id === imageId)));
    },
    [item.urlsAt, refreshOnce, refreshing, usable],
  );

  return {
    usable,
    hasFailed,
    refreshing,
    retry,
    open,
    openIndex,
    closeLightbox: () => setOpenIndex(null),
    markBroken: (id: string) => setBroken((prev) => new Set(prev).add(id)),
  };
}

/**
 * 정산서 달 안의 기본 사용일(2026-10-26). 이번 달이면 오늘, 지난달이면 그 달 말일, 다음 달이면 1일.
 * 예전에는 늘 오늘이라 지난달 정산서를 열면 이번 달 날짜가 기본으로 들어갔다(서버가 이제 달 밖 날짜를 거절한다).
 */
function defaultUsageDateForMonth(monthKey: string): string {
  const today = getTodayTokyo();
  if (today.slice(0, 7) === monthKey) return today;
  if (monthKey > today.slice(0, 7)) return `${monthKey}-01`;
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

/** 영수증 사진을 차례로 올리고 등록 — 실패한 장 수를 돌려준다(액션이 거절한 것도 실패로 센다). */
async function uploadReceipts(
  files: File[],
  organizationId: string,
  reportId: string,
  itemId: string,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const path = await uploadTransportImage(file, organizationId, reportId, itemId);
      const res = await addTransportItemImageAction(itemId, path);
      if (res.ok) ok++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

function AddItemSheet({
  dict,
  localeTag,
  organizationId,
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
  monthKey: string;
  destinations: TransportDestination[];
  recentAmounts: Record<string, { amountYen: number; usageDate: string }>;
  linkedCandidates: LinkedTransportCandidate[];
  /** 이미 교통비를 넣은 날짜 — 같은 날 두 번 넣는 실수를 눈에 띄게 한다. */
  usedDates: Set<string>;
  onClose: () => void;
  /** `reportId` — 첫 항목이면 방금 만들어진 보고서. `failedReceipts` — 올리지 못한 영수증 장 수. */
  onCreated: (item: TransportItem, meta: { reportId: string; failedReceipts: number }) => void;
}) {
  const t = dict.transport;
  const [inputMode, setInputMode] = useState<"linked" | "manual">("manual");
  const [usageDate, setUsageDate] = useState(() => defaultUsageDateForMonth(monthKey));
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showCal, setShowCal] = useState(false);
  const [amount, setAmount] = useState("");
  // 라벨이 아니라 **키**를 들고 있는다. 라벨은 로케일마다 달라서 저장·기억의 키가 될 수 없다.
  const [destinationKey, setDestinationKey] = useState("");
  const [showBuildingList, setShowBuildingList] = useState(false);
  const [memo, setMemo] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [truncated, setTruncated] = useState(false);
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
    setSaveErr(null);
    try {
      const result = await createTransportItemAction({
        targetMonth: monthKey,
        usageDate,
        amountYen: amountNum,
        entryMode: inputMode,
        attendanceSessionId: linked?.attendanceSessionId ?? null,
        cleaningSessionId: linked?.cleaningSessionId ?? null,
        propertyId: linked?.propertyId ?? destination?.propertyId ?? null,
        destinationKey: linked?.propertyId ?? (destinationKey || undefined),
        contextSummary: linked?.contextSummary || undefined,
        memo: memo.trim() || null,
      });
      if (!result.ok) {
        haptic("error");
        setSaveErr(errorMessage(t, result.error));
        setPending(false);
        return;
      }
      const itemId = result.itemId;
      // 이미지가 있으면 compress → upload → DB 등록. 경로의 보고서 id 는 서버가 돌려준 것 —
      // 첫 항목이면 화면을 열 때는 보고서가 없었다(page.tsx 는 읽기만 한다).
      const uploaded = await uploadReceipts(files.slice(0, MAX_RECEIPTS), organizationId, result.reportId, itemId);
      const receiptCount = uploaded.ok;
      // 올린 사진의 주소 — 새로 받는다(방금 올린 것은 아직 화면에 주소가 없다).
      const fresh = uploaded.ok > 0 ? await fetchItemImages(itemId) : null;
      // 항목은 저장됐지만 영수증 일부가 빠졌으면 성공이 아니라 경고(햅틱 규칙: 부분 결과 = warning).
      haptic(uploaded.failed > 0 ? "warning" : "success");
      onCreated({
        id: itemId,
        date: usageDate,
        building: linked?.buildingLabel || destination?.canonicalLabel || "",
        context: linked?.contextSummary ?? "",
        amount: amountNum,
        receiptCount,
        mode: inputMode,
        missingReceipt: receiptCount === 0,
        memo: memo.trim() || undefined,
        images: fresh?.images ?? [],
        imageUrlsFailed: uploaded.ok > 0 && (fresh === null || fresh.failed),
        urlsAt: Date.now(),
      }, { reportId: result.reportId, failedReceipts: uploaded.failed });
      onClose();
    } catch {
      haptic("error");
      setSaveErr(t.saveFailed);
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
            monthKey={monthKey}
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
              <div key={`${f.name}-${f.size}-${f.lastModified}`} className="trn-shot-wrap">
                <div className="trn-shot" title={f.name}>
                  <ChosenPreview file={f} />
                </div>
                <button
                  type="button"
                  className="trn-shot-x"
                  aria-label={t.receiptChosenRemoveAria.replace("{n}", String(i + 1))}
                  disabled={pending}
                  onClick={() => {
                    haptic("light");
                    setTruncated(false);
                    setFiles((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
            {receiptSlotsLeft(0, files.length) > 0 ? (
              <button
                type="button"
                className="trn-shot-add"
                aria-label={t.addPhoto}
                disabled={pending}
                onClick={() => fileInputRef.current?.click()}
              >
                <CameraIcon />
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              aria-hidden="true"
              tabIndex={-1}
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                // 같은 파일을 다시 골라도 change 가 오도록 비운다.
                e.target.value = "";
                if (picked.length === 0) return;
                const merged = mergeChosenFiles(0, files, picked);
                setFiles(merged.files);
                setTruncated(merged.truncated);
              }}
            />
          </div>
          {truncated ? (
            <div className="trn-shot-note" role="status">
              {t.receiptTruncated.replace("{max}", String(MAX_RECEIPTS))}
            </div>
          ) : null}
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

        {saveErr ? (
          <div className="trn-err" role="alert">
            {saveErr}
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
  onRefreshUrls,
}: {
  item: TransportItem;
  dict: Dictionary;
  localeTag: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefreshUrls: (itemId: string) => Promise<boolean>;
}) {
  const t = dict.transport;
  const buildingName = useBuildingName();
  const { full, weekday } = fmtDateParts(item.date, localeTag);
  const isLinked = item.mode === "linked";
  const memo = item.memo ?? `${buildingName(item.building)} ${t.homeTransportSub}`;
  const viewer = useReceiptViewer(item, onRefreshUrls);

  return (
    <BottomSheet onClose={onClose} className="max-h-[82dvh] flex flex-col">
      {({ close }) => (
        <div className="trn trn-detail">
          <div className="trn-detail-title">{t.detailTitle}</div>

          {/* 영수증 사진 스트립 */}
          {item.receiptCount > 0 ? (
            <div className="trn-dshots">
              {viewer.usable.map((img, i) => (
                <div key={img.id} className="trn-dshot">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 서명 주소(10분) 사진 */}
                  <img src={img.url ?? ""} alt="" onError={() => viewer.markBroken(img.id)} />
                  <button
                    type="button"
                    className="trn-dshot-open"
                    aria-label={t.receiptOpenAria.replace("{n}", String(i + 1))}
                    onClick={() => void viewer.open(img.id)}
                  />
                  <span className="trn-dshot__l">{t.receiptLabel(i + 1)}</span>
                </div>
              ))}
              {viewer.hasFailed ? (
                <div className="trn-shot-fail" role="alert">
                  {t.receiptLoadFailed}
                  <button type="button" disabled={viewer.refreshing} onClick={() => void viewer.retry()}>
                    {t.receiptRetry}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="trn-dshot-empty">{t.detailNoReceipt}</div>
          )}

          {/* 행 */}
          <DetailRow icon={<CalIcon />} label={t.fieldDate}>
            {full} ({weekday})
          </DetailRow>
          <DetailRow icon={<WonIcon />} label={t.fieldAmount} amount>
            {fmtYen(item.amount)}
          </DetailRow>
          <DetailRow icon={<BuildingIcon />} label={t.fieldBuilding}>
            {buildingName(item.building)}
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

          {/* 동작 — 먼저 상세를 밀어 내보낸 뒤 다음 시트를 연다 */}
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
          <ImageLightbox
            urls={viewer.usable.map((img) => img.url ?? "")}
            openIndex={viewer.openIndex}
            onClose={viewer.closeLightbox}
            closeLabel={dict.common.close}
          />
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
  onImagesChanged,
  onImageRemoved,
  onUrlsFailed,
  onRefreshUrls,
}: {
  item: TransportItem;
  dict: Dictionary;
  localeTag: string;
  organizationId: string;
  reportId: string;
  onClose: () => void;
  onSaved: (patch: Pick<TransportItem, "amount" | "context" | "memo" | "mode" | "receiptCount">, failedReceipts: number) => void;
  /** 사진을 지웠거나 새로 받았을 때 목록의 항목 사진을 맞춘다. */
  onImagesChanged: (itemId: string, images: ReceiptImage[], failed: boolean) => void;
  /** 지운 사진 하나만 현재 목록에서 뺀다(연달아 지워도 되살아나지 않게 부모가 최신 목록 기준으로). */
  onImageRemoved: (itemId: string, imageId: string) => void;
  /** 주소를 못 받았다고만 표시 — 사진 목록은 그대로. */
  onUrlsFailed: (itemId: string) => void;
  onRefreshUrls: (itemId: string) => Promise<boolean>;
}) {
  const t = dict.transport;
  const buildingName = useBuildingName();
  const { full, weekday } = fmtDateParts(item.date, localeTag);
  const [amount, setAmount] = useState(String(item.amount));
  const [context, setContext] = useState(item.context);
  const [memo, setMemo] = useState(item.memo ?? "");
  const [mode, setMode] = useState<"linked" | "manual">(item.mode);
  const [files, setFiles] = useState<File[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [pending, setPending] = useState(false);
  /** 화면에 보일 오류 문구(없으면 null). */
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 지우는 중인 사진 id — 바로 접히고, 서버가 거절하면 다시 펴진다. */
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const viewer = useReceiptViewer(item, onRefreshUrls);
  // 이미 붙은 영수증과 합쳐 5장까지만 더 받는다.
  const receiptRoom = Math.max(0, MAX_RECEIPTS - item.receiptCount);
  // 자동 연결 → 직접 입력만 바꿀 수 있다(서버 invalid_entry_mode).
  const canSwitchToLinked = canChangeEntryMode(item.mode, "linked");

  async function handleDeleteImage(imageId: string) {
    if (leaving.has(imageId) || pending) return;
    haptic("light");
    setErr(null);
    setLeaving((prev) => new Set(prev).add(imageId));
    let ok = false;
    try {
      const res = await deleteTransportItemImageAction(imageId);
      ok = res.ok;
      if (!res.ok) setErr(errorMessage(t, res.error) === t.saveFailed ? t.receiptDeleteFailed : errorMessage(t, res.error));
    } catch {
      setErr(t.receiptDeleteFailed);
    }
    if (ok) {
      onImageRemoved(item.id, imageId);
    } else {
      haptic("error");
    }
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(imageId);
      return next;
    });
  }

  async function handleSave(close: () => void) {
    const amountNum = parseInt(amount.replace(/[^\d]/g, ""), 10) || 0;
    // 예전에는 빈 칸이 0 으로 바뀌어 그대로 보내졌고, 서버가 거절해도 아무 말이 없었다.
    if (amountNum <= 0) {
      haptic("error");
      setErr(t.amountRequired);
      return;
    }
    setErr(null);
    setPending(true);
    try {
      const result = await updateTransportItemAction({
        itemId: item.id,
        amountYen: amountNum,
        memo: memo.trim() || null,
        contextSummary: context.trim() || undefined,
        entryMode: mode,
      });
      if (!result.ok) {
        haptic("error");
        // 서버가 입력 방식을 거절하면 화면도 저장된 값으로 되돌린다.
        if (transportErrorKind(result.error) === "entryMode") setMode(item.mode);
        setErr(errorMessage(t, result.error));
        setPending(false);
        return;
      }
      // 새 이미지 추가 — 일부가 빠지면 저장은 됐어도 경고.
      const uploaded = await uploadReceipts(files.slice(0, receiptRoom), organizationId, reportId, item.id);
      if (uploaded.ok > 0) {
        const fresh = await fetchItemImages(item.id);
        if (fresh) onImagesChanged(item.id, fresh.images, fresh.failed);
        else onUrlsFailed(item.id);
      }
      haptic(uploaded.failed > 0 ? "warning" : "success");
      onSaved(
        { amount: amountNum, context: context.trim(), memo: memo.trim(), mode, receiptCount: item.receiptCount + uploaded.ok },
        uploaded.failed,
      );
      close();
    } catch {
      haptic("error");
      setErr(t.saveFailed);
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
              {buildingName(item.building)} <ChevDownIcon />
            </div>
          </div>
          <div className="trn-tf">
            <div className="trn-tf-l">{t.detailRoom}</div>
            <div className="trn-tf-in">
              <input
                className="trn-input"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                // 연결 항목의 「건물 · 방」은 서버가 연결 기록에서 정한다 — 직접 입력으로 바꾸면 고칠 수 있다(2026-11-25).
                readOnly={mode === "linked"}
                placeholder="201, 202"
                aria-label={t.fieldContext}
              />
            </div>
          </div>
        </div>

        <div className="trn-tf">
          <div className="trn-tf-l">{t.fieldReceipt}</div>
          <div className="trn-shots">
            {item.images.map((img, i) => {
              const bad = !img.url || !viewer.usable.some((u) => u.id === img.id);
              return (
                <div key={img.id} className="trn-shot-wrap" data-leaving={leaving.has(img.id) ? "" : undefined}>
                  <div className="trn-shot">
                    {bad ? null : (
                      // eslint-disable-next-line @next/next/no-img-element -- 서명 주소(10분) 사진
                      <img src={img.url ?? ""} alt="" onError={() => viewer.markBroken(img.id)} />
                    )}
                    {bad ? null : (
                      <button
                        type="button"
                        className="trn-shot-open"
                        aria-label={t.receiptOpenAria.replace("{n}", String(i + 1))}
                        onClick={() => void viewer.open(img.id)}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className="trn-shot-x"
                    aria-label={t.receiptRemoveAria.replace("{n}", String(i + 1))}
                    disabled={pending || leaving.has(img.id)}
                    onClick={() => void handleDeleteImage(img.id)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {files.map((f, i) => (
              <div key={`${f.name}-${f.size}-${f.lastModified}`} className="trn-shot-wrap">
                <div className="trn-shot" title={f.name}>
                  <ChosenPreview file={f} />
                </div>
                <button
                  type="button"
                  className="trn-shot-x"
                  aria-label={t.receiptChosenRemoveAria.replace("{n}", String(i + 1))}
                  disabled={pending}
                  onClick={() => {
                    haptic("light");
                    setTruncated(false);
                    setFiles((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
            {receiptSlotsLeft(item.receiptCount, files.length) > 0 ? (
              <button
                type="button"
                className="trn-shot-add"
                aria-label={t.addPhoto}
                disabled={pending}
                onClick={() => fileInputRef.current?.click()}
              >
                <CameraIcon />
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              aria-hidden="true"
              tabIndex={-1}
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (picked.length === 0) return;
                const merged = mergeChosenFiles(item.receiptCount, files, picked);
                setFiles(merged.files);
                setTruncated(merged.truncated);
              }}
            />
          </div>
          {truncated ? (
            <div className="trn-shot-note" role="status">
              {t.receiptTruncated.replace("{max}", String(MAX_RECEIPTS))}
            </div>
          ) : null}
          {viewer.hasFailed && item.images.length > 0 ? (
            <div className="trn-shot-fail trn-shot-fail--wide" role="alert">
              {t.receiptLoadFailed}
              <button type="button" disabled={viewer.refreshing} onClick={() => void viewer.retry()}>
                {t.receiptRetry}
              </button>
            </div>
          ) : null}
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
              disabled={!canSwitchToLinked}
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
          {!canSwitchToLinked ? <div className="trn-shot-note">{t.modeLockedHint}</div> : null}
        </div>

        {err ? (
          <div className="trn-err" role="alert">
            {err}
          </div>
        ) : null}
        <button
          type="button"
          className="trn-add-submit"
          disabled={pending}
          onClick={() => handleSave(close)}
        >
          {pending ? <span className="trn-spin" /> : null}
          {t.editSheetSubmit}
        </button>
        <ImageLightbox
          urls={viewer.usable.map((img) => img.url ?? "")}
          openIndex={viewer.openIndex}
          onClose={viewer.closeLightbox}
          closeLabel={dict.common.close}
        />
      </div>
      )}
    </BottomSheet>
  );
}

/** 삭제 확인 — 가운데 정렬 알럿 모달(BottomSheet 의 의도된 예외). */
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
  const buildingName = useBuildingName();
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
              {shortDateLabel(item.date)} · {buildingName(item.building)}
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

/** 가벼운 동작 피드백 토스트(자동으로 사라짐). */
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
  const buildingName = useBuildingName();
  const localeTag = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";

  const [items, setItems] = useState<TransportItem[]>(() => initialItems.map(mapItemRow));
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 한 번에 하나의 시트만: detail 슬라이드아웃 후 edit/delete 진입
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const intentRef = useRef<"edit" | "delete" | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "del" } | null>(null);
  /** 지우는 중인 줄 — 서버 응답 전에 접혀 있다. */
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 첫 항목을 넣으면서 서버가 만든 보고서 id. 화면을 열 때 보고서가 없으면 report.id 는 빈 값이다(page.tsx).
  const [createdReportId, setCreatedReportId] = useState<string | null>(null);
  const reportId = report.id || createdReportId || "";

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

  /** 사진 목록 · 주소를 항목에 맞춘다(지움 · 올림 · 새로 받음). */
  const handleImagesChanged = useCallback((itemId: string, images: ReceiptImage[], failed: boolean) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              images,
              imageUrlsFailed: failed,
              urlsAt: Date.now(),
              receiptCount: images.length,
              missingReceipt: images.length === 0,
            }
          : it,
      ),
    );
  }, []);

  const handleImageRemoved = useCallback((itemId: string, imageId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const images = removeReceiptImage(it.images, imageId);
        return { ...it, images, receiptCount: images.length, missingReceipt: images.length === 0 };
      }),
    );
  }, []);

  const handleUrlsFailed = useCallback((itemId: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, imageUrlsFailed: true } : it)));
  }, []);

  /** 서명 주소를 새로 받는다. 성공하면 true. */
  const handleRefreshUrls = useCallback(
    async (itemId: string) => {
      const fresh = await fetchItemImages(itemId);
      if (!fresh) return false;
      handleImagesChanged(itemId, fresh.images, fresh.failed);
      return !fresh.failed;
    },
    [handleImagesChanged],
  );

  const handleSaved = useCallback(
    (patch: Pick<TransportItem, "amount" | "context" | "memo" | "mode" | "receiptCount">, failedReceipts: number) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedId
            ? {
                ...it,
                ...patch,
                missingReceipt: patch.receiptCount > 0 ? undefined : it.missingReceipt,
              }
            : it,
        ),
      );
      // 액션이 revalidatePath — refresh 중복 금지
      setToast(
        failedReceipts > 0
          ? { message: t.receiptUploadPartial.replace("{n}", String(failedReceipts)), tone: "del" }
          : { message: t.toastSaved, tone: "ok" },
      );
    },
    [selectedId, t.toastSaved, t.receiptUploadPartial],
  );

  const handleDelete = useCallback(() => {
    const id = selectedId;
    // 확인 모달 슬라이드아웃(320ms) 후 — 줄을 **먼저 접고** 서버를 기다린다(줄 접힘 공용 `.row-collapse`, 2026-11-11).
    // 실패하면 다시 펴고 토스트로 알린다(예전: 실패해도 아무 말이 없었다).
    setTimeout(async () => {
      if (!id) return;
      setShowDelete(false);
      setSelectedId(null);
      setLeavingId(id);
      haptic("light");
      let ok = false;
      try {
        ok = (await deleteTransportItemAction(id)).ok;
      } catch {
        ok = false;
      }
      if (ok) {
        setItems((prev) => prev.filter((it) => it.id !== id));
        setToast({ message: t.toastDeleted, tone: "del" });
      } else {
        haptic("error");
        setToast({ message: t.toastDeleteFailed, tone: "del" });
      }
      setLeavingId((cur) => (cur === id ? null : cur));
    }, 340);
  }, [selectedId, t.toastDeleted, t.toastDeleteFailed]);

  async function handleSubmit() {
    setSubmitting(true);
    let result: Awaited<ReturnType<typeof submitTransportReportAction>>;
    try {
      result = await submitTransportReportAction(monthKey);
    } catch {
      result = { ok: false, error: "submit_failed" };
    }
    setSubmitting(false);
    if (!result.ok) {
      haptic("error");
      // 예전에는 증빙 누락 · 항목 없음 말고는(이미 제출됨 · 저장 실패) 아무 말이 없었다.
      const message =
        result.error === "missing_evidence"
          ? t.submitErrorMissingEvidence
          : result.error === "no_items" || result.error === "no_report"
            ? t.submitErrorNoItems
            : result.error === "report_not_editable"
              ? t.submitErrorLocked
              : t.submitErrorFailed;
      setToast({ message, tone: "del" });
      return;
    }
    haptic("success");
    setToast({ message: t.submitSuccess, tone: "ok" });
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
              <Plus aria-hidden="true" />
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
            <button type="button" className={`trnw-submit${submitting ? " is-busy" : ""}`} disabled={submitting || items.length === 0} onClick={handleSubmit}>
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
            <div className="row-collapse" key={item.id} data-leaving={leavingId === item.id ? "" : undefined}>
            <button
              type="button"
              className="trnw-line"
              onClick={() => {
                setSelectedId(item.id);
                setShowEdit(false);
                setShowDelete(false);
              }}
            >
              <span className="trnw-line__d">{shortDateLabel(item.date)}</span>
              <span className="trnw-line__b">
                <span className="trnw-line__t">{buildingName(item.building)}</span>
                <span className={`trnw-line__s${missing ? " is-danger" : ""}`}>
                  {item.context ? `${item.context} · ` : ""}
                  {missing ? t.badgeMissing : receiptCountLabel(t, item.receiptCount)}
                </span>
              </span>
              <b className="trnw-line__v">{fmtYen(item.amount)}</b>
            </button>
            </div>
          );
        })}
      </div>

      {showAddSheet && isEditable && (
        <AddItemSheet
          dict={dict}
          localeTag={localeTag}
          organizationId={organizationId}
          monthKey={monthKey}
          destinations={destinations}
          recentAmounts={recentAmounts}
          linkedCandidates={linkedCandidates}
          usedDates={new Set(items.map((i) => i.date))}
          onClose={() => setShowAddSheet(false)}
          onCreated={(item, meta) => {
            setItems((prev) => [...prev, item]);
            if (!report.id) setCreatedReportId(meta.reportId);
            if (meta.failedReceipts > 0) {
              setToast({ message: t.receiptUploadPartial.replace("{n}", String(meta.failedReceipts)), tone: "del" });
            }
          }}
        />
      )}

      {/* 상세 시트 — 수정도 삭제도 활성이 아닐 때만 표시(한 번에 시트 하나) */}
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
          onRefreshUrls={handleRefreshUrls}
        />
      )}

      {/* 수정 시트 — 상세가 밀려 나간 뒤에 열린다 */}
      {selectedItem && showEdit && isEditable && (
        <EditItemSheet
          item={selectedItem}
          dict={dict}
          localeTag={localeTag}
          organizationId={organizationId}
          reportId={reportId}
          onClose={() => {
            setShowEdit(false);
            setSelectedId(null);
          }}
          onSaved={handleSaved}
          onImagesChanged={handleImagesChanged}
          onImageRemoved={handleImageRemoved}
          onUrlsFailed={handleUrlsFailed}
          onRefreshUrls={handleRefreshUrls}
        />
      )}

      {/* 삭제 확인 — 상세가 밀려 나간 뒤에 열린다 */}
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
