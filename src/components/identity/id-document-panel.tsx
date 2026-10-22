"use client";

/**
 * 사용자 상세의 「신분 서류」 칸 — 관리자 웹 사용자 패널 · 모바일 사용자 관리 상세가 같이 쓴다(docs/product/41 §3-3, R2).
 * 앞 · 뒤 사진(10분 서명 URL) · 읽은 칸 · 만료까지 남은 날 · 「확인함」 / 「다시 요청(사유)」 · 카드 번호 유효 확인 바로가기.
 * 서버가 `staff_documents.view` 를 확인한 뒤에만 이 칸의 데이터를 실어 보낸다.
 */

import "./id-document-panel.css";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewIdDocument } from "@/app/account/id-card/actions";
import { getDictionary, type Locale } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { expiryTone, fieldsForKind, type IdDocumentField } from "@/lib/staff-documents/fields";
import type { IdDocumentView } from "@/lib/staff-documents/server";
import { formatDateKey, idFieldDisplay, idFieldLabel, statusLabel } from "@/components/identity/id-card-flow";

/** 출입국재류관리청 「在留カード等番号失効情報照会」. */
const VERIFY_URL = "https://lapse-immi.moj.go.jp/";

export function IdDocumentPanel({ doc, locale }: { doc: IdDocumentView | null; locale: Locale }) {
  const copy = getDictionary(locale).idCard;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!doc) {
    return (
      <section className="idp">
        <h3 className="idp__title">{copy.adminSection}</h3>
        <p className="idp__none">{copy.adminNone}</p>
      </section>
    );
  }

  const tone = expiryTone(doc.expiryDays);
  const editedLabels = doc.editedFields.map((key: IdDocumentField) => idFieldLabel(copy, doc.kind, key)).join(", ");

  function review(decision: "confirm" | "return") {
    if (!doc) return;
    if (decision === "return" && !reason.trim()) {
      setError(copy.adminReasonRequired);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reviewIdDocument({ documentId: doc.id, decision, reason });
      if (!result.ok) {
        haptic("error");
        setError(result.errorKey === "reason_required" ? copy.adminReasonRequired : copy.adminFailed);
        return;
      }
      haptic("success");
      setReturning(false);
      setReason("");
      router.refresh();
    });
  }

  async function copyNumber() {
    if (!doc?.fields.cardNumber) return;
    try {
      await navigator.clipboard.writeText(doc.fields.cardNumber);
      setCopied(true);
      haptic("light");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="idp">
      <div className="idp__head">
        <h3 className="idp__title">{doc.kind === "residence_card" ? copy.titleResidence : copy.titleMyNumber}</h3>
        <span className="idp__chip" data-status={doc.status}>{statusLabel(copy, doc.status)}</span>
        {tone && tone !== "ok" && doc.expiryDays !== null && (
          <span className="idp__chip" data-tone={tone}>
            {tone === "expired" ? copy.adminExpired : copy.adminDaysLeft.replace("{n}", String(doc.expiryDays))}
          </span>
        )}
      </div>

      <div className="idp__photos">
        {[doc.frontUrl, doc.backUrl].map((url, i) =>
          url ? (
            <a className="idp__photo" href={url} key={i} rel="noreferrer" target="_blank" aria-label={`${i === 0 ? copy.sideFront : copy.sideBack} · ${copy.adminPhotoOpen}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 10분 서명 URL */}
              <img alt="" src={url} />
              <span>{i === 0 ? copy.sideFront : copy.sideBack}</span>
            </a>
          ) : null,
        )}
      </div>

      <dl className="idp__kv">
        {fieldsForKind(doc.kind).map((key) => (
          <div key={key} data-edited={doc.editedFields.includes(key) ? "" : undefined}>
            <dt>{idFieldLabel(copy, doc.kind, key)}</dt>
            <dd lang={key === "residenceStatus" ? "ja" : undefined}>{idFieldDisplay(copy, key, doc.fields, locale) || "—"}</dd>
          </div>
        ))}
      </dl>

      <p className="idp__meta">
        {copy.viewSubmitted.replace("{date}", formatDateKey(doc.submittedAt.slice(0, 10), locale))} · {doc.ocrUsed ? copy.adminOcr : copy.adminManual}
        {editedLabels ? <><br />{copy.adminEdited.replace("{fields}", editedLabels)}</> : null}
        {doc.confirmedAt && doc.confirmedByName ? (
          <>
            <br />
            {statusLabel(copy, doc.status)} — {copy.adminReviewedBy.replace("{name}", doc.confirmedByName).replace("{date}", formatDateKey(doc.confirmedAt.slice(0, 10), locale))}
            {doc.status === "returned" && doc.returnReason ? `: ${doc.returnReason}` : ""}
          </>
        ) : null}
      </p>

      {doc.kind === "residence_card" && doc.fields.cardNumber && (
        <div className="idp__verify">
          <a href={VERIFY_URL} rel="noreferrer" target="_blank">{copy.adminVerify}</a>
          <button onClick={() => void copyNumber()} type="button" aria-live="polite">
            {copied ? copy.adminCopied : copy.adminCopy}
          </button>
        </div>
      )}

      {returning ? (
        <div className="idp__return">
          <textarea
            aria-label={copy.adminReturnPlaceholder}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder={copy.adminReturnPlaceholder}
            rows={2}
            value={reason}
          />
          <div className="idp__actions">
            <button className="idp__btn" disabled={pending} onClick={() => { setReturning(false); setError(null); }} type="button">
              {copy.cancel}
            </button>
            <button className="idp__btn idp__btn--pri" disabled={pending} onClick={() => review("return")} type="button">
              {copy.adminReturnSend}
            </button>
          </div>
        </div>
      ) : (
        <div className="idp__actions">
          <button className="idp__btn" disabled={pending} onClick={() => setReturning(true)} type="button">
            {copy.adminReturn}
          </button>
          <button
            className="idp__btn idp__btn--pri"
            disabled={pending || doc.status === "confirmed"}
            onClick={() => review("confirm")}
            type="button"
          >
            {copy.adminConfirm}
          </button>
        </div>
      )}
      {error && <p className="idp__error" role="alert">{error}</p>}
    </section>
  );
}
