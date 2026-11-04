"use client";

// 도착 한 줄의 오른쪽 패널(시안 S1) — 예약 머리 · 인원 경고 · 체크인 코드 · 사람별 명부(여권 사진 · 영상 · MRZ · 빠진 칸) · 동의 · 「확인함」.
// 파일은 누를 때마다 서명 URL(3분) + 서버 기록 한 줄. 권한(`checkin.documents`)이 없으면 파일 줄 자체를 그리지 않는다.
// 「대신 입력」은 P1(FR-S04)이라 이번에는 없다. docs/product/44 §4-4
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, FileVideo, ImageIcon, TriangleAlert, X } from "lucide-react";
import { getCheckinStayDetail, markCheckinStayVerified, openCheckinDocument, type GetCheckinStayDetailResult } from "@/actions/checkin/stays";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";
import { haptic } from "@/lib/haptics";
import type { Locale } from "@/lib/i18n";
import type { CheckinGuestDetail, CheckinStayDetail } from "@/lib/checkin/stays";
import { MISSING_FIELD_ORDER, formatMonthDay, formatTokyoStamp, mrzState, nightsBetween, panelAccess } from "@/lib/checkin/staff-view";
import { checkinNationalityName } from "@/lib/checkin/country";
import { channelLabel, fill, missingLabel, type CheckinCopy } from "./checkin-copy";
import { CheckinCodeField } from "./checkin-code-field";
import { CheckinState } from "./checkin-ui";

type Loaded = { detail: CheckinStayDetail; canViewDocuments: boolean; canVerify: boolean };
type Load = { kind: "loading" } | { kind: "ready"; data: Loaded } | { kind: "error"; errorKey: string };

type Viewer = { url: string; kind: string } | null;

export function CheckinStayPanel({
  stayId,
  copy,
  locale,
  noAccessTitle,
  onClose,
  onToast,
  onChanged,
}: {
  stayId: string;
  copy: CheckinCopy;
  locale: Locale;
  noAccessTitle: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [guestIndex, setGuestIndex] = useState(0);
  const [viewer, setViewer] = useState<Viewer>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const closeViewer = useCallback(() => setViewer(null), []);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: viewer !== null || verifying });

  const fetchDetail = useCallback(async (): Promise<Load> => {
    try {
      const result: GetCheckinStayDetailResult = await getCheckinStayDetail(stayId);
      if (result.ok) return { kind: "ready", data: { detail: result.detail, canViewDocuments: result.canViewDocuments, canVerify: result.canVerify } };
      return { kind: "error", errorKey: result.errorKey };
    } catch {
      return { kind: "error", errorKey: "failed" };
    }
  }, [stayId]);

  useEffect(() => {
    let alive = true;
    void fetchDetail().then((next) => {
      if (alive) setLoad(next);
    });
    return () => {
      alive = false;
    };
  }, [fetchDetail]);

  async function openDocument(documentId: string) {
    if (openingId) return;
    setOpeningId(documentId);
    try {
      const result = await openCheckinDocument(documentId);
      if (!result.ok) {
        haptic("error");
        onToast(copy.docOpenFailed);
        return;
      }
      setViewer({ url: result.url, kind: result.kind });
    } catch {
      onToast(copy.docOpenFailed);
    } finally {
      setOpeningId(null);
    }
  }

  async function verify() {
    if (verifying) return;
    setVerifying(true);
    try {
      const result = await markCheckinStayVerified(stayId);
      if (result.ok) {
        haptic("success");
        onToast(result.already ? copy.verifyAlready : copy.verifySaved);
        setLoad(await fetchDetail());
        onChanged();
      } else {
        haptic("error");
        onToast(result.errorKey === "not_checked_in" ? copy.verifyNotCheckedIn : copy.actionFailed);
      }
    } catch {
      onToast(copy.actionFailed);
    } finally {
      setVerifying(false);
    }
  }

  const data = load.kind === "ready" ? load.data : null;
  const access = data
    ? panelAccess({
        status: data.detail.stay.status,
        verifiedAt: data.detail.stay.verifiedAt,
        canViewDocuments: data.canViewDocuments,
        canVerify: data.canVerify,
      })
    : null;

  return (
    <>
      <div className="panel-scrim on" onClick={verifying ? undefined : onClose} />
      <aside ref={panelRef} className="panel on ck-panel" role="dialog" aria-label={copy.panelLabel} tabIndex={-1}>
        <div className="ck-hd">
          <span className="ck-hd__k">{copy.panelLabel}</span>
          <button type="button" className="ck-ic ck-hd__x" aria-label={copy.close} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        {load.kind === "loading" ? (
          <div className="ck-pb" aria-busy="true" aria-label={copy.loading}>
            <div className="ck-sec" style={{ gap: 12 }}>
              <div className="ck-skeleton" style={{ width: "46%", height: 22 }} />
              <div className="ck-skeleton" style={{ width: "78%" }} />
              <div className="ck-skeleton" style={{ width: "62%" }} />
            </div>
          </div>
        ) : load.kind === "error" ? (
          <div className="ck-pb">
            <CheckinState
              kind={load.errorKey === "forbidden" ? "forbidden" : load.errorKey === "not_ready" ? "notReady" : "error"}
              title={
                load.errorKey === "forbidden"
                  ? noAccessTitle
                  : load.errorKey === "not_ready"
                    ? copy.notReadyTitle
                    : load.errorKey === "not_found"
                      ? copy.panelNotFound
                      : copy.panelLoadError
              }
            />
          </div>
        ) : data && access ? (
          <>
            <div className="ck-pb">
              <PanelHead detail={data.detail} copy={copy} />
              <CheckinCodeField key={stayId} stayId={stayId} status={data.detail.stay.status} copy={copy} />
              <RosterSection
                detail={data.detail}
                copy={copy}
                locale={locale}
                showDocuments={access.showDocuments}
                guestIndex={Math.min(guestIndex, Math.max(0, data.detail.guests.length - 1))}
                onGuestIndex={setGuestIndex}
                openingId={openingId}
                onOpenDocument={(id) => void openDocument(id)}
              />
              <ConsentSection detail={data.detail} copy={copy} />
            </div>
            {access.verify !== "hidden" ? (
              <div className="ck-pf">
                {access.verify === "done" ? (
                  <span className="ck-done">
                    <CircleCheck aria-hidden="true" />
                    {data.detail.stay.verifiedByName
                      ? fill(copy.verifyDone, { at: formatTokyoStamp(data.detail.stay.verifiedAt), name: data.detail.stay.verifiedByName })
                      : fill(copy.verifyDoneNoName, { at: formatTokyoStamp(data.detail.stay.verifiedAt) })}
                  </span>
                ) : (
                  <button type="button" className="ck-btn is-pri is-block" onClick={() => void verify()} disabled={verifying} aria-busy={verifying}>
                    {copy.verifyButton}
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </aside>

      {viewer ? <FileViewer viewer={viewer} copy={copy} onClose={closeViewer} /> : null}
    </>
  );
}

function PanelHead({ detail, copy }: { detail: CheckinStayDetail; copy: CheckinCopy }) {
  const buildingName = useBuildingName();
  const { stay } = detail;
  const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
  const meta = [
    buildingName(stay.propertyName),
    `${formatMonthDay(stay.checkInDate)} ~ ${formatMonthDay(stay.checkOutDate)}`,
    nights > 0 ? fill(copy.nightsN, { n: nights }) : null,
    `${channelLabel(stay.channel, copy)} ${stay.reservationNumber}`,
  ].filter(Boolean);
  const showParty = stay.group === "attention" && stay.partyMismatch;
  const showStaff = stay.group === "attention" && stay.staffCheckCount > 0;
  return (
    <div className="ck-sec is-head">
      <div className="ck-lead">
        <span className={`ck-dot is-${stay.channel}`} aria-hidden="true" />
        <b>{stay.leadName ?? "—"}</b>
      </div>
      <span className="ck-soft num">{meta.join(" · ")}</span>
      {showParty ? (
        <div className="ck-warn" role="note">
          <TriangleAlert aria-hidden="true" />
          <div>
            <b>{fill(copy.warnPartyTitle, { expected: stay.guestCountExpected, roster: stay.rosterCount })}</b>
            <p>{fill(copy.warnPartyBody, { expected: stay.guestCountExpected, roster: stay.rosterCount })}</p>
          </div>
        </div>
      ) : null}
      {showStaff ? (
        <div className="ck-warn" role="note">
          <TriangleAlert aria-hidden="true" />
          <div>
            <b>{fill(copy.warnStaffTitle, { n: stay.staffCheckCount })}</b>
            <p>{copy.warnStaffBody}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RosterSection({
  detail,
  copy,
  locale,
  showDocuments,
  guestIndex,
  onGuestIndex,
  openingId,
  onOpenDocument,
}: {
  detail: CheckinStayDetail;
  copy: CheckinCopy;
  locale: Locale;
  showDocuments: boolean;
  guestIndex: number;
  onGuestIndex: (index: number) => void;
  openingId: string | null;
  onOpenDocument: (documentId: string) => void;
}) {
  const guests = detail.guests;
  const guest = guests[guestIndex];
  return (
    <section className="ck-sec" aria-label={copy.rosterTitle}>
      <span className="ck-k">{copy.rosterTitle}</span>
      {guest ? (
        <>
          {guests.length > 1 ? (
            <div className="ck-ptabs" role="tablist" aria-label={copy.rosterTitle}>
              {guests.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={index === guestIndex}
                  className={`ck-ptab${index === guestIndex ? " on" : ""}`}
                  onClick={() => onGuestIndex(index)}
                >
                  {fill(copy.guestTab, { n: index + 1 })}
                </button>
              ))}
            </div>
          ) : null}
          <GuestCard guest={guest} copy={copy} locale={locale} showDocuments={showDocuments} openingId={openingId} onOpenDocument={onOpenDocument} />
        </>
      ) : (
        <p className="ck-soft">{copy.rosterEmpty}</p>
      )}
    </section>
  );
}

function GuestCard({
  guest,
  copy,
  locale,
  showDocuments,
  openingId,
  onOpenDocument,
}: {
  guest: CheckinGuestDetail;
  copy: CheckinCopy;
  locale: Locale;
  showDocuments: boolean;
  openingId: string | null;
  onOpenDocument: (documentId: string) => void;
}) {
  const roomPlace = useRoomPlaceLabel();
  const passport = guest.documents?.find((doc) => doc.kind === "passport");
  const video = guest.documents?.find((doc) => doc.kind === "face_video");
  const mrz = mrzState(guest.mrzValid);
  const missing = MISSING_FIELD_ORDER.filter((field) => guest.missing.includes(field));
  const ageGender = [guest.age !== null ? String(guest.age) : null, guest.gender].filter(Boolean).join(" · ");
  const reason = guest.noPassportReason === "child" ? copy.noPassportChild : guest.noPassportReason;

  const rows: [string, string | null][] = [
    [copy.kvName, guest.nameRoman ? (guest.isRepresentative ? `${guest.nameRoman} · ${copy.guestRepresentative}` : guest.nameRoman) : null],
    [copy.kvNationality, checkinNationalityName(guest.nationality, locale)],
    [copy.kvPassport, guest.passportNumberMasked],
    [copy.kvAddress, guest.address],
    [copy.kvContact, guest.contact],
    [copy.kvAgeGender, ageGender || null],
    [copy.kvPrevStay, guest.prevStay],
    [copy.kvNextDest, guest.nextDest],
    [copy.kvRoom, guest.roomLabel ? roomPlace(guest.roomLabel) : null],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showDocuments ? (
        <div className="ck-files">
          <FileBox label={copy.passportPhoto} icon="photo" docId={passport?.id ?? null} openingId={openingId} copy={copy} onOpen={onOpenDocument} />
          <FileBox label={copy.faceVideo} icon="video" docId={video?.id ?? null} openingId={openingId} copy={copy} onOpen={onOpenDocument} />
        </div>
      ) : null}
      <dl className="ck-kv num">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        <dt>{copy.kvPassportRead}</dt>
        <dd className={`is-flex${mrz === "bad" ? " is-red" : ""}`}>
          {mrz === "ok" ? <CircleCheck aria-hidden="true" /> : mrz === "bad" ? <TriangleAlert aria-hidden="true" /> : null}
          {mrz === "ok" ? copy.mrzOk : mrz === "bad" ? copy.mrzBad : copy.mrzNone}
        </dd>
      </dl>
      {reason ? <p className="ck-soft">{fill(copy.noPassport, { reason })}</p> : null}
      {missing.length > 0 ? (
        <p className="ck-missing">
          {copy.missingTitle} · {missing.map((field) => missingLabel(field, copy)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function FileBox({
  label,
  icon,
  docId,
  openingId,
  copy,
  onOpen,
}: {
  label: string;
  icon: "photo" | "video";
  docId: string | null;
  openingId: string | null;
  copy: CheckinCopy;
  onOpen: (documentId: string) => void;
}) {
  const Icon = icon === "photo" ? ImageIcon : FileVideo;
  const opening = docId !== null && openingId === docId;
  return (
    <div className="ck-file">
      <button type="button" className="ck-file__box" disabled={!docId || openingId !== null} aria-busy={opening} aria-label={`${label} · ${docId ? copy.docOpen : copy.docNone}`} onClick={() => docId && onOpen(docId)}>
        <span>
          <Icon aria-hidden="true" />
          {docId ? (opening ? copy.docOpening : copy.docOpen) : copy.docNone}
        </span>
      </button>
      <span>{label}</span>
    </div>
  );
}

function ConsentSection({ detail, copy }: { detail: CheckinStayDetail; copy: CheckinCopy }) {
  const consent = [...detail.consents].sort((a, b) => b.agreedAt.localeCompare(a.agreedAt))[0];
  return (
    <section className="ck-sec" aria-label={copy.consentTitle}>
      <span className="ck-k">{copy.consentTitle}</span>
      <p className="ck-consent num">
        {consent
          ? fill(copy.consentLine, {
              at: formatTokyoStamp(consent.agreedAt),
              version: consent.termsVersion,
              via: consent.via === "tablet" ? copy.routeTablet : copy.routePreRegistered,
            })
          : copy.consentNone}
      </p>
    </section>
  );
}

/** 서명 URL 로 사진 · 영상을 크게. 3분 뒤(URL 이 죽기 전) 스스로 닫고, Esc 로 먼저 이 창만 닫는다. */
function FileViewer({ viewer, copy, onClose }: { viewer: NonNullable<Viewer>; copy: CheckinCopy; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 170_000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return (
    <div className="ck-viewer" role="dialog" aria-label={copy.docOpen} onClick={onClose}>
      <button type="button" className="ck-viewer__x" aria-label={copy.close} onClick={onClose}>
        <X aria-hidden="true" />
      </button>
      {viewer.kind === "face_video" ? (
        <video src={viewer.url} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 서명 URL 은 next/image 허용 목록 밖
        <img alt="" src={viewer.url} onClick={(event) => event.stopPropagation()} />
      )}
      <p>{copy.docViewerHint}</p>
    </div>
  );
}
