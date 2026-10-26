"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CircleAlert, Copy, Ellipsis, RefreshCw } from "lucide-react";
import { createMobileInviteCode, deleteMobileInviteCode, setMobileInviteActive } from "@/app/mobile/users/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import { haptic } from "@/lib/haptics";
import { getDictionary, type Locale } from "@/lib/i18n";
import { buildInviteName, generateInviteCode } from "@/lib/invite-code-gen";
import { MobileUsersHead } from "./mobile-users-head";
import { MobileUsersToast, type UsersToast } from "./mobile-users-toast";
import "./mobile-users.css";

/**
 * 모바일 사용자 관리 — 초대코드(2026-10-20, 시안 ⑪ ~ ⑬). 대시보드 「멤버 초대」 탭과 같은 서버 본체(`src/lib/invite-codes-server.ts`).
 * 위 「새 초대코드」: 역할만 고르면 코드 · 이름 · 기한 · 횟수는 자동(「세부 설정 바꾸기」로 덮어쓰기). 아래 코드 목록: 코드(고정폭) 한 줄 +
 * 복사(누르면 「✓ 복사됨」 1.5초) + 「⋯」(끄기 · 다시 켜기 · 삭제). 만든 직후 새 코드는 맨 위에 옅은 보라.
 */

export type MobileInviteRow = {
  id: string;
  code: string;
  organizationId: string;
  role: string;
  used: number;
  max: number;
  /** live · off · used · expired */
  state: "live" | "off" | "used" | "expired";
  until: string;
  createdAt: string;
};

export type MobileInviteOrg = { id: string; name: string; codeSource: string };

type Dict = ReturnType<typeof getDictionary>;

function inviteError(code: string, dict: Dict) {
  const errors = dict.admin.settings.errors as Record<string, string>;
  return errors[code] ?? dict.admin.users.console.errSaveFailed;
}

export function MobileInvites({
  rows,
  organizations,
  roles,
  today,
  defaultCode,
  defaultExpiresAt,
  defaultMaxUses,
  memberCount,
  locale,
}: {
  rows: MobileInviteRow[];
  organizations: MobileInviteOrg[];
  roles: string[];
  today: string;
  defaultCode: string;
  defaultExpiresAt: string;
  defaultMaxUses: number;
  memberCount: number | null;
  locale: Locale;
}) {
  const router = useRouter();
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  const settings = dict.admin.settings;
  const roleLabel = (role: string) => (dict.roles as Record<string, string>)[role] ?? role;
  const [pending, startTransition] = useTransition();
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const [role, setRole] = useState(roles[0] ?? "");
  const [code, setCode] = useState(defaultCode);
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiresAt);
  const [maxUses, setMaxUses] = useState(String(defaultMaxUses));
  const [sheet, setSheet] = useState<"role" | "org" | "date" | { more: MobileInviteRow } | { del: MobileInviteRow } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  /** 지우는 중인 코드 — 서버를 기다리지 않고 줄이 바로 접힌다(줄 접힘 공용 `.row-collapse`). 실패하면 다시 펴진다. */
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<UsersToast | null>(null);
  const knownIds = useRef(new Set(rows.map((row) => row.id)));
  const show = (next: Omit<UsersToast, "id">) => {
    setToast((prev) => ({ ...next, id: (prev?.id ?? 0) + 1 }));
  };

  // 만든 직후 — 새로 나타난 코드를 맨 위에 옅은 보라로(목록은 최신 순).
  useEffect(() => {
    const added = rows.find((row) => !knownIds.current.has(row.id));
    for (const row of rows) knownIds.current.add(row.id);
    if (added) setFreshId(added.id);
  }, [rows]);

  const org = organizations.find((item) => item.id === orgId);
  const days = Math.max(0, Math.round((Date.parse(`${expiresAt}T00:00:00+09:00`) - Date.parse(`${today}T00:00:00+09:00`)) / 86_400_000));
  const expiresText = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "short", day: "numeric" }).format(new Date(`${expiresAt}T12:00:00+09:00`));
  const live = rows.filter((row) => row.state === "live").length;

  async function copy(row: MobileInviteRow) {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(row.code);
        ok = true;
      }
    } catch {
      ok = false;
    }
    haptic(ok ? "success" : "error");
    if (!ok) {
      show({ kind: "bad", text: c.wInvCopyFailed });
      return;
    }
    setCopied(row.id);
    window.setTimeout(() => setCopied((current) => (current === row.id ? null : current)), 1500);
  }

  function create() {
    startTransition(async () => {
      const result = await createMobileInviteCode({
        organizationId: orgId,
        defaultRole: role,
        code,
        name: advanced ? name : "",
        expiresAt,
        maxUses,
      });
      if (result.ok) {
        haptic("success");
        show({ kind: "done", text: c.mInvCreated });
        setCode(generateInviteCode(org?.codeSource ?? ""));
        setName("");
        router.refresh();
      } else {
        haptic("error");
        show({ kind: "bad", text: inviteError(result.error, dict) });
      }
    });
  }

  function toggle(row: MobileInviteRow) {
    const active = row.state === "off";
    startTransition(async () => {
      const result = await setMobileInviteActive({ inviteCodeId: row.id, organizationId: row.organizationId, active });
      if (result.ok) {
        haptic("success");
        show({ kind: "done", text: active ? c.mInvTurnedOn : c.mInvTurnedOff });
        router.refresh();
      } else {
        haptic("error");
        show({ kind: "bad", text: inviteError(result.error, dict) });
      }
    });
  }

  function remove(row: MobileInviteRow) {
    // 줄은 바로 접는다(2026-10-26 — 줄 접힘 공용 규칙). 서버가 실패하면 속성을 떼서 다시 편다.
    setLeavingId(row.id);
    haptic("light");
    startTransition(async () => {
      const result = await deleteMobileInviteCode({ inviteCodeId: row.id, organizationId: row.organizationId });
      if (result.ok) {
        show({ kind: "done", text: c.mInvDeleted });
        router.refresh();
      } else {
        setLeavingId((current) => (current === row.id ? null : current));
        haptic("error");
        show({ kind: "bad", text: inviteError(result.error, dict) });
      }
    });
  }

  const form = (
    <section aria-labelledby="muw-inv-new">
      <h2 className="muw-sec" id="muw-inv-new" style={{ marginTop: 18 }}>
        {c.wInvNew}
      </h2>
      <p className="muw-note">{c.mInvNewHint}</p>
      <div className="muw-form" style={{ marginTop: 6 }}>
        {organizations.length > 1 ? (
          <div className="muw-kv">
            <span>{c.mInvOrg}</span>
            <button type="button" className="val" aria-haspopup="dialog" onClick={() => setSheet("org")}>
              {org?.name ?? "—"}
              <ChevronRight className="muw-chev" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="muw-kv">
          <span>{dict.admin.users.role}</span>
          <button type="button" className="val" aria-haspopup="dialog" onClick={() => setSheet("role")}>
            {roleLabel(role)}
            <ChevronRight className="muw-chev" aria-hidden="true" />
          </button>
        </div>
        <div className="muw-kv">
          <span>{c.mInvCode}</span>
          {advanced ? (
            <input
              className="muw-input is-code muw-mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-label={c.mInvCode}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          ) : (
            <b className="muw-mono" style={{ fontSize: 17, fontWeight: 600 }}>
              {code}
            </b>
          )}
          <button
            type="button"
            className="muw-ic"
            aria-label={c.mInvRegen}
            style={{ color: "#6f6c7c", marginRight: -10 }}
            onClick={() => {
              haptic("light");
              setCode(generateInviteCode(org?.codeSource ?? ""));
            }}
          >
            <RefreshCw aria-hidden="true" style={{ width: 18, height: 18 }} />
          </button>
        </div>
        {advanced ? (
          <div className="muw-kv">
            <span>{c.mInvName}</span>
            <input
              className="muw-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={buildInviteName(settings.inviteAutoName, roleLabel(role), today)}
              aria-label={c.mInvName}
              autoComplete="off"
            />
          </div>
        ) : null}
        <div className="muw-kv">
          <span>{c.mInvExpires}</span>
          {advanced ? (
            <button type="button" className="val" aria-haspopup="dialog" onClick={() => setSheet("date")}>
              <span className="num">
                {expiresText} <span style={{ color: "#6f6c7c" }}>({c.wInvDays.replace("{n}", String(days))})</span>
              </span>
              <ChevronRight className="muw-chev" aria-hidden="true" />
            </button>
          ) : (
            <b className="num">
              {expiresText} <span style={{ color: "#6f6c7c" }}>({c.wInvDays.replace("{n}", String(days))})</span>
            </b>
          )}
        </div>
        <div className="muw-kv">
          <span>{c.mInvUses}</span>
          {advanced ? (
            <input
              className="muw-input num"
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              aria-label={c.mInvUses}
            />
          ) : (
            <b className="num">{c.wInvTimes.replace("{n}", maxUses)}</b>
          )}
        </div>
      </div>
      <button type="button" className="muw-link" aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>
        {advanced ? c.wInvAdvancedClose : c.wInvAdvanced}
      </button>
      <button type="button" className="muw-btn is-pri" style={{ width: "100%", marginTop: 4 }} disabled={pending || !orgId || !role} onClick={create}>
        {c.wInvCreate}
      </button>
    </section>
  );

  const list = (
    <section aria-labelledby="muw-inv-list">
      <h2 className="muw-gh" id="muw-inv-list" style={{ marginTop: 18 }}>
        {c.wInvCodes}
        <span className="r num">{c.wInvSummary.replace("{a}", String(live)).replace("{b}", String(rows.length - live))}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="muw-note">{c.wInvEmpty}</p>
      ) : (
        <div>
          {rows.map((row) => {
            const end = row.state !== "live";
            const isCopied = copied === row.id;
            return (
              <div key={row.id} className="muw-inv-wrap row-collapse" data-leaving={leavingId === row.id ? "" : undefined}>
              <div className={`muw-inv${end ? " is-end" : ""}${freshId === row.id ? " is-new" : ""}`}>
                <span className="muw-rb">
                  <span className="muw-rt muw-mono">{row.code}</span>
                  <span className="muw-rm num">
                    {c.mInvMeta
                      .replace("{role}", roleLabel(row.role))
                      .replace("{used}", String(row.used))
                      .replace("{max}", String(row.max))
                      .replace("{until}", row.until)
                      // 덩어리(역할 · 횟수 · 기한) 안은 줄바꿈 없는 칸 — 영어 · 일본어에서 넘치면 « · » 에서만 두 줄로.
                      .split(" · ")
                      .map((part) => part.replace(/ /g, "\u00a0"))
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className={`muw-copy${isCopied ? " is-done" : ""}`}
                  aria-label={isCopied ? c.wInvCopied : c.wInvCopy}
                  disabled={end}
                  onClick={() => copy(row)}
                >
                  {isCopied ? (
                    <>
                      <Check aria-hidden="true" strokeWidth={2.4} />
                      <span role="status">{c.wInvCopied}</span>
                    </>
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                </button>
                <button type="button" className="muw-ic muw-more" aria-label={c.mInvMore} aria-haspopup="dialog" onClick={() => setSheet({ more: row })}>
                  <Ellipsis aria-hidden="true" />
                </button>
              </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="muw">
      <MobileUsersHead active="invites" locale={locale} memberCount={memberCount} inviteCount={live} />
      {/* 만든 직후에는 목록을 위로 — 방금 만든 코드를 바로 복사하게(시안 ⑫). */}
      {freshId ? (
        <>
          {list}
          {form}
        </>
      ) : (
        <>
          {form}
          {list}
        </>
      )}

      {sheet === "role" || sheet === "org" ? (
        <BottomSheet onClose={() => setSheet(null)} ariaLabel={sheet === "role" ? c.mInvRoleSheet : c.mInvOrg}>
          {({ close }) => (
            <div className="muw-sh">
              <b>{sheet === "role" ? c.mInvRoleSheet : c.mInvOrg}</b>
              <div className="muw-opts" role="radiogroup">
                {(sheet === "role" ? roles.map((value) => ({ value, label: roleLabel(value) })) : organizations.map((item) => ({ value: item.id, label: item.name }))).map(
                  (option) => {
                    const on = sheet === "role" ? option.value === role : option.value === orgId;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className="muw-opt"
                        onClick={() => {
                          haptic("light");
                          if (sheet === "role") setRole(option.value);
                          else {
                            setOrgId(option.value);
                            setCode(generateInviteCode(organizations.find((item) => item.id === option.value)?.codeSource ?? ""));
                          }
                          setTimeout(close, 160);
                        }}
                      >
                        {option.label}
                        {on ? <Check aria-hidden="true" strokeWidth={2.4} /> : null}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {sheet === "date" ? (
        <DatePickerSheet
          value={expiresAt}
          today={today}
          locale={locale}
          labels={{ title: c.mInvExpires, prevMonth: c.datePrev, nextMonth: c.dateNext, today: c.dateToday }}
          onClose={() => setSheet(null)}
          onSelect={(date) => setExpiresAt(date < today ? today : date)}
        />
      ) : null}

      {sheet && typeof sheet === "object" && "more" in sheet ? (
        <BottomSheet onClose={() => setSheet(null)} ariaLabel={c.mInvMore}>
          {({ close }) => (
            <div className="muw-sh">
              <span className="muw-mono" style={{ textAlign: "center", fontSize: 13, color: "#6f6c7c" }}>
                {sheet.more.code} · {roleLabel(sheet.more.role)} · {sheet.more.used} / {sheet.more.max}
              </span>
              <button
                type="button"
                className="muw-btn is-soft"
                style={{ marginTop: 6, background: "#f7f7f9", color: "#16141f" }}
                disabled={pending}
                onClick={() => {
                  close();
                  toggle(sheet.more);
                }}
              >
                {sheet.more.state === "off" ? c.wInvTurnOn : c.wInvTurnOff}
              </button>
              <button
                type="button"
                className="muw-btn is-soft"
                style={{ background: "#f7f7f9", color: "#c5282e" }}
                onClick={() => {
                  const row = sheet.more;
                  close();
                  setTimeout(() => setSheet({ del: row }), 400);
                }}
              >
                {c.wInvDelete}
              </button>
              <button type="button" className="muw-btn is-ghost" onClick={close}>
                {c.cancel}
              </button>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {sheet && typeof sheet === "object" && "del" in sheet ? (
        <BottomSheet onClose={() => setSheet(null)} ariaLabel={c.wInvDeleteTitle}>
          {({ close }) => (
            <div className="muw-sh">
              <b>{c.wInvDeleteTitle}</b>
              <p>{c.wInvDeleteBody}</p>
              <span className="muw-sh__who muw-mono" style={{ fontSize: 15, fontWeight: 600 }}>
                {sheet.del.code}
              </span>
              <span className="muw-sh__warn">
                <CircleAlert aria-hidden="true" />
                {c.wDeleteWarn}
              </span>
              <button
                type="button"
                className="muw-btn is-red"
                style={{ marginTop: 6 }}
                disabled={pending}
                onClick={() => {
                  close();
                  remove(sheet.del);
                }}
              >
                {c.wInvDelete}
              </button>
              <button type="button" className="muw-btn is-ghost" onClick={close}>
                {c.wKeep}
              </button>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {toast ? <MobileUsersToast key={toast.id} toast={toast} undoLabel={c.mUndo} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
