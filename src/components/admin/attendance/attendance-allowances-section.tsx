"use client";

// Admin · Attendance · 추가수당 (attendance allowance) management section.
// Lives inside /admin/attendance/wages (no separate tab, per the MVP design). Privileged create/cancel
// of busy-day / short-staffed-day extra pay for a specific Tokyo operating date. Base rates in
// hourly_rate_history are never touched here. All writes go through service-role server actions that
// also block changes to an already-finalized user-month.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, Plus, Sparkles } from "lucide-react";
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
  defaultDate: string; // today (Tokyo)
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
        {/* 폼이 열려 있으면 위쪽 닫기는 두지 않는다 — 폼 아래 「닫기」 하나(2026-10-13 제보: 닫기 중복). */}
        {formOpen ? null : (
          <button type="button" className="btn btn--pri btn--sm" onClick={() => setFormOpen(true)}>
            {c.allowAddBtn}
          </button>
        )}
      </div>

      {formOpen ? (
        <div className="alw__form">
          <div className="wreason">
            <div className="wfield__l">{c.allowFieldType}</div>
            <div className="fseg" role="tablist">
              <button
                type="button"
                className={type === "daily_fixed" ? "on" : ""}
                onClick={() => setType("daily_fixed")}
              >
                {c.allowTypeDailyFixed}
              </button>
              <button
                type="button"
                className={type === "hourly_extra" ? "on" : ""}
                onClick={() => setType("hourly_extra")}
              >
                {c.allowTypeHourlyExtra}
              </button>
            </div>
          </div>

          <div className="wreason">
            <div className="wfield__l">{c.allowFieldScope}</div>
            <div className="fseg" role="tablist">
              <button
                type="button"
                className={scope === "all" ? "on" : ""}
                onClick={() => setScope("all")}
              >
                {c.allowScopeAll}
              </button>
              <button
                type="button"
                className={scope === "user" ? "on" : ""}
                onClick={() => setScope("user")}
              >
                {c.allowScopeUser}
              </button>
            </div>
          </div>

          <div className="wreason">
            <div className="wfield__l">{c.allowFieldAmount}</div>
            <div className="winp">
              <span className="yen">{c.yenSym}</span>
              <input
                type="number"
                inputMode="numeric"
                step={10}
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="alw__unit">{amountUnit}</div>
          </div>

          <div className="wreason">
            <div className="wfield__l">{c.allowFieldDate}</div>
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

          <div className="wreason">
            <div className="wfield__l">{c.allowFieldCategory}</div>
            <AdmDropdown
              value={category}
              onChange={(v) => setCategory(v as Category)}
              options={CATEGORIES.map((cat) => ({ value: cat, label: categoryLabel(cat, c) }))}
              ariaLabel={c.allowFieldCategory}
            />
          </div>

          {scope === "user" ? (
            <div className="wreason">
              <div className="wfield__l">{c.allowFieldUser}</div>
              <AdmDropdown
                value={targetUserId}
                onChange={setTargetUserId}
                options={staff.map((s) => ({ value: s.userId, label: s.userName }))}
                placeholder={c.allowUserPlaceholder}
                ariaLabel={c.allowFieldUser}
              />
            </div>
          ) : null}

          <div className={scope === "user" ? "wreason alw__span2" : "wreason alw__span3"}>
            <div className="wfield__l">{c.allowFieldMemo}</div>
            <input
              type="text"
              placeholder={c.allowMemoPlaceholder}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          <div className="alw__note alw__spanfull">
            <Ic>
              <Info />
            </Ic>
            <span>{c.allowFormNote}</span>
          </div>

          {err ? (
            <div className="errbar is-warn alw__spanfull" style={{ margin: 0 }}>
              <span className="errbar__ic">
                <Ic>
                  <CircleAlert />
                </Ic>
              </span>
              <div>
                <div className="errbar__t">{err}</div>
              </div>
            </div>
          ) : null}

          <div className="alw__formfoot alw__spanfull">
            <button
              type="button"
              className="btn btn--subtle"
              onClick={() => {
                setFormOpen(false);
                resetForm();
              }}
              disabled={pending}
            >
              {c.allowFormClose}
            </button>
            <button type="button" className="btn btn--pri" onClick={submitCreate} disabled={pending}>
              <Ic>
                <Plus />
              </Ic>
              {c.allowSave}
            </button>
          </div>
        </div>
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
