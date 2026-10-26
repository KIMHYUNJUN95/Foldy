"use client";

/**
 * 모바일 사용자 관리 › 서류 › 한 사람(재류카드 R4, 2026-10-26, 시안 M8bU3z… Upload-Phone · Upload-Fold · Upload-Tablet · Docs-Tablet 오른쪽).
 * 서류가 있으면 확인 칸(`IdDocumentPanel` — PC 와 같은 칸), 없거나 `?upload=1` 이면 대신 올리기(카메라로 찍기 · 파일 고르기).
 * 폰 · 폴드는 이 화면으로 넘어오고(뒤로 = 화면 스와이프), 태블릿 가로는 목록 오른쪽 칸에 그대로 열린다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { IdDocumentPanel } from "@/components/identity/id-document-panel";
import { StaffIdUploadForm } from "@/components/identity/staff-id-upload-form";
import { statusLabel } from "@/components/identity/id-card-flow";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { StaffDocRosterRow } from "@/lib/staff-documents/roster";
import type { IdDocumentView } from "@/lib/staff-documents/server";
import "./mobile-users.css";

export function MobileStaffDocDetail({
  row,
  doc,
  upload,
  locale,
  confirmerName,
  isDeveloperViewer,
}: {
  row: StaffDocRosterRow;
  doc: IdDocumentView | null;
  upload: boolean;
  locale: Locale;
  confirmerName: string;
  isDeveloperViewer: boolean;
}) {
  const router = useRouter();
  const dict = getDictionary(locale);
  const idc = dict.idCard;
  const canUpload = Boolean(row.kind) && (!row.isSelf || isDeveloperViewer);
  const href = `/mobile/users/documents/${row.userId}`;
  const kindLabel = (kind: string | null | undefined) => (kind === "residence_card" ? idc.titleResidence : kind === "my_number_card" ? idc.titleMyNumber : null);

  if (upload || !doc) {
    return (
      <div className="muw-doc-detail">
        {!row.kind || !canUpload ? (
          <>
            <div className="muw-dh">
              <h1>{row.name || "—"}</h1>
            </div>
            <p className="muw-dnote">{!row.kind ? idc.upNoNationality : idc.upSelf}</p>
          </>
        ) : (
          <StaffIdUploadForm
            target={{ userId: row.userId, name: row.name, kind: row.kind }}
            confirmerName={confirmerName}
            locale={locale}
            variant="mobile"
            onCancel={doc ? () => router.replace(href) : undefined}
            onSaved={() => {
              router.replace(href);
              router.refresh();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="muw-doc-detail">
      <div className="muw-dh">
        <h1>{row.name || "—"}</h1>
      </div>
      <p className="muw-dsub">{[row.nationalityName, kindLabel(doc.kind), statusLabel(idc, doc.status)].filter(Boolean).join(" · ")}</p>
      <IdDocumentPanel canReview={!row.isSelf || isDeveloperViewer} doc={doc} locale={locale} printHref={`/account/id-card/print?u=${row.userId}`} />
      {canUpload ? (
        <Link className="muw-dnew" href={`${href}?upload=1`} replace>
          {idc.upNewCard}
        </Link>
      ) : null}
    </div>
  );
}
