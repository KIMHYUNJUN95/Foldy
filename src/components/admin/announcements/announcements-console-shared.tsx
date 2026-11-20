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

// 도쿄 날짜 · 시각 함수(입력 칸 값 tokyoDateKey · tokyoTimeHm, 표기 annDate · annDateTime · annDayLabel)는
// `@/lib/announcement-display` 한 곳에 있다(2026-11-20, 2차) — 여기에 다시 만들지 않는다.

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
