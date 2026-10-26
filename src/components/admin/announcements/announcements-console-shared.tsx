"use client";

// Admin 공지 관리 콘솔 — 목록, 상세
// 패널, 폼 / 확인 / 읽음 모달에서 함께 쓰는 공용 요소 + 포매터. Claude Design 핸드오프에서 가져옴
// (announce-views.js 공용 요소). docs/product/11-announcement-workflow.md 참고.
import type { ReactNode } from "react";
import {
  Archive,
  Image as ImageIcon,
  Megaphone,
  Pin,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import type { AnnouncementConsoleDictionary } from "@/lib/announcement-i18n";
import type { Locale } from "@/lib/i18n";
import type { OrganizationRole } from "@/config/roles";
import type { AdminAnnouncementVM } from "@/lib/admin-announcements";

export type AnnCopy = AnnouncementConsoleDictionary;
export type RoleLabel = (role: OrganizationRole) => string;
export type AnnStatus = "draft" | "published" | "archived";

const AVATAR_PALETTE = [
  "var(--adm-primary)",
  "#3f7d5a",
  "#9c5a2c",
  "#6b5aa8",
  "#2f7d63",
  "#b5564d",
];

export function Ic({ children }: { children: ReactNode }) {
  return <span className="ic">{children}</span>;
}

export function tpl(text: string, value: number | string): string {
  return text.replace(/\{[a-z]\}/i, String(value));
}

export function tpl2(
  text: string,
  a: number | string,
  b: number | string,
): string {
  return text.replace("{d}", String(a)).replace("{r}", String(b));
}

export function avatarColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length]!;
}

export function initial(name: string): string {
  return (name || "?").trim().charAt(0) || "?";
}

// ── 도쿄 운영 시각 포매터 ─────────────────────────────────────
// 공지 행의 모든 타임스탬프(`published_at` / `archived_at` /
// `popup_until` / `updated_at`)는 UTC 시점으로 저장된다. 모바일 화면은
// 이를 Asia/Tokyo 기준으로 그리고 묶는다(docs/product/11-announcement-workflow.md
// → "공지는 Tokyo 시간 기준 published_at 날짜로 그룹핑된다"), 관리자 콘솔도
// 똑같이 해야 한다 — 원본 ISO 문자열을 자르면 UTC 시계가 보여서
// JST 09:00 이전에 게시된 것은 하루가 통째로 어긋난다.
// `src/lib/admin-orders.ts` 의 `tokyoDateKey` / `tokyoStamp` 와 같은 패턴.
const TOKYO_TZ = "Asia/Tokyo";

type TokyoParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

function tokyoParts(iso: string): TokyoParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // 일부 ICU 빌드는 hour12:false 에서 자정을 "24" 로 내보낸다 — 보정한다.
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

/** 도쿄 기준 "YYYY-MM-DD". 저장된 UTC 시점으로 날짜 입력을 채울 때 쓴다. */
export function tokyoDateKey(iso: string | null): string {
  const parts = iso ? tokyoParts(iso) : null;
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

/** 도쿄 기준 "HH:mm"(24시간). 저장된 UTC 시점으로 시간 입력을 채울 때 쓴다. */
export function tokyoTimeHm(iso: string | null): string {
  const parts = iso ? tokyoParts(iso) : null;
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

/** 도쿄 기준 "M.DD" — 촘촘한 목록 열의 날짜. */
export function fmtDateShort(iso: string | null): string {
  const parts = iso ? tokyoParts(iso) : null;
  if (!parts) return "—";
  return `${Number(parts.month)}.${parts.day}`;
}

export function fmtDateLong(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: TOKYO_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** 도쿄 기준 "M.DD HH:mm". */
export function fmtDateTime(iso: string | null): string {
  const parts = iso ? tokyoParts(iso) : null;
  if (!parts) return "—";
  return `${Number(parts.month)}.${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 도쿄 기준 "YYYY-MM-DD HH:mm" — 상세 패널의 고정폭 스탬프. */
export function fmtStamp(iso: string | null): string {
  const parts = iso ? tokyoParts(iso) : null;
  if (!parts) return "—";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function targetLabel(
  a: Pick<AdminAnnouncementVM, "targetScope" | "targetRoles">,
  t: AnnCopy,
  roleLabel: RoleLabel,
): string {
  if (a.targetScope === "everyone") return t.everyone;
  const names = a.targetRoles.map(roleLabel);
  if (names.length <= 2) return names.join(" · ");
  return `${names[0]} ${tpl(t.targetMore, names.length - 1)}`;
}

const STATUS_META: Record<AnnStatus, { icon: ReactNode; cls: string }> = {
  draft: { icon: <Sparkles aria-hidden="true" />, cls: "draft" },
  published: { icon: <Megaphone aria-hidden="true" />, cls: "published" },
  archived: { icon: <Archive aria-hidden="true" />, cls: "archived" },
};

export function StatusPill({ status, t }: { status: AnnStatus; t: AnnCopy }) {
  const meta = STATUS_META[status];
  const label =
    status === "draft" ? t.stDraft : status === "published" ? t.stPublished : t.stArchived;
  return (
    <span className={`cstat cstat--${meta.cls}`}>
      <Ic>{meta.icon}</Ic>
      {label}
    </span>
  );
}

export function FlagChips({ a, t }: { a: AdminAnnouncementVM; t: AnnCopy }) {
  const chips: ReactNode[] = [];
  if (a.isImportant)
    chips.push(
      <span className="aflag aflag--imp" title={t.flImportant} key="imp">
        <Ic>
          <ShieldAlert aria-hidden="true" />
        </Ic>
      </span>,
    );
  if (a.isPinned)
    chips.push(
      <span className="aflag aflag--pin" title={t.flPinned} key="pin">
        <Ic>
          <Pin aria-hidden="true" />
        </Ic>
      </span>,
    );
  if (a.popup)
    chips.push(
      <span
        className={`aflag aflag--popup${a.isPopupActive ? "" : " is-off"}`}
        title={a.isPopupActive ? t.flPopup : t.flPopupOff}
        key="popup"
      >
        <Ic>
          <Megaphone aria-hidden="true" />
        </Ic>
      </span>,
    );
  if (a.images.length > 0)
    chips.push(
      <span className="aflag aflag--img" title={tpl(t.flImage, a.images.length)} key="img">
        <Ic>
          <ImageIcon aria-hidden="true" />
        </Ic>
      </span>,
    );
  if (chips.length === 0) return null;
  return <span className="aflags">{chips}</span>;
}

export function TargetChip({
  a,
  t,
  roleLabel,
}: {
  a: AdminAnnouncementVM;
  t: AnnCopy;
  roleLabel: RoleLabel;
}) {
  const everyone = a.targetScope === "everyone";
  return (
    <span className={`an-target${everyone ? " everyone" : ""}`}>
      <Ic>{everyone ? <Megaphone aria-hidden="true" /> : <Users aria-hidden="true" />}</Ic>
      {targetLabel(a, t, roleLabel)}
    </span>
  );
}

export function AuthorCell({ name }: { name: string }) {
  return (
    <span className="who">
      <span className="who__av" style={{ background: avatarColor(name) }}>
        {initial(name)}
      </span>
      <span className="who__nm">{name || "—"}</span>
    </span>
  );
}
