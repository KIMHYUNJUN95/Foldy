import Link from "next/link";

/**
 * 멤버 목록 / 멤버 초대 / 직원 서류 탭 — /admin/users · /admin/users/invites · /admin/users/documents 가 함께 쓴다
 * (2026-07-13 초대코드를 설정에서 옮김, 2026-10-26 재류카드 R4 「직원 서류」).
 * 화이트 리디자인(2026-10-14): 공용 `.lviews` 탭 + 숫자(멤버 수 · 쓸 수 있는 초대코드 수 · 서류 목록 사람 수).
 * 「직원 서류」는 `staff_documents.view` 가 있을 때만 — 부르는 쪽이 `labels.documents` 를 넘길 때만 그린다.
 */
export function UsersSectionTabs({
  active,
  labels,
  counts,
}: {
  active: "members" | "invites" | "documents";
  labels: { members: string; invites: string; documents?: string | null };
  counts?: { members?: number; invites?: number; documents?: number };
}) {
  const tab = (key: "members" | "invites" | "documents", href: string, label: string, count?: number) => (
    <Link href={href} className={active === key ? "on" : ""} aria-current={active === key ? "page" : undefined}>
      {label}
      {count != null ? <span className="cnt num">{count}</span> : null}
    </Link>
  );
  return (
    <nav className="lviews" aria-label={labels.members} style={{ margin: 0 }}>
      {tab("members", "/admin/users", labels.members, counts?.members)}
      {tab("invites", "/admin/users/invites", labels.invites, counts?.invites)}
      {labels.documents ? tab("documents", "/admin/users/documents", labels.documents, counts?.documents) : null}
    </nav>
  );
}
