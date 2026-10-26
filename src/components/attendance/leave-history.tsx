"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./leave.css";
import { AIc, AttIcon } from "./att-icons";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import { cancelLeaveRequestAction, deleteLeaveRequestDraftAction } from "@/app/mobile/attendance/leave/actions";
import type { LeaveRequestView } from "@/lib/annual-leave-requests-server";
import { getDictionary, type Dictionary } from "@/lib/i18n";

// L4 · 신청 내역 — 상태 필터 세그 + 이력 리스트. 행 탭 → 상세 시트(C1) → 취소 확인 시트(C2) →
// 취소 완료(C3, cancel-done 라우트). 승인 전(대기)만 취소 가능. `requests`는 page.tsx가 서버에서
// 조회해 내려준다(annual-leave-requests-server.ts). 취소는 cancelLeaveRequestAction 호출.
// draft 행만 좌스와이프로 삭제 가능(deleteLeaveRequestDraftAction) — 스와이프 물리/레이아웃은
// notification-list.tsx의 SwipeItem 패턴을 그대로 재사용(한 번에 하나만 열림, 동일 threshold/애니메이션).
// 바텀시트는 앱 공통 BottomSheet(모바일 계약)를 사용하고, 시트 콘텐츠는 `.lv-sheet` 스코프로 감싼다.

type LeaveCopy = Dictionary["leave"];
type LeaveType = "annual" | "paid" | "special" | "other";
type LeaveStatus = "requested" | "review" | "approved" | "rejected" | "draft" | "cancelled";
type Filter = "all" | "pending" | "approved" | "rejected";


function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function typeLabel(t: LeaveType, c: LeaveCopy): string {
  return t === "annual" ? c.typeAnnual : t === "paid" ? c.typePaid : t === "special" ? c.typeSpecial : c.typeOther;
}
function statusLabel(s: LeaveStatus, c: LeaveCopy): string {
  switch (s) {
    case "requested": return c.statusRequested;
    case "review": return c.statusReview;
    case "approved": return c.statusApproved;
    case "rejected": return c.statusRejected;
    case "draft": return c.statusDraft;
    case "cancelled": return c.statusCancelled;
  }
}
function matches(filter: Filter, s: LeaveStatus): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return s === "requested" || s === "review";
  if (filter === "approved") return s === "approved";
  return s === "rejected";
}
function isCancellable(s: LeaveStatus): boolean {
  return s === "requested" || s === "review";
}

// ── 행 내용 (일반 행과 스와이프 가능한 임시저장 행이 함께 쓴다) ──────────
function RowContent({ r, c, onClick }: { r: LeaveRequestView; c: LeaveCopy; onClick: () => void }) {
  const st = r.status as LeaveStatus;
  const range = r.startDate === r.endDate ? shortDate(r.startDate) : `${shortDate(r.startDate)} – ${shortDate(r.endDate)}`;
  return (
    <button type="button" className="lvw-row lvw-row--btn" onClick={onClick}>
      <span className="lvw-row__b">
        <span className="lvw-row__t">
          {typeLabel(r.leaveType as LeaveType, c)} · {r.daysCount}
          {c.unitD}
        </span>
        <span className="lvw-row__s">
          {range} · {c.submittedOn(shortDate(r.createdAt.slice(0, 10)))}
        </span>
      </span>
      <span className={`lvw-row__v is-${st}`}>{statusLabel(st, c)}</span>
    </button>
  );
}

// ── 스와이프 삭제 래퍼 — 임시저장 행 전용. 물리/레이아웃은
// 알림의 SwipeItem(src/components/notifications/notification-list.tsx)을 따른다: 한 번에 한 행만 열림,
// 76px 노출, 40px 확정 임계값, 그 외에는 원위치로 복귀. ──
const SWIPE_WIDTH = 76;
const SWIPE_COMMIT_THRESHOLD = 40;

function SwipeableDraftRow({
  r,
  c,
  onOpenEdit,
  onDelete,
  openSwipeId,
  setOpenSwipeId,
  deleting,
}: {
  r: LeaveRequestView;
  c: LeaveCopy;
  onOpenEdit: () => void;
  onDelete: () => void;
  openSwipeId: string | null;
  setOpenSwipeId: (id: string | null) => void;
  deleting: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const isOpen = openSwipeId === r.id;

  const applyTransform = useCallback((x: number, animated: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animated ? "transform 220ms cubic-bezier(0.32,0.72,0,1)" : "none";
    el.style.transform = `translateX(${x}px)`;
  }, []);

  useEffect(() => {
    if (!isOpen && currentOffsetRef.current !== 0) {
      currentOffsetRef.current = 0;
      applyTransform(0, true);
    }
  }, [isOpen, applyTransform]);

  // 스와이프로 열린 행 바깥을 탭/클릭하면 다시 닫힌다 —
  // 그 행 자체를 탭하거나 다른 행을 스와이프해 열 때만이 아니다.
  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpenSwipeId(null);
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [isOpen, setOpenSwipeId]);

  function handleTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX;
    isDraggingRef.current = true;
    applyTransform(currentOffsetRef.current, false);
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (!isDraggingRef.current) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const base = isOpen ? -SWIPE_WIDTH : 0;
    const clamped = Math.max(-SWIPE_WIDTH, Math.min(6, base + dx));
    applyTransform(clamped, false);
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const dx = e.changedTouches[0].clientX - startXRef.current;
    const base = isOpen ? -SWIPE_WIDTH : 0;
    if (base + dx < -SWIPE_COMMIT_THRESHOLD) {
      currentOffsetRef.current = -SWIPE_WIDTH;
      applyTransform(-SWIPE_WIDTH, true);
      setOpenSwipeId(r.id);
    } else {
      currentOffsetRef.current = 0;
      applyTransform(0, true);
      setOpenSwipeId(null);
    }
  }
  function handleTouchCancel() {
    isDraggingRef.current = false;
    const target = isOpen ? -SWIPE_WIDTH : 0;
    currentOffsetRef.current = target;
    applyTransform(target, true);
  }

  return (
    <div className="lswipe" ref={wrapperRef}>
      <div className="lswipe__del" aria-hidden="true">
        <button
          type="button"
          className="lswipe__delbtn"
          aria-label={c.draftSwipeDelete}
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <AIc>{AttIcon.trash}</AIc>
          <span className="lswipe__dellabel">{c.draftSwipeDelete}</span>
        </button>
      </div>
      <div
        ref={contentRef}
        className="lswipe__content"
        // 열린 줄을 오른쪽으로 밀면 줄을 닫는다 — 화면 스와이프 뒤로가기가 가져가지 않게(16-mobile-navigation).
        data-swipe-back={isOpen ? "off" : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <RowContent
          r={r}
          c={c}
          onClick={() => {
            if (isOpen) {
              setOpenSwipeId(null);
              currentOffsetRef.current = 0;
              applyTransform(0, true);
              return;
            }
            onOpenEdit();
          }}
        />
      </div>
    </div>
  );
}

export function LeaveHistory({ locale, requests }: { locale: string; requests: LeaveRequestView[] }) {
  const c: LeaveCopy = getDictionary(locale).leave;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<LeaveRequestView | null>(null);
  // 시트는 한 번에 하나만: 상세 ↔ 확인은 같은 스택이며 겹쳐 쌓이지 않는다.
  const [mode, setMode] = useState<"detail" | "confirm" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelErr, setCancelErr] = useState<null | "not_cancellable" | "generic">(null);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const rows = requests.filter((r) => matches(filter, r.status as LeaveStatus));
  const tabs: [Filter, string][] = [
    ["all", c.fAll],
    ["pending", c.fPending],
    ["approved", c.fApproved],
    ["rejected", c.fRejected],
  ];

  // 화이트 리디자인(2026-10-13, 시안 AttLeaveHistM): 제목 · 「올해 · n건」 · + 신청 → 글자 탭(건수) → 줄(종류 · 일수 / 기간 · 신청일 / 상태).
  // 카드 · 종류 아이콘 · LV 코드 · 아래 고정 버튼은 뺐다. 상세 · 취소 시트와 임시 저장 줄의 밀어서 삭제는 그대로.
  const year = new Date().getFullYear();
  return (
    <div className="lv lvw lvw--hist">
      <div className="lvw-title lvw-title--row">
        <div>
          <h1>{c.histTitle}</h1>
          <span>{c.histSub.replace("{y}", String(year)).replace("{n}", String(requests.length))}</span>
        </div>
        <Link className="lvw-addlink" href="/mobile/attendance/leave/new">
          {c.histAdd}
        </Link>
      </div>

      <div className="lvw-tabs" role="tablist">
        {tabs.map(([f, label]) => {
          const n = requests.filter((r) => matches(f, r.status as LeaveStatus)).length;
          return (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {label}
              {n > 0 ? <span>{n}</span> : null}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="lvw-empty">{c.histEmpty}</p>
      ) : (
        rows.map((r) =>
          r.status === "draft" ? (
            // 지우면 서버를 기다리지 않고 바로 접힌다(줄 접힘 공용 `.row-collapse`, 2026-10-21). 실패하면 다시 펴진다.
            <div className="lrow-outer row-collapse" data-leaving={deletingId === r.id ? "" : undefined} key={r.id}>
              <SwipeableDraftRow
                r={r}
                c={c}
                openSwipeId={openSwipeId}
                setOpenSwipeId={setOpenSwipeId}
                deleting={deletingId === r.id}
                onOpenEdit={() => router.push(`/mobile/attendance/leave/new?id=${r.id}`)}
                onDelete={async () => {
                  setDeletingId(r.id);
                  haptic("light");
                  // 액션이 revalidatePath 한다 — router.refresh() 중복 금지. 성공하면 새 목록에서 빠지므로 접힌 채로 둔다.
                  const result = await deleteLeaveRequestDraftAction(r.id).catch(() => ({ ok: false as const }));
                  if (!result.ok) {
                    haptic("error");
                    setDeletingId(null);
                  }
                }}
              />
            </div>
          ) : (
            <div className="lrow-outer" key={r.id}>
              <RowContent
                r={r}
                c={c}
                onClick={() => {
                  setSelected(r);
                  setMode("detail");
                }}
              />
            </div>
          ),
        )
      )}


      {/* C1 · 신청 상세 시트 — 승인 전이면 [신청 취소]로 같은 자리에서 확인 시트로 전환(중첩 X).
          입력칸이 없으므로 키보드 인셋 항을 빼고 하단 패딩을 조인다. */}
      {mode === "detail" && selected ? (
        <BottomSheet
          onClose={() => setMode(null)}
          className="pb-[max(16px,env(safe-area-inset-bottom))]"
        >
          {({ close }) => (
            <div className="lv-sheet">
              <div className="lsheet__h">
                <span className="lsheet__t">
                  {typeLabel(selected.leaveType as LeaveType, c)} · {selected.daysCount}
                  {c.unitD}
                </span>
              </div>
              <div className={`lvw-sheet-st is-${selected.status}`}>{statusLabel(selected.status as LeaveStatus, c)}</div>
              <div className="lsheet__recap">
                <div className="reqrow">
                  <span className="reqrow__k">{c.rPeriod}</span>
                  <span className="reqrow__v mono">
                    {selected.startDate} – {selected.endDate}
                  </span>
                </div>
                <div className="reqrow">
                  <span className="reqrow__k">{c.rDays}</span>
                  <span className="reqrow__v mono">
                    {selected.daysCount}
                    {c.unitD}
                  </span>
                </div>
                <div className="reqrow">
                  <span className="reqrow__k">{c.rType}</span>
                  <span className="reqrow__v">{typeLabel(selected.leaveType as LeaveType, c)}</span>
                </div>
                <div className="reqrow">
                  <span className="reqrow__k">{c.fApp}</span>
                  <span className="reqrow__v mono">{selected.createdAt.slice(0, 10)}</span>
                </div>
              </div>
              {isCancellable(selected.status as LeaveStatus) ? (
                <div className="lsheet__note">
                  {AttIcon.info}
                  <p>{c.cancelNote}</p>
                </div>
              ) : null}
              <div className="lsheet__btns">
                <button type="button" className="lbtn lbtn--ghost" onClick={close}>
                  {c.close}
                </button>
                {isCancellable(selected.status as LeaveStatus) ? (
                  <button type="button" className="lbtn lbtn--danger-soft" onClick={() => setMode("confirm")}>
                    <AIc>{AttIcon.ban}</AIc>
                    {c.cancelBtn}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* C2 · 취소 확인 시트 — [유지]·스크림 탭 → 자연스럽게 내려가고 상세 시트로 복귀 */}
      {mode === "confirm" && selected ? (
        <BottomSheet
          onClose={() => {
            setCancelErr(null);
            setMode("detail");
          }}
          className="pb-[max(16px,env(safe-area-inset-bottom))]"
        >
          {({ close }) => (
            <div className="lv-sheet">
              <div className="lsheet__h">
                <span className="lsheet__ic ic-danger">
                  <AIc>{AttIcon.ban}</AIc>
                </span>
                <span className="lsheet__t">{c.cancelQT}</span>
              </div>
              <p className="lsheet__lede">{c.cancelQPending}</p>
              {cancelErr ? (
                <p className="lsheet__lede" role="alert" style={{ color: "var(--danger)", marginTop: -8 }}>
                  {cancelErr === "not_cancellable" ? c.cancelNotCancellable : c.cancelFailed}
                </p>
              ) : null}
              <div className="lsheet__btns">
                <button type="button" className="lbtn lbtn--ghost" onClick={close}>
                  {c.cancelKeep}
                </button>
                <button
                  type="button"
                  className="lbtn lbtn--danger"
                  disabled={cancelling}
                  onClick={async () => {
                    setCancelling(true);
                    setCancelErr(null);
                    let result: Awaited<ReturnType<typeof cancelLeaveRequestAction>>;
                    try {
                      result = await cancelLeaveRequestAction(selected.id);
                    } catch {
                      result = { ok: false, error: "network" };
                    }
                    setCancelling(false);
                    if (!result.ok) {
                      haptic("error");
                      setCancelErr(result.error === "not_cancellable" ? "not_cancellable" : "generic");
                      return;
                    }
                    router.push(
                      `/mobile/attendance/leave/cancel-done?start=${result.startDate}&end=${result.endDate}&days=${result.daysCount}`,
                    );
                  }}
                >
                  <AIc>{AttIcon.ban}</AIc>
                  {c.cancelConfirm}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}
