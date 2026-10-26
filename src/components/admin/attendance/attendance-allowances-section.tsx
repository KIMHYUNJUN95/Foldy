"use client";

// Admin · Attendance · 추가수당 (attendance allowance) management section.
// /admin/attendance/wages 안에 있다(MVP 디자인대로 별도 탭 없음). 특정 도쿄 운영일의 바쁜 날 / 인력 부족일
// 추가 수당을 권한자가 등록/취소한다. hourly_rate_history 의 기본 시급은 여기서
// 절대 건드리지 않는다. 모든 쓰기는 service-role 서버 액션을 거치며,
// 이미 마감된 사용자-월에 대한 변경도 막는다.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import type { AdminAllowanceRow } from "@/lib/admin-attendance";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import {
  createAttendanceAllowance,
  cancelAttendanceAllowance,
} from "@/app/admin/attendance/actions";
import { AdminDatePicker } from "../shared/admin-date-picker";
import { AdminReasonModal } from "../shared/admin-reason-modal";
import { AdmDropdown } from "../shared/adm-dropdown";
import { AdminToast, useAdminToast } from "../shared/admin-toast";
import { formatAdminYen } from "../shared/admin-format";

type Att = Dictionary["admin"]["attendanceConsole"];
type AllowanceType = "daily_fixed" | "hourly_extra";
type Category = "regular" | "special";
const CATEGORIES: Category[] = ["regular", "special"];

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function typeLabel(t: AllowanceType, c: Att): string {
  return t === "hourly_extra" ? c.allowTypeHourlyExtra : c.allowTypeDailyFixed;
}
function categoryLabel(cat: string, c: Att): string {
  return cat === "special" ? c.allowCatSpecial : c.allowCatRegular;
}

export function AttendanceAllowancesSection({
  allowances,
  staff,
  defaultDate,
  locale,
  localeTag,
}: {
  allowances: AdminAllowanceRow[];
  staff: { userId: string; userName: string }[];
  defaultDate: string; // 오늘(도쿄)
  locale: Locale;
  localeTag: string;
}) {
  const c = getDictionary(locale).admin.attendanceConsole;
  const router = useRouter();
  const [pending, start] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<AllowanceType>("daily_fixed");
  const [scope, setScope] = useState<"all" | "user">("all");
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("regular");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const { toast, showToast, dismiss } = useAdminToast();

  function resetForm() {
    setType("daily_fixed");
    setScope("all");
    setTargetUserId("");
    setDate(defaultDate);
    setAmount("");
    setCategory("regular");
    setMemo("");
    setErr(null);
  }

  function errText(reason: string): string {
    switch (reason) {
      case "forbidden":
        return c.allowErrForbidden;
      case "finalized":
        return c.allowErrFinalized;
      case "amount_required":
        return c.allowErrAmount;
      case "target_invalid":
        return c.allowErrTarget;
      default:
        return c.allowErrGeneric;
    }
  }

  function submitCreate() {
    setErr(null);
    const amountYen = Number(amount);
    if (!Number.isFinite(amountYen) || amountYen <= 0) {
      setErr(c.allowErrAmount);
      return;
    }
    if (scope === "user" && !targetUserId) {
      setErr(c.allowErrTarget);
      return;
    }
    start(async () => {
      const res = await createAttendanceAllowance({
        targetDate: date,
        targetUserId: scope === "user" ? targetUserId : null,
        allowanceType: type,
        amountYen,
        category,
        memo: memo.trim() ? memo.trim() : null,
      });
      if (!res.ok) {
        setErr(errText(res.reason));
        return;
      }
      setFormOpen(false);
      resetForm();
      showToast(c.allowCreated);
      router.refresh();
    });
  }

  function submitCancel(reason: string) {
    if (!cancelId) return;
    const id = cancelId;
    start(async () => {
      const res = await cancelAttendanceAllowance({ id, reason: reason || null });
      if (!res.ok) {
        setErr(errText(res.reason));
        setCancelId(null);
        showToast(errText(res.reason));
        return;
      }
      setCancelId(null);
      showToast(c.allowCancelled);
      router.refresh();
    });
  }

  const amountUnit = type === "hourly_extra" ? c.allowAmountUnitHourly : c.allowAmountUnitDaily;

  return (
    // 화이트 리디자인(2026-10-13, 시안 AttRate-PC): 카드 · 아이콘 배지 · 배지 묶음 대신 제목 + 설명 + 버튼, 표 줄(날짜 · 직원 · 메모 · 방식 · 금액 · 취소).
    <section className="alw alw--w">
      <div className="alw__head">
        <div className="alw__headl">
          <div>
            <div className="alw__title">{c.allowSecTitle}</div>
            <div className="alw__sub">{c.allowSecDesc}</div>
          </div>
        </div>
        <button type="button" className="btn btn--pri btn--sm" onClick={() => setFormOpen(true)}>
          {c.allowAddBtn}
        </button>
      </div>

      {/* 입력은 오른쪽 패널에서 위아래로(2026-10-13 시안 AttAllowAdd-PC — 화면 폭 전체 폼이 길쭉하다는 지적). 닫기는 위 × 하나. */}
      {formOpen ? (
        <>
          <div className="panel-scrim on" onClick={() => (pending ? undefined : (setFormOpen(false), resetForm()))} />
          <aside className="panel on alw-panel" role="dialog" aria-label={c.allowAddBtn}>
            <div className="panel__h">
              <div className="panel__top">
                <span className="panel__kicker">{c.allowSecTitle}</span>
                <button
                  type="button"
                  className="panel__x"
                  aria-label={c.allowFormClose}
                  disabled={pending}
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                >
                  <Ic>
                    <X />
                  </Ic>
                </button>
              </div>
              <div className="panel__title alw-panel__title">
                <b>{c.allowAddBtn}</b>
                <span className="panel__sub">{c.allowPanelSub}</span>
              </div>
            </div>

            <div className="panel__body alw-panel__body">
              <div className="anf">
                <span className="anf__l">{c.allowFieldDate}</span>
                <AdminDatePicker
                  value={date}
                  onChange={setDate}
                  localeTag={localeTag}
                  ariaLabel={c.allowFieldDate}
                  labels={{
                    prevMonth: c.datePickerPrevMonth,
                    nextMonth: c.datePickerNextMonth,
                    today: c.datePickerToday,
                  }}
                />
              </div>

              <div className="alw-q">{c.allowFieldScope}</div>
              <div className="fseg alw-seg" role="tablist">
                <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
                  {c.allowScopeAll}
                </button>
                <button type="button" className={scope === "user" ? "on" : ""} onClick={() => setScope("user")}>
                  {c.allowScopeUser}
                </button>
              </div>
              {scope === "user" ? (
                <div className="anf">
                  <span className="anf__l">{c.allowFieldUser}</span>
                  <AdmDropdown
                    value={targetUserId}
                    onChange={setTargetUserId}
                    options={staff.map((x) => ({ value: x.userId, label: x.userName }))}
                    placeholder={c.allowUserPlaceholder}
                    ariaLabel={c.allowFieldUser}
                    searchable={staff.length > 8}
                    wide
                  />
                </div>
              ) : null}

              <div className="alw-q">{c.allowFieldCategory}</div>
              <div className="fseg alw-seg" role="tablist">
                {CATEGORIES.map((cat) => (
                  <button key={cat} type="button" className={category === cat ? "on" : ""} onClick={() => setCategory(cat)}>
                    {categoryLabel(cat, c)}
                  </button>
                ))}
              </div>

              <div className="alw-q">{c.allowFieldType}</div>
              <div className="fseg alw-seg" role="tablist">
                <button type="button" className={type === "daily_fixed" ? "on" : ""} onClick={() => setType("daily_fixed")}>
                  {c.allowTypeDailyFixed}
                </button>
                <button type="button" className={type === "hourly_extra" ? "on" : ""} onClick={() => setType("hourly_extra")}>
                  {c.allowTypeHourlyExtra}
                </button>
              </div>

              <label className="anf">
                <span className="anf__l">
                  {c.allowFieldAmount} · {amountUnit}
                </span>
                <span className="anf__in">
                  <span className="anf__yen">{c.yenSym}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={10}
                    min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </span>
              </label>

              <label className="anf">
                <span className="anf__l">{c.allowFieldMemo}</span>
                <span className="anf__in">
                  <input type="text" placeholder={c.allowMemoPlaceholder} value={memo} onChange={(e) => setMemo(e.target.value)} />
                </span>
              </label>

              <p className="alw-note">{c.allowFormNote}</p>
              {err ? (
                <p className="alw-err" role="alert">
                  {err}
                </p>
              ) : null}
            </div>

            <div className="panel__foot">
              <button type="button" className="btn btn--pri alw-save" onClick={submitCreate} disabled={pending}>
                {c.allowSave}
              </button>
            </div>
          </aside>
        </>
      ) : null}

      {allowances.length === 0 ? (
        <div className="alw__empty">
          <span className="alw__emptyic">
            <Ic>
              <Sparkles />
            </Ic>
          </span>
          <span>{c.allowEmpty}</span>
        </div>
      ) : (
        <table className="qtbl alw-tbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>{c.allowFieldDate}</th>
              <th>{c.allowFieldUser}</th>
              <th>{c.allowFieldType}</th>
              <th className="r">{c.allowFieldAmount}</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {allowances.map((a) => {
              const cancelled = a.status === "cancelled";
              return (
                <tr key={a.id} className={cancelled ? "is-cancelled" : undefined}>
                  <td style={{ paddingLeft: 16 }}>
                    <b>{a.targetDateLabel}</b>
                  </td>
                  <td>
                    <b>{a.targetUserName ?? c.allowScopeAll}</b>
                    {a.memo ? <span className="alw-memo"> · {a.memo}</span> : null}
                  </td>
                  <td>
                    {categoryLabel(a.category, c)} · {typeLabel(a.allowanceType, c)}
                  </td>
                  <td className="r num">
                    <b>
                      {c.yenSym}
                      {formatAdminYen(a.amountYen, localeTag)}
                      {a.allowanceType === "hourly_extra" ? c.allowPerHourSuffix : ""}
                    </b>
                  </td>
                  <td className="r alw-act">
                    {cancelled ? (
                      <span className="dim-cell">{c.allowStatusCancelled}</span>
                    ) : (
                      <button type="button" className="alw-cancel" onClick={() => setCancelId(a.id)} disabled={pending}>
                        {c.allowCancelBtn}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {cancelId ? (
        <AdminReasonModal
          title={c.allowCancelTitle}
          description={c.allowCancelDesc}
          placeholder={c.dialogReasonPlaceholder}
          // 버튼 둘 다 「취소」라 헷갈려서(2026-10-13 제보) — 「그대로 두기 · 추가수당 취소」.
          confirmLabel={c.allowCancelTitle}
          cancelLabel={c.allowCancelKeep}
          pending={pending}
          danger
          onConfirm={submitCancel}
          onCancel={() => setCancelId(null)}
        />
      ) : null}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </section>
  );
}
