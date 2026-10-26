import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";

/**
 * 모바일 사용자 관리 머리 — 큰 제목 · 한 줄 설명 · 멤버 / 초대코드 / 서류 탭(주소가 다른 세 화면).
 * 「서류」(재류카드 R4, 2026-10-26)는 `staff_documents.view` 가 있을 때만 — 부르는 쪽이 `docsCount` 를 넘길 때만 그린다.
 * 폰은 짧은 이름(「서류」), 폴드부터 「직원 서류」.
 */
export function MobileUsersHead({
  active,
  locale,
  memberCount,
  inviteCount,
  docsCount = null,
}: {
  active: "members" | "invites" | "documents";
  locale: Locale;
  memberCount: number | null;
  inviteCount: number | null;
  /** null = 서류 탭 없음(권한 없음). */
  docsCount?: number | null;
}) {
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  return (
    <>
      <header className="muw-head">
        <h1>{dict.admin.users.title}</h1>
        <p>{active === "documents" ? c.docsSub : c.mSub}</p>
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
        {docsCount != null ? (
          <Link href="/mobile/users/documents" aria-current={active === "documents" ? "page" : undefined} replace>
            <span className="muw-tab-s">{c.mTabDocs}</span>
            <span className="muw-tab-l">{c.tabDocs}</span>
            <i className="num">{docsCount}</i>
          </Link>
        ) : null}
      </nav>
    </>
  );
}
