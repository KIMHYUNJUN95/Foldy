import Link from "next/link";

/**
 * 멤버 목록 / 멤버 초대 탭 — /admin/users 와 /admin/users/invites 가 함께 쓴다(2026-07-13 초대코드를 설정에서 옮김).
 * 화이트 리디자인(2026-10-14): 공용 `.lviews` 탭 + 숫자(멤버 수 · 쓸 수 있는 초대코드 수).
 */
export function UsersSectionTabs({
  active,
  labels,
  counts,
}: {
  active: "members" | "invites";
  labels: { members: string; invites: string };
  counts?: { members?: number; invites?: number };
}) {
  return (
    <nav className="lviews" aria-label={labels.members} style={{ margin: 0 }}>
      <Link href="/admin/users" className={active === "members" ? "on" : ""} aria-current={active === "members" ? "page" : undefined}>
        {labels.members}
        {counts?.members != null ? <span className="cnt num">{counts.members}</span> : null}
      </Link>
      <Link
        href="/admin/users/invites"
        className={active === "invites" ? "on" : ""}
        aria-current={active === "invites" ? "page" : undefined}
      >
        {labels.invites}
        {counts?.invites != null ? <span className="cnt num">{counts.invites}</span> : null}
      </Link>
    </nav>
  );
}
