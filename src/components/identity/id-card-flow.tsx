"use client";

/**
 * 재류카드 · 마이넘버 카드 앞면 등록 흐름(docs/product/41 §3-1 · §3-1a, R2 2026-10-23, 시안 FXguKLHx…).
 *
 * 안내 · 동의 → 앞면 → (재류카드) 뒷면 → 읽는 중 → 확인 · 고치기 → 완료.
 * - 동의(기본 꺼짐)해야 AI 로 읽는다. 동의하지 않으면 사진만 찍고 직접 입력.
 * - 읽기가 실패해도 가입 · 등록은 막지 않는다 — 손 입력으로 이어진다.
 * - 이미 등록한 사람이 열면 지금 카드(상태 · 사진 · 칸)를 먼저 보여 주고 「새 카드로 다시 등록」.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { IdCardCamera } from "@/components/identity/id-card-camera";
import { readIdCard, submitIdCard } from "@/app/account/id-card/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { haptic } from "@/lib/haptics";
import { usePrivacyScreen } from "@/lib/native/privacy-screen";
import {
  EMPTY_ID_FIELDS,
  EXTRA_ACTIVITIES,
  RESIDENCE_STATUSES,
  WORK_RESTRICTIONS,
  daysUntil,
  fieldsForKind,
  normalizeIdFields,
  type IdDocumentField,
  type IdDocumentFields,
  type IdDocumentKind,
  type IdFieldErrorKey,
} from "@/lib/staff-documents/fields";
import type { IdDocumentView } from "@/lib/staff-documents/server";
import type { Dictionary } from "@/lib/i18n";

type Copy = Dictionary["idCard"];
type Side = "front" | "back";
type Photo = { path: string; url: string };
type Step = "view" | "intro" | "camera" | "reading" | "review" | "done";

const BUCKET = "staff-documents";

function randomName(side: Side) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${side}-${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}.jpg`;
}

export function workRestrictionLabel(copy: Copy, value: string) {
  const map: Record<string, string> = {
    none: copy.workNone,
    status_based: copy.workStatusBased,
    designated_org: copy.workDesignatedOrg,
    designated: copy.workDesignated,
    not_allowed: copy.workNotAllowed,
  };
  return map[value] ?? "";
}

export function extraActivityLabel(copy: Copy, value: string) {
  const map: Record<string, string> = {
    none: copy.extraNone,
    weekly_28h: copy.extraWeekly28h,
    per_certificate: copy.extraPerCertificate,
  };
  return map[value] ?? "";
}

export function idFieldLabel(copy: Copy, kind: IdDocumentKind, key: IdDocumentField) {
  switch (key) {
    case "cardNumber": return copy.fieldCardNumber;
    case "residenceStatus": return copy.fieldResidenceStatus;
    case "expiresOn": return kind === "residence_card" ? copy.fieldExpiresOnResidence : copy.fieldExpiresOnMyNumber;
    case "workRestriction": return copy.fieldWorkRestriction;
    case "extraActivity": return copy.fieldExtraActivity;
    case "nameRoman": return kind === "residence_card" ? copy.fieldNameRoman : copy.fieldNameMyNumber;
    case "birthDate": return copy.fieldBirthDate;
    case "gender": return copy.fieldGender;
    case "nationalityText": return copy.fieldNationalityText;
    case "address": return copy.fieldAddress;
  }
}

export function formatDateKey(value: string, locale: string) {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}

export function idFieldDisplay(copy: Copy, key: IdDocumentField, fields: IdDocumentFields, locale: string) {
  const value = fields[key];
  if (!value) return "";
  if (key === "workRestriction") return workRestrictionLabel(copy, value);
  if (key === "extraActivity") return extraActivityLabel(copy, value);
  if (key === "gender") return value === "male" ? copy.genderMale : copy.genderFemale;
  if (key === "birthDate" || key === "expiresOn") return formatDateKey(value, locale);
  return value;
}

export function statusLabel(copy: Copy, status: string) {
  return status === "confirmed" ? copy.statusConfirmed : status === "returned" ? copy.statusReturned : copy.statusPending;
}

export function IdCardFlow({
  copy,
  kind,
  locale,
  organizationId,
  userId,
  current,
  doneHref,
  doneLabel,
  laterHref,
  todayKey,
}: {
  copy: Copy;
  kind: IdDocumentKind;
  locale: string;
  organizationId: string;
  userId: string;
  current: IdDocumentView | null;
  doneHref: string;
  doneLabel: string;
  laterHref: string;
  todayKey: string;
}) {
  const [step, setStep] = useState<Step>(current ? "view" : "intro");
  // 앱: 이 화면(카드 사진 · 읽은 칸)이 떠 있는 동안 스크린샷 · 앱 전환기 미리보기를 막는다(docs/product/41 §10).
  usePrivacyScreen();
  const [documentId, setDocumentId] = useState(() => crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [side, setSide] = useState<Side>("front");
  /** 다시 찍기 한 장만이면 끝나고 바로 확인 화면으로. */
  const [retakeOnly, setRetakeOnly] = useState(false);
  /** 올리기 실패로 촬영에 돌아올 때마다 카메라를 새로 연다(같은 안내가 두 번 나와도). */
  const [cameraRound, setCameraRound] = useState(0);
  const [photos, setPhotos] = useState<Partial<Record<Side, Photo>>>({});
  const [fields, setFields] = useState<IdDocumentFields>(EMPTY_ID_FIELDS);
  const [readFields, setReadFields] = useState<IdDocumentFields | null>(null);
  const [unsure, setUnsure] = useState<IdDocumentField[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<IdDocumentField, IdFieldErrorKey>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [picker, setPicker] = useState<IdDocumentField | null>(null);
  const [savedStatus, setSavedStatus] = useState<IdDocumentFields | null>(null);

  const sides: Side[] = kind === "residence_card" ? ["front", "back"] : ["front"];
  const total = sides.length + 2; // 안내 + 사진 + 확인
  const title = kind === "residence_card" ? copy.titleResidence : copy.titleMyNumber;

  function startCapture() {
    haptic("light");
    setSide("front");
    setRetakeOnly(false);
    setNotice(null);
    setStep("camera");
  }

  function restart() {
    setDocumentId(crypto.randomUUID());
    setPhotos({});
    setFields(EMPTY_ID_FIELDS);
    setReadFields(null);
    setUnsure([]);
    setErrors({});
    setNotice(null);
    setConsent(false);
    setStep("intro");
  }

  async function upload(target: Side, blob: Blob): Promise<Photo | null> {
    const path = `${organizationId}/${userId}/${documentId}/${randomName(target)}`;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) return null;
    const old = photos[target];
    if (old) URL.revokeObjectURL(old.url);
    return { path, url: URL.createObjectURL(blob) };
  }

  async function runRead(next: Partial<Record<Side, Photo>>) {
    if (!next.front || (kind === "residence_card" && !next.back)) return;
    if (!consent) {
      setReadFields(null);
      setStep("review");
      return;
    }
    setStep("reading");
    let result: Awaited<ReturnType<typeof readIdCard>>;
    try {
      result = await readIdCard({ documentId, frontPath: next.front.path, backPath: next.back?.path ?? null, consent });
    } catch {
      result = { ok: false, reason: "failed" };
    }
    if (result.ok) {
      haptic("success");
      setFields(result.fields);
      setReadFields(result.fields);
      setUnsure(result.unsure);
      setNotice(null);
      setStep("review");
      return;
    }
    haptic("warning");
    if (result.reason === "individual_number") {
      setPhotos((p) => ({ ...p, front: undefined }));
      setNotice(copy.readIndividualNumber);
      setSide("front");
      setRetakeOnly(true);
      setStep("camera");
      return;
    }
    setNotice(
      result.reason === "not_card"
        ? copy.readNotCard
        : result.reason === "unreadable"
          ? copy.readUnreadable
          : result.reason === "rate_limited"
            ? copy.readRateLimited
            : copy.readFailed,
    );
    setReadFields(null);
    setStep("review");
  }

  async function onCapture(blob: Blob) {
    const photo = await upload(side, blob);
    if (!photo) {
      haptic("error");
      setNotice(copy.uploadFailed);
      setCameraRound((n) => n + 1);
      setStep("camera");
      return;
    }
    const next = { ...photos, [side]: photo };
    setPhotos(next);
    const idx = sides.indexOf(side);
    if (!retakeOnly && idx < sides.length - 1) {
      setSide(sides[idx + 1]);
      setNotice(null);
      return;
    }
    setRetakeOnly(false);
    await runRead(next);
  }

  function retake(target: Side) {
    setSide(target);
    setRetakeOnly(true);
    setNotice(null);
    setStep("camera");
  }

  function update(key: IdDocumentField, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit() {
    if (!photos.front || (kind === "residence_card" && !photos.back)) return;
    setSubmitting(true);
    setSubmitError(null);
    let result: Awaited<ReturnType<typeof submitIdCard>>;
    try {
      result = await submitIdCard({
        documentId,
        frontPath: photos.front.path,
        backPath: photos.back?.path ?? null,
        fields,
        readFields,
      });
    } catch {
      result = { ok: false, errorKey: "failed" };
    }
    setSubmitting(false);
    if (result.ok) {
      haptic("success");
      setSavedStatus(normalizeIdFields(fields));
      setStep("done");
      return;
    }
    haptic("error");
    if (result.errorKey === "invalid" && result.fieldErrors) {
      setErrors(result.fieldErrors);
      setSubmitError(copy.submitInvalid);
    } else {
      setSubmitError(result.errorKey === "invalid" ? copy.submitInvalid : copy.submitFailed);
    }
  }

  const progress = (n: number) => (
    <div
      className="idc__progress"
      role="progressbar"
      aria-label={`${title} ${n}/${total}`}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={n}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-on={i < n ? "" : undefined} />
      ))}
    </div>
  );

  // ── 지금 카드 보기 ─────────────────────────────────────────────
  if (step === "view" && current) {
    return (
      <main className="idc">
        <div className="idc__body">
          <p className="idc__eyebrow">{title}</p>
          <div className="idc__statusrow">
            <span className="idc__chip" data-status={current.status}>{statusLabel(copy, current.status)}</span>
            <span className="idc__muted">
              {copy.viewSubmitted.replace("{date}", formatDateKey(current.submittedAt.slice(0, 10), locale))}
            </span>
          </div>
          {current.status === "returned" && current.returnReason && (
            <p className="idc__banner idc__banner--warn" role="alert">
              {copy.returnedBanner.replace("{reason}", current.returnReason)}
            </p>
          )}
          <div className="idc__thumbs">
            {current.frontUrl && (
              <figure className="idc__thumb">
                {/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL(10분)이라 next/image 최적화를 거치지 않는다 */}
                <img alt={copy.sideFront} src={current.frontUrl} />
                <figcaption>{copy.sideFront}</figcaption>
              </figure>
            )}
            {current.backUrl && (
              <figure className="idc__thumb">
                {/* eslint-disable-next-line @next/next/no-img-element -- 위와 같음 */}
                <img alt={copy.sideBack} src={current.backUrl} />
                <figcaption>{copy.sideBack}</figcaption>
              </figure>
            )}
          </div>
          <dl className="idc__list">
            {fieldsForKind(current.kind)
              .filter((key) => current.fields[key])
              .map((key) => (
                <div className="idc__row" key={key}>
                  <dt>{idFieldLabel(copy, current.kind, key)}</dt>
                  <dd>{idFieldDisplay(copy, key, current.fields, locale)}</dd>
                </div>
              ))}
          </dl>
        </div>
        <div className="idc__cta">
          <button className="idc__btn idc__btn--pri" onClick={restart} type="button">{copy.reRegister}</button>
          <Link className="idc__btn idc__btn--text" href={doneHref}>{doneLabel}</Link>
        </div>
      </main>
    );
  }

  // ── 안내 · 동의 ───────────────────────────────────────────────
  if (step === "intro") {
    return (
      <main className="idc">
        <div className="idc__top">
          {progress(1)}
          <Link className="idc__later" href={laterHref}>{copy.later}</Link>
        </div>
        <div className="idc__body">
          <CardArt label={title} kind={kind} />
          <p className="idc__eyebrow">{title}</p>
          <h1 className="idc__h1">{kind === "residence_card" ? copy.introHeadingResidence : copy.introHeadingMyNumber}</h1>
          <p className="idc__lead">{kind === "residence_card" ? copy.introBodyResidence : copy.introBodyMyNumber}</p>
          <ul className="idc__points">
            <li>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /></svg>
              <div><b>{copy.pointAdminTitle}</b><span>{copy.pointAdminBody}</span></div>
            </li>
            <li>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h5M8 14h8" /></svg>
              <div><b>{copy.pointUseTitle}</b><span>{kind === "residence_card" ? copy.pointUseBodyResidence : copy.pointUseBodyMyNumber}</span></div>
            </li>
          </ul>
          <label className="idc__consent">
            <input checked={consent} onChange={(e) => { setConsent(e.target.checked); haptic("light"); }} type="checkbox" />
            <span>
              {copy.consent}{" "}
              <button className="idc__link" onClick={(e) => { e.preventDefault(); setShowDetail((v) => !v); }} type="button" aria-expanded={showDetail}>
                {copy.consentMore}
              </button>
            </span>
          </label>
          {showDetail && <p className="idc__hint">{copy.consentDetail}</p>}
          <p className="idc__hint">{copy.consentSkipHint}</p>
        </div>
        <div className="idc__cta">
          <button className="idc__btn idc__btn--pri" disabled={!consent} onClick={startCapture} type="button">
            {copy.startCamera}
          </button>
          {!consent && (
            <button className="idc__btn idc__btn--text" onClick={startCapture} type="button">{copy.startManual}</button>
          )}
        </div>
      </main>
    );
  }

  // ── 촬영 ─────────────────────────────────────────────────────
  if (step === "camera") {
    const n = sides.indexOf(side) + 2;
    const sideLabel = side === "front" ? copy.sideFront : copy.sideBack;
    const frameTitle = kind === "my_number_card" ? copy.frameMyNumber : side === "front" ? copy.frameFront : copy.frameBack;
    return (
      <IdCardCamera
        copy={copy}
        counter={copy.stepCounter.replace("{side}", sideLabel).replace("{n}", String(n)).replace("{total}", String(total))}
        key={`${side}-${retakeOnly}-${notice ?? ""}-${cameraRound}`}
        // 안내가 먼저 보여야 할 때는 스캐너를 바로 띄우지 않는다 — 「자동 스캔」 버튼으로 연다. 업로드 실패 · 마이넘버 뒷면 감지 안내,
        // 그리고 마이넘버 카드(「뒷면은 찍지 마세요」 경고를 스캐너가 덮으면 안 된다).
        autoScan={!notice && kind !== "my_number_card"}
        onCancel={() => setStep(photos.front && (kind === "my_number_card" || photos.back) ? "review" : "intro")}
        onCapture={(blob) => void onCapture(blob)}
        steps={
          <div className="idc-steps">
            <h2>{title}</h2>
            <ol>
              {sides.map((s, i) => (
                <li data-on={s === side ? "" : undefined} data-done={photos[s] ? "" : undefined} key={s}>
                  <span>{i + 2}</span>
                  {s === "front" ? copy.sideFront : copy.sideBack}
                </li>
              ))}
              <li>
                <span>{total}</span>
                {copy.reviewTitle}
              </li>
            </ol>
            <p>{copy.tipGlare}</p>
          </div>
        }
        title={frameTitle}
        warning={
          notice ? (
            <span role="alert">{notice}</span>
          ) : kind === "my_number_card" ? (
            <span>{copy.myNumberWarn}</span>
          ) : undefined
        }
      />
    );
  }

  // ── 읽는 중 ───────────────────────────────────────────────────
  if (step === "reading") {
    return (
      <main className="idc idc--center">
        <div className="idc__scan" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- 방금 찍은 사진(blob URL) */}
          {photos.front && <img alt="" src={photos.front.url} />}
          <i />
        </div>
        <h1 className="idc__h1 idc__h1--center" role="status">{copy.readingTitle}</h1>
        <p className="idc__lead idc__lead--center">{copy.readingSub}</p>
      </main>
    );
  }

  // ── 확인 · 고치기 ─────────────────────────────────────────────
  if (step === "review") {
    const keys = fieldsForKind(kind);
    return (
      <main className="idc">
        <div className="idc__top">
          <button aria-label={copy.cancel} className="idc__back" onClick={() => setStep("intro")} type="button">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          {progress(total)}
          <span className="idc__count">{total}/{total}</span>
        </div>
        <div className="idc__body idc__body--split">
          <div className="idc__head">
            <h1 className="idc__h1 idc__h1--sm">{readFields ? copy.reviewTitle : copy.manualTitle}</h1>
            <p className="idc__lead">{readFields ? copy.reviewBody : copy.manualBody}</p>
            {notice && <p className="idc__banner idc__banner--warn" role="alert">{notice}</p>}
          </div>
          <div className="idc__photos">
            {sides.map((s) => (
              <div className="idc__photo" key={s}>
                {photos[s] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 방금 찍은 사진(blob URL)
                  <img alt={s === "front" ? copy.sideFront : copy.sideBack} src={photos[s]!.url} />
                ) : (
                  <span className="idc__photo-empty" />
                )}
                <button className="idc__link" onClick={() => retake(s)} type="button">
                  {s === "front" ? copy.retakeFront : copy.retakeBack}
                </button>
              </div>
            ))}
          </div>
          <div className="idc__form">
            {keys.map((key) => (
              <FieldRow
                copy={copy}
                edited={Boolean(readFields && readFields[key] && readFields[key] !== fields[key])}
                error={errors[key]}
                fields={fields}
                key={key}
                kind={kind}
                locale={locale}
                name={key}
                onOpen={() => setPicker(key)}
                onChange={(v) => update(key, v)}
                todayKey={todayKey}
                unsure={unsure.includes(key) && readFields?.[key] === fields[key]}
              />
            ))}
          </div>
        </div>
        <div className="idc__cta idc__cta--line">
          {submitError && <p className="idc__error" role="alert">{submitError}</p>}
          <button className="idc__btn idc__btn--pri" disabled={submitting} onClick={() => void submit()} type="button">
            {submitting ? copy.submitting : copy.submit}
          </button>
        </div>
        {picker && (
          <OptionSheet
            copy={copy}
            field={picker}
            onClose={() => setPicker(null)}
            onPick={(v) => { update(picker, v); haptic("light"); }}
            value={fields[picker]}
          />
        )}
      </main>
    );
  }

  // ── 완료 ─────────────────────────────────────────────────────
  const saved = savedStatus ?? fields;
  return (
    <main className="idc idc--center">
      <span className="idc__check" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
      </span>
      <h1 className="idc__h1 idc__h1--center">{kind === "residence_card" ? copy.doneTitleResidence : copy.doneTitleMyNumber}</h1>
      <p className="idc__lead idc__lead--center">{copy.doneBody}</p>
      <dl className="idc__summary">
        <div className="idc__row">
          <dt>{copy.statusLabel}</dt>
          <dd><span className="idc__chip" data-status="pending">{copy.statusPending}</span></dd>
        </div>
        {kind === "residence_card" && saved.residenceStatus && (
          <div className="idc__row"><dt>{copy.fieldResidenceStatus}</dt><dd lang="ja">{saved.residenceStatus}</dd></div>
        )}
        {saved.expiresOn && (
          <div className="idc__row">
            <dt>{idFieldLabel(copy, kind, "expiresOn")}</dt>
            <dd>{formatDateKey(saved.expiresOn, locale)}</dd>
          </div>
        )}
      </dl>
      <div className="idc__cta idc__cta--wide">
        <Link className="idc__btn idc__btn--pri" href={doneHref}>{doneLabel}</Link>
      </div>
    </main>
  );
}

function CardArt({ label, kind }: { label: string; kind: IdDocumentKind }) {
  return (
    <div className="idc__art" role="img" aria-label={label}>
      <div className="idc__art-head" lang="ja">{kind === "residence_card" ? "在留カード" : "マイナンバーカード"}</div>{/* i18n-ignore -- 카드 그림 속 인쇄 글자(실물 카드와 같게 일본어) */}
      <i style={{ left: 10, top: 32, width: 92 }} />
      <i style={{ left: 10, top: 46, width: 112 }} />
      <i style={{ left: 10, top: 60, width: 72 }} />
      <i style={{ left: 10, top: 74, width: 100 }} />
      <i className="idc__art-photo" />
      <i style={{ left: 10, bottom: 10, width: 120 }} />
    </div>
  );
}

const PICKED: IdDocumentField[] = ["residenceStatus", "workRestriction", "extraActivity", "gender"];
const DATE_FIELDS: IdDocumentField[] = ["birthDate", "expiresOn"];

function FieldRow({
  copy,
  kind,
  name,
  fields,
  locale,
  error,
  edited,
  unsure,
  todayKey,
  onChange,
  onOpen,
}: {
  copy: Copy;
  kind: IdDocumentKind;
  name: IdDocumentField;
  fields: IdDocumentFields;
  locale: string;
  error?: IdFieldErrorKey;
  edited: boolean;
  unsure: boolean;
  todayKey: string;
  onChange: (value: string) => void;
  onOpen: () => void;
}) {
  const label = idFieldLabel(copy, kind, name);
  const id = `idc-${name}`;
  const expired = name === "expiresOn" && (daysUntil(fields.expiresOn, todayKey) ?? 0) < 0;
  const warn = unsure ? copy.unsure : expired ? copy.expiredWarn : null;
  const errText = error === "card_number_invalid" ? copy.errCardNumber : error ? copy.errRequired : null;
  const describe = [warn ? `${id}-warn` : null, errText ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;

  let control;
  if (PICKED.includes(name)) {
    const display = idFieldDisplay(copy, name, fields, locale);
    control = (
      <button aria-describedby={describe} className="idc__value idc__value--pick" id={id} onClick={onOpen} type="button">
        <span lang={name === "residenceStatus" ? "ja" : undefined}>{display || copy.choose}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    );
  } else if (DATE_FIELDS.includes(name)) {
    control = (
      <input
        aria-describedby={describe}
        className="idc__value"
        id={id}
        onChange={(e) => onChange(e.target.value)}
        type="date"
        value={fields[name]}
      />
    );
  } else {
    control = (
      <input
        aria-describedby={describe}
        aria-invalid={errText ? true : undefined}
        autoCapitalize={name === "cardNumber" || (name === "nameRoman" && kind === "residence_card") ? "characters" : undefined}
        autoComplete="off"
        className="idc__value"
        id={id}
        inputMode={name === "cardNumber" ? "text" : undefined}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        value={fields[name]}
      />
    );
  }

  return (
    <div className="idc__field" data-warn={warn ? "" : undefined} data-error={errText ? "" : undefined}>
      <label className="idc__label" htmlFor={id}>{label}</label>
      <div className="idc__control">
        {control}
        {warn && <span className="idc__warn" id={`${id}-warn`}>{warn}</span>}
        {errText && <span className="idc__err" id={`${id}-err`}>{errText}</span>}
      </div>
      {edited && <span className="idc__edited">{copy.edited}</span>}
    </div>
  );
}

function OptionSheet({
  copy,
  field,
  value,
  onPick,
  onClose,
}: {
  copy: Copy;
  field: IdDocumentField;
  value: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const options = useMemo(() => {
    if (field === "workRestriction") return WORK_RESTRICTIONS.map((v) => ({ value: v, label: workRestrictionLabel(copy, v) }));
    if (field === "extraActivity") return EXTRA_ACTIVITIES.map((v) => ({ value: v, label: extraActivityLabel(copy, v) }));
    if (field === "gender") return [{ value: "male", label: copy.genderMale }, { value: "female", label: copy.genderFemale }];
    return RESIDENCE_STATUSES.map((v) => ({ value: v, label: v }));
  }, [copy, field]);
  const isStatus = field === "residenceStatus";
  const custom = isStatus && value && !(RESIDENCE_STATUSES as readonly string[]).includes(value);
  const [other, setOther] = useState(custom ? value : "");
  const [otherOpen, setOtherOpen] = useState(Boolean(custom));

  return (
    <BottomSheet ariaLabel={idFieldLabel(copy, "residence_card", field)} onClose={onClose}>
      {({ close }) => (
        <div className="idc-sheet">
          <p className="idc-sheet__title">{idFieldLabel(copy, "residence_card", field)}</p>
          <div className="idc-sheet__list" role="listbox">
            {options.map((o) => (
              <button
                aria-selected={value === o.value}
                className="idc-sheet__opt"
                key={o.value}
                lang={isStatus ? "ja" : undefined}
                onClick={() => { onPick(o.value); close(); }}
                role="option"
                type="button"
              >
                <span>{o.label}</span>
                {value === o.value && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                )}
              </button>
            ))}
            {isStatus && (
              <button aria-selected={Boolean(custom)} className="idc-sheet__opt" onClick={() => setOtherOpen(true)} role="option" type="button">
                <span>{copy.residenceOther}</span>
              </button>
            )}
          </div>
          {isStatus && otherOpen && (
            <div className="idc-sheet__other">
              <input
                autoFocus
                lang="ja"
                onChange={(e) => setOther(e.target.value)}
                placeholder={copy.residenceOtherPlaceholder}
                value={other}
              />
              <button
                className="idc__btn idc__btn--pri"
                disabled={!other.trim()}
                onClick={() => { onPick(other.trim()); close(); }}
                type="button"
              >
                {copy.done}
              </button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
