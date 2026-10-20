import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";

/** 모바일 사용자 관리 머리 — 큰 제목 · 한 줄 설명 · 멤버 / 초대코드 탭(주소가 다른 두 화면). */
export function MobileUsersHead({
  active,
  locale,
  memberCount,
  inviteCount,
}: {
  active: "members" | "invites";
  locale: Locale;
  memberCount: number | null;
  inviteCount: number | null;
}) {
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  return (
    <>
      <header className="muw-head">
        <h1>{dict.admin.users.title}</h1>
        <p>{c.mSub}</p>
      </header>
      <nav className="muw-tabs" aria-label={dict.admin.users.title}>
        <Link href="/mobile/users" aria-current={active === "members" ? "page" : undefined} replace>
          {c.mTabMembers}
          {memberCount != null ? <i className="num">{memberCount}</i> : null}
        </Link>
        <Link href="/mobile/users/invites" aria-current={active === "invites" ? "page" : undefined} replace>
          {c.mTabInvites}
          {inviteCount != null ? <i className="num">{inviteCount}</i> : null}
        </Link>
      </nav>
    </>
  );
}
