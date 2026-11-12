"use client";

/**
 * 건물 정보 — 손님에게 보내는 칸 고치기(공용 오른쪽 패널 `.panel`, 시안 R2Building).
 * 예약 캘린더 「건물 정보」 카드와 손님 메시지 답장 칸 「건물 정보 고치기」가 같이 연다. docs/product/47-guest-messaging.md §6-3 · 15
 *
 * - 언어 탭(한국어 · 日本語 · English)마다 칸을 따로 쓴다. 와이파이 이름 · 비밀번호는 모든 언어에 같은 한 칸.
 * - 직원용 칸(출입 코드 · 운영 메모)은 여기서 고치지 않는다 — 있는지만 보이고 「손님에게 안 감」을 적는다.
 * - 저장은 손님용 칸만(`saveBuildingGuestInfoAction`, `property_info.edit`). 남이 먼저 저장했으면 **쓴 글은 그대로 두고**
 *   「최신 값 불러오기 / 내 글로 덮기」를 고르게 한다(버전은 최신으로 바꿔 둔다 — 덮기는 그 버전으로 다시 저장).
 * - 고친 채로 닫으면(바깥 · X · Esc · 닫기) 확인 창. 건물이 바뀌면 처음부터 다시 읽는다(`key` = 건물).
 * - 출입 코드는 개수만 받는다(값은 서버 밖으로 안 나옴).
 */

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { loadBuildingGuestInfoAction, saveBuildingGuestInfoAction } from "@/app/admin/calendar/actions";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { useBuildingName } from "@/components/shared/building-names";
import { INSERT_FIELD_LABEL } from "@/components/guest-messages/composer-inserts";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { GmConfirm } from "@/components/guest-messages/gm-parts";
import { haptic } from "@/lib/haptics";
import "@/components/guest-messages/guest-messages.css";
import {
  GUEST_LANGS,
  guestInfoFillCount,
  type GuestInfo,
  type GuestLang,
  type LocalizedGuestField,
} from "@/lib/guest-messages/guest-info-model";
import type { BuildingGuestInfoView } from "@/lib/guest-messages/guest-info-server";

const LANG_KEY: Record<GuestLang, "langAutonymKo" | "langAutonymJa" | "langAutonymEn"> = { ko: "langAutonymKo", ja: "langAutonymJa", en: "langAutonymEn" };

/** 칸 배치 — 시안 R2Building(체크인 · 체크아웃 반 칸, 나머지 한 줄). */
const LOCALIZED_LAYOUT: Array<{ field: LocalizedGuestField; span: boolean; multiline?: boolean }> = [
  { field: "checkIn", span: false },
  { field: "checkOut", span: false },
  { field: "luggage", span: true },
  { field: "trash", span: true },
  { field: "parking", span: true },
  { field: "directions", span: true, multiline: true },
  { field: "freeText", span: true, multiline: true },
];

type Load =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; building: BuildingGuestInfoView; canEdit: boolean };

type PanelProps = {
  canonicalName: string;
  copy: GmCopy;
  locale: string;
  onClose: () => void;
  notify: (message: string) => void;
  /** 저장이 끝난 뒤(답장 칸 넣기 목록을 다시 읽게). */
  onSaved?: (canonicalName: string) => void;
};

/** 건물이 바뀌면 상태를 통째로 새로(읽는 중부터) — 앞 건물의 값 · 버전이 남지 않게. */
export function BuildingGuestInfoPanel(props: PanelProps) {
  return <GuestInfoPanelBody key={props.canonicalName} {...props} />;
}

function GuestInfoPanelBody({ canonicalName, copy, locale, onClose, notify, onSaved }: PanelProps) {
  const buildingName = useBuildingName();
  const [confirmClose, setConfirmClose] = useState(false);
  const [conflict, setConflict] = useState(false);
  const titleId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [draft, setDraft] = useState<GuestInfo | null>(null);
  const [lang, setLang] = useState<GuestLang>(GUEST_LANGS.includes(locale as GuestLang) ? (locale as GuestLang) : "en");
  const [saving, startSaving] = useTransition();
  const [, startLoading] = useTransition();

  useEffect(() => {
    let alive = true;
    startLoading(async () => {
      const result = await loadBuildingGuestInfoAction(canonicalName);
      if (!alive) return;
      if (result.ok) {
        setLoad({ kind: "ready", building: result.building, canEdit: result.canEdit });
        setDraft(result.building.guestInfo);
      } else {
        setLoad({ kind: "failed" });
      }
    });
    return () => {
      alive = false;
    };
  }, [canonicalName]);

  const fillCount = draft ? guestInfoFillCount(draft) : null;
  const canEdit = load.kind === "ready" && load.canEdit;
  const dirty = load.kind === "ready" && draft !== null && JSON.stringify(draft) !== JSON.stringify(load.building.guestInfo);
  // 고친 채로 닫으려 하면 확인 — 바깥 · X · Esc · 닫기 모두 여기로.
  const requestClose = useCallback(() => {
    if (dirty && canEdit) setConfirmClose(true);
    else onClose();
  }, [dirty, canEdit, onClose]);
  const panelRef = useAdminPanelA11y<HTMLElement>(requestClose, { disabled: confirmClose });

  const setLocalized = (field: LocalizedGuestField, value: string) =>
    setDraft((current) => (current ? { ...current, [field]: { ...current[field], [lang]: value } } : current));

  const save = () => {
    if (load.kind !== "ready" || !draft || saving) return;
    startSaving(async () => {
      const result = await saveBuildingGuestInfoAction({
        canonicalName: load.building.canonicalName,
        guestInfo: draft,
        expectedUpdatedAt: load.building.guestInfoUpdatedAt,
      });
      if (result.ok) {
        setLoad({ kind: "ready", building: result.building, canEdit: true });
        setDraft(result.building.guestInfo);
        setConflict(false);
        haptic("success");
        notify(copy.guestInfoSaved);
        onSaved?.(result.building.canonicalName);
        return;
      }
      haptic("error");
      if (result.error === "conflict") {
        // 쓴 글(draft)은 그대로. 기준 · 버전만 최신으로 — 「내 글로 덮기」는 그 버전으로 다시 저장한다.
        setLoad({ kind: "ready", building: result.current, canEdit: true });
        setConflict(true);
        return;
      }
      notify(
        result.error === "forbidden" ? copy.guestInfoForbidden : result.error === "too_long" ? copy.guestInfoTooLong : copy.guestInfoFailed,
      );
    });
  };

  const emptyNames = fillCount?.empty.map((key) => copy[INSERT_FIELD_LABEL[key]] as string) ?? [];
  const kicker = fillCount
    ? emptyNames.length > 0
      ? fill(copy.guestInfoFillEmpty, { total: fillCount.total, filled: fillCount.filled, fields: emptyNames.join(" · ") })
      : fill(copy.guestInfoFill, { total: fillCount.total, filled: fillCount.filled })
    : copy.guestInfoKicker;

  return (
    <>
      <div className="panel-scrim on" onClick={requestClose} aria-hidden="true" />
      <aside ref={panelRef} className="panel on gm-root gm-ginfo-panel" role="dialog" aria-labelledby={titleId} tabIndex={-1}>
        <div className="panel__h">
          <div className="panel__top">
            <span className="panel__kicker">{kicker}</span>
            <button type="button" className="panel__x" onClick={requestClose} aria-label={copy.guestInfoClose}>
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="panel__title">
            <span className="panel__room" id={titleId}>
              {buildingName(canonicalName)}
            </span>
          </div>
        </div>
        <div className="panel__body">
          {load.kind === "loading" ? (
            <p className="gm-hint" aria-busy="true">
              {copy.loading}
            </p>
          ) : load.kind === "failed" || !draft ? (
            <p className="gm-set__error" role="alert">
              {copy.guestInfoLoadFailed}
            </p>
          ) : (
            <>
              <p className="gm-set__body" style={{ margin: 0 }}>
                {copy.guestInfoBody}
              </p>
              {!canEdit ? <p className="gm-hint">{copy.guestInfoReadOnly}</p> : null}
              {conflict && load.kind === "ready" ? (
                <div className="gm-conflict" role="alert">
                  <span>{copy.guestInfoConflict}</span>
                  <span className="gm-conflict__acts">
                    <button
                      type="button"
                      className="gm-btn gm-btn--sm"
                      onClick={() => {
                        haptic("light");
                        setDraft(load.building.guestInfo);
                        setConflict(false);
                      }}
                    >
                      {copy.guestInfoConflictLoad}
                    </button>
                    <button type="button" className="gm-btn gm-btn--sm gm-btn--primary" disabled={saving} onClick={save}>
                      {copy.guestInfoConflictOverwrite}
                    </button>
                  </span>
                </div>
              ) : null}
              <div className="gm-set__head" style={{ alignItems: "center" }}>
                <h3 className="gm-staff__title" style={{ margin: 0 }}>
                  {copy.guestInfoTitle}
                </h3>
                <div className="gm-langseg" role="tablist" aria-label={copy.guestInfoLangLabel}>
                  {GUEST_LANGS.map((code) => (
                    <button key={code} type="button" role="tab" aria-selected={lang === code} onClick={() => setLang(code)}>
                      {copy[LANG_KEY[code]]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="gm-ginfo__grid" role="tabpanel" aria-label={copy[LANG_KEY[lang]]}>
                <label className="gm-notch">
                  <span className="gm-notch__label">{copy.fieldWifiName}</span>
                  <input
                    className="gm-notch__input"
                    value={draft.wifiName}
                    readOnly={!canEdit}
                    maxLength={120}
                    onChange={(event) => setDraft({ ...draft, wifiName: event.target.value })}
                    placeholder={copy.guestInfoPlaceholder}
                  />
                </label>
                <label className="gm-notch">
                  <span className="gm-notch__label">{copy.fieldWifiPassword}</span>
                  <input
                    className="gm-notch__input"
                    value={draft.wifiPassword}
                    readOnly={!canEdit}
                    maxLength={120}
                    autoComplete="off"
                    onChange={(event) => setDraft({ ...draft, wifiPassword: event.target.value })}
                    placeholder={copy.guestInfoPlaceholder}
                  />
                </label>
                <span className="gm-hint gm-notch--span" style={{ marginTop: -12 }}>
                  {copy.guestInfoSharedNote} · {copy.guestInfoEnFallback}
                </span>
                {LOCALIZED_LAYOUT.map(({ field, span, multiline }) => {
                  const label = copy[INSERT_FIELD_LABEL[field]] as string;
                  const common = {
                    className: "gm-notch__input",
                    value: draft[field][lang],
                    readOnly: !canEdit,
                    placeholder: copy.guestInfoPlaceholder,
                    lang,
                  };
                  return (
                    <label key={field} className={span ? "gm-notch gm-notch--span" : "gm-notch"}>
                      <span className="gm-notch__label">{label}</span>
                      {multiline ? (
                        <textarea
                          {...common}
                          rows={2}
                          maxLength={field === "freeText" ? 2000 : 500}
                          onChange={(event) => setLocalized(field, event.target.value)}
                        />
                      ) : (
                        <input {...common} maxLength={500} onChange={(event) => setLocalized(field, event.target.value)} />
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="gm-staff">
                <h3 className="gm-staff__title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  {copy.staffOnlyTitle}
                </h3>
                <div className="gm-staff__row">
                  <span>{copy.staffSharedCodes}</span>
                  <span>{fill(copy.staffCodesCount, { n: load.building.sharedCodeCount })}</span>
                  <span>{copy.staffCodesNote}</span>
                </div>
                <div className="gm-staff__row">
                  <span>{copy.staffRoomCodes}</span>
                  <span>{fill(copy.staffCodesCount, { n: load.building.roomCodeCount })}</span>
                  <span>{copy.staffCodesNote}</span>
                </div>
                <div className="gm-staff__row">
                  <span>{copy.staffNote}</span>
                  <span>{load.building.hasNote ? copy.staffNoteHas : copy.statNone}</span>
                  <span>{copy.staffNoteNote}</span>
                </div>
                <span className="gm-hint" style={{ paddingTop: 6 }}>
                  {copy.staffEditInCalendar}
                </span>
              </div>
            </>
          )}
        </div>
        {canEdit ? (
          <div className="panel__foot">
            <button type="button" className="btn btn--ghost" onClick={requestClose}>
              {copy.guestInfoClose}
            </button>
            <button type="button" className="btn btn--pri" disabled={!dirty || saving} onClick={save}>
              {saving ? copy.settingsSaving : copy.guestInfoSave}
            </button>
          </div>
        ) : null}
      </aside>
      {confirmClose ? (
        <GmConfirm
          title={copy.guestInfoUnsavedTitle}
          body={copy.guestInfoUnsavedBody}
          confirmLabel={copy.replyDiscard}
          cancelLabel={copy.replyCancel}
          onConfirm={() => {
            setConfirmClose(false);
            onClose();
          }}
          onCancel={() => setConfirmClose(false)}
        />
      ) : null}
    </>
  );
}
