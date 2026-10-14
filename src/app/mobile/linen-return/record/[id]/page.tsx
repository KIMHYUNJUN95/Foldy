import { redirect } from "next/navigation";
import Link from "next/link";
import { LinenReturnDetailActions } from "@/components/linen-return/linen-return-detail-actions";
import { LightboxThumbs } from "@/components/shell/lightbox-thumbs";
import "@/components/linen-return/linen-mobile.css";
import "@/components/requests/order-form.css";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary, type Locale } from "@/lib/i18n";
import { canManageLinenRecord, getLinenReturnRecordById } from "@/lib/linen-returns";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ building?: string; error?: string }>;
};

function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export default async function LinenReturnDetailPage({ params, searchParams }: PageProps) {
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/linen-return/record/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const record = await getLinenReturnRecordById(session, id);
  if (!record) {
    redirect("/mobile/linen-return");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.linenReturn;
  const buildingLabel = localizePropertyName(record.buildingName, dict.cleaning.buildingLabels);
  const canManage = canManageLinenRecord(session, record);
  const errorMessage = query.error ? copy.errors[query.error] ?? null : null;

  const navBadges = await getMobileNavBadges();

  const editHref = `/mobile/linen-return/record/${record.id}/edit?building=${encodeURIComponent(record.buildingName)}`;

  return (
    <MobileShell activeItem="linen-return" badges={navBadges} title={copy.detailTitle}>
      {/* 화이트 리디자인(2026-10-14, 시안 LinenDetail-Phone): 위 한 줄(건물 · 린넨 반품 · 휴지통) → 등록 시각 → 「누가 등록」 →
          품목 줄 · 합계 → 사진 → 메모 → 기록 수정. 상자 · 아바타 · 「…」 메뉴 제거. */}
      <div className="lnw lnw-detail">
        <div className="lnw-detail__kick">
          <span>{buildingLabel}</span>
          <span>{copy.eyebrow}</span>
          {canManage ? <LinenReturnDetailActions building={record.buildingName} copy={copy} recordId={record.id} /> : null}
        </div>
        <h1 className="lnw-detail__t">{formatDateTime(record.registeredAt, locale)}</h1>
        <p className="lnw-detail__s">{copy.wRegBy.replace("{who}", record.registrantName)}</p>

        {errorMessage ? (
          <p className="ofw-err" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="lnw-lines">
          {record.lines.map((line) => (
            <div className="lnw-line" key={line.itemId}>
              <span>{line.name}</span>
              <b className="num">
                {line.quantity}
                <small>{copy.quantityUnit}</small>
              </b>
            </div>
          ))}
          <div className="lnw-line is-total">
            <b>{copy.wTotal}</b>
            <b className="num">
              {record.totalQuantity}
              <small>{copy.quantityUnit}</small>
            </b>
          </div>
        </div>

        {record.imageUrls.length > 0 ? (
          <LightboxThumbs
            closeLabel={dict.common.close}
            sizes="(max-width: 600px) 50vw, 240px"
            thumbClassName="lnw-shot"
            urls={record.imageUrls}
            wrapClassName="lnw-shots"
          />
        ) : null}

        {record.note ? (
          <dl className="lnw-dl">
            <dt>{copy.memoTitle}</dt>
            <dd>{record.note}</dd>
          </dl>
        ) : null}

        {canManage ? (
          <div className="lnw-detail__foot">
            <Link className="lnw-edit" href={editHref}>
              {copy.wEditRecord}
            </Link>
            <span>{copy.wEvidence}</span>
          </div>
        ) : null}
      </div>
    </MobileShell>
  );
}
