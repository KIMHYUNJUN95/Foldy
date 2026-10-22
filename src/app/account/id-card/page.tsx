import Link from "next/link";
import { redirect } from "next/navigation";
import "@/components/identity/id-card.css";
import { IdCardFlow } from "@/components/identity/id-card-flow";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import { documentKindFor } from "@/lib/staff-documents/fields";
import { loadCurrentIdDocument } from "@/lib/staff-documents/server";
import { tokyoToday } from "@/lib/tokyo-date";

/**
 * 재류카드 · 마이넘버 카드 앞면 등록 — 셸 없는 전체 화면(촬영 화면이 어둡고 탭바가 없어야 한다).
 * 들어오는 곳: 가입 완료 화면(`from=onboarding`) · 하루 한 번 안내 시트 · 내 정보. docs/product/41 §3-1.
 */

// 카드 읽기(서버 액션)는 Claude API 를 기다린다 — 보통 10초 안팎, 넉넉히.
export const maxDuration = 60;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeInternal(path: string | undefined) {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
}

export default async function IdCardPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getCurrentAppSession(), searchParams]);
  if (!session) redirect("/auth/login?next=/account/id-card");
  if (!hasOrganizationContext(session)) redirect("/account");

  const dictionary = getDictionary(session.user.preferredLanguage);
  const copy = dictionary.idCard;
  const from = first(params?.from);
  const next = safeInternal(first(params?.next));
  const backHref = from === "onboarding" ? (next ?? "/mobile") : "/account?mode=mobile";
  const backLabel = from === "onboarding" ? copy.doneCta : copy.doneCtaAccount;

  const nationality = session.user.identity.nationality;
  if (!nationality) {
    return (
      <main className="idc idc--center">
        <h1 className="idc__h1 idc__h1--center">{copy.needIdentity}</h1>
        <div className="idc__cta idc__cta--wide">
          <Link className="idc__btn idc__btn--pri" href="/account?mode=mobile&fill=identity">{copy.needIdentityCta}</Link>
          <Link className="idc__btn idc__btn--text" href={backHref}>{copy.later}</Link>
        </div>
      </main>
    );
  }

  const current = await loadCurrentIdDocument(session.organization.id, session.user.id, { withPhotos: true });

  return (
    <IdCardFlow
      copy={copy}
      current={current}
      doneHref={backHref}
      doneLabel={backLabel}
      kind={documentKindFor(nationality)}
      laterHref={backHref}
      locale={session.user.preferredLanguage}
      organizationId={session.organization.id}
      todayKey={tokyoToday()}
      userId={session.user.id}
    />
  );
}
