"use client";

/**
 * 답장 칸 「정해 둔 문구」 · 「건물 정보 넣기」 — PC 팝오버(시안 R2Main) · 폰 공용 `BottomSheet`(시안 R2PhoneThread).
 * docs/product/47-guest-messaging.md §6-3
 *
 * - 목록은 **열 때마다** 다시 읽는다(`getComposerInserts`) — 건물 정보 · 문구를 고친 뒤 옛 값이 남지 않게. 앞에 읽은 값은 읽는 동안
 *   그대로 보인다(깜빡임 없음). 언어마다 넣을 글을 서버가 다 만들어 주므로, 번역 대상만 바꿀 때는 다시 안 읽는다.
 * - 넣을 언어 = `insertLanguageFor`(번역 안 하면 손님 언어, 번역해서 보내면 직원 언어). 값이 비면 영어, 그것도 비면 흐리게 「비어 있음」.
 * - 출입 코드는 손님용 목록과 따로(자물쇠 · 직원용 안내) — 눌러 넣을 수는 있지만 확인하라는 글을 같이 보인다.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { getComposerInserts, type ComposerInserts } from "@/actions/guest-messages-compose";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useBuildingName } from "@/components/shared/building-names";
import { fill, languageName, type GmCopy } from "@/components/guest-messages/gm-format";
import { insertLanguageFor, type GuestInsertKey } from "@/lib/guest-messages/guest-info-model";
import { haptic } from "@/lib/haptics";

type Panel = "none" | "replies" | "building";

export const INSERT_FIELD_LABEL: Record<GuestInsertKey, keyof GmCopy> = {
  wifi: "fieldWifi",
  checkIn: "fieldCheckIn",
  checkOut: "fieldCheckOut",
  luggage: "fieldLuggage",
  parking: "fieldParking",
  trash: "fieldTrash",
  directions: "fieldDirections",
  freeText: "fieldFreeText",
};

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; data: ComposerInserts } | { kind: "failed" };

export function InsertTools({
  conversationId,
  guestLanguage,
  translateTarget,
  locale,
  copy,
  variant,
  canManageReplies,
  onInsert,
  onEditBuilding,
  notify,
  refreshKey = 0,
}: {
  conversationId: string;
  guestLanguage: string | null;
  translateTarget: string | null;
  locale: string;
  copy: GmCopy;
  variant: "pc" | "phone";
  canManageReplies: boolean;
  onInsert: (text: string) => void;
  /** PC 만 — 건물 정보 고치기 패널 열기. */
  onEditBuilding?: (canonicalName: string) => void;
  notify: (message: string) => void;
  /** 바뀌면 목록을 다시 읽는다(건물 정보 저장 뒤). */
  refreshKey?: number;
}) {
  const [panel, setPanel] = useState<Panel>("none");
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const lang = insertLanguageFor(guestLanguage, translateTarget, locale);
  const langName = languageName(lang, locale) ?? lang;

  const reload = () => {
    // 이미 읽은 값이 있으면 그대로 두고 뒤에서 새로 — 실패해도 앞 값을 지우지 않는다.
    setLoad((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    startTransition(async () => {
      const result = await getComposerInserts(conversationId);
      setLoad((current) => (result.ok ? { kind: "ready", data: result.data } : current.kind === "ready" ? current : { kind: "failed" }));
    });
  };

  const open = (next: Panel) => {
    haptic("light");
    const opening = panel !== next;
    setPanel(opening ? next : "none");
    if (opening) reload();
  };

  // 건물 정보를 고쳐 저장하면(패널) 부모가 `refreshKey` 를 올린다 — 다음에 열 때가 아니라 지금 다시 읽는다.
  const firstRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefresh.current) return;
    firstRefresh.current = refreshKey;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 숫자가 바뀔 때만
  }, [refreshKey]);

  // PC 팝오버 — 바깥 누르기 · Esc 로 닫기.
  useEffect(() => {
    if (variant !== "pc" || panel === "none") return;
    const onDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setPanel("none");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel("none");
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel, variant]);

  const insert = (text: string, missing = false) => {
    haptic("light");
    onInsert(text);
    setPanel("none");
    if (missing) notify(copy.insertMissingVars);
  };

  const body =
    panel === "none" ? null : (
      <InsertList
        panel={panel}
        load={load}
        lang={lang}
        langName={langName}
        copy={copy}
        variant={variant}
        canManageReplies={canManageReplies}
        onInsert={insert}
        onRetry={reload}
        onEditBuilding={
          onEditBuilding
            ? (name) => {
                setPanel("none");
                onEditBuilding(name);
              }
            : undefined
        }
      />
    );

  const buttonClass = variant === "pc" ? "gm-btn" : "gm-chipbtn";
  return (
    <div className="gm-inserts" ref={wrapRef} data-variant={variant}>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={panel === "replies"}
        aria-haspopup="dialog"
        aria-pressed={variant === "pc" ? panel === "replies" : undefined}
        onClick={() => open("replies")}
      >
        {copy.insertSaved}
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={panel === "building"}
        aria-haspopup="dialog"
        aria-pressed={variant === "pc" ? panel === "building" : undefined}
        onClick={() => open("building")}
      >
        {variant === "pc" ? copy.insertBuilding : copy.insertBuildingShort}
      </button>
      {variant === "pc" && body ? (
        <div className="gm-insert-pop" role="dialog" aria-label={panel === "replies" ? copy.insertSavedTitle : copy.insertBuilding}>
          {body}
        </div>
      ) : null}
      {variant === "phone" && body ? (
        <BottomSheet
          onClose={() => setPanel("none")}
          ariaLabel={panel === "replies" ? copy.insertSavedTitle : copy.insertBuilding}
          className="gm-root"
        >
          <div className="gm-sheet gm-insert-sheet">{body}</div>
        </BottomSheet>
      ) : null}
    </div>
  );
}

function InsertList({
  panel,
  load,
  lang,
  langName,
  copy,
  variant,
  canManageReplies,
  onInsert,
  onRetry,
  onEditBuilding,
}: {
  panel: Exclude<Panel, "none">;
  load: LoadState;
  lang: "ko" | "ja" | "en";
  langName: string;
  copy: GmCopy;
  variant: "pc" | "phone";
  canManageReplies: boolean;
  onInsert: (text: string, missing?: boolean) => void;
  onRetry: () => void;
  onEditBuilding?: (canonicalName: string) => void;
}) {
  const buildingName = useBuildingName();
  const titleTag = variant === "phone" ? "h2" : "b";
  const Title = titleTag;

  if (load.kind !== "ready") {
    return (
      <>
        <div className="gm-insert__head">
          <Title className="gm-insert__title">{panel === "replies" ? copy.insertSavedTitle : copy.insertBuilding}</Title>
        </div>
        {load.kind === "failed" ? (
          <div className="gm-insert__state">
            <span>{copy.insertLoadFailed}</span>
            <button type="button" className="gm-link" onClick={onRetry}>
              {copy.retryLoad}
            </button>
          </div>
        ) : (
          <p className="gm-insert__state" aria-busy="true">
            {copy.loading}
          </p>
        )}
      </>
    );
  }

  const { data } = load;
  if (panel === "replies") {
    return (
      <>
        <div className="gm-insert__head">
          <Title className="gm-insert__title">{copy.insertSavedTitle}</Title>
          <span className="gm-insert__lang">{fill(copy.insertInLang, { lang: langName })}</span>
        </div>
        {data.replies.length === 0 ? (
          <p className="gm-insert__state">{copy.insertSavedEmpty}</p>
        ) : (
          <div className="gm-insert__list">
            {data.replies.map((reply) => {
              const picked = reply.byLang[lang];
              return (
                <button
                  key={reply.id}
                  type="button"
                  className="gm-insert__item gm-insert__item--reply"
                  disabled={!picked}
                  onClick={() => picked && onInsert(picked.text, picked.missing.length > 0)}
                >
                  <span className="gm-insert__k">{reply.title}</span>
                  <span className="gm-insert__v">{picked ? picked.text : copy.insertNoLang}</span>
                </button>
              );
            })}
          </div>
        )}
        {canManageReplies && variant === "pc" ? (
          <Link className="gm-insert__foot" href="/admin/messages?tab=replies">
            {copy.insertSavedManage}
          </Link>
        ) : null}
      </>
    );
  }

  const building = data.building;
  return (
    <>
      <div className="gm-insert__head">
        <Title className="gm-insert__title">
          {building ? fill(copy.insertBuildingTitle, { building: buildingName(building.canonicalName) }) : copy.insertBuilding}
        </Title>
        {building ? <span className="gm-insert__lang">{fill(copy.insertInLang, { lang: langName })}</span> : null}
      </div>
      {!building ? (
        <p className="gm-insert__state">{copy.insertNoBuilding}</p>
      ) : (
        <>
          <div className="gm-insert__list">
            {building.inserts[lang].map((item) => (
              <button
                key={item.key}
                type="button"
                className="gm-insert__item"
                disabled={!item.text}
                onClick={() => item.text && onInsert(item.text)}
              >
                <span className="gm-insert__k">{copy[INSERT_FIELD_LABEL[item.key]] as string}</span>
                <span className="gm-insert__v" data-empty={item.text ? undefined : ""}>
                  {item.text ?? copy.insertEmpty}
                </span>
              </button>
            ))}
          </div>
          {building.staffCodes.length > 0 ? (
            <div className="gm-insert__staff">
              <span className="gm-insert__stafftitle">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
                {copy.insertStaffTitle}
              </span>
              <span className="gm-hint">{copy.insertStaffNote}</span>
              {building.staffCodes.map((code) => (
                <button
                  key={`${code.label}:${code.code}`}
                  type="button"
                  className="gm-insert__item"
                  onClick={() => onInsert(code.code)}
                >
                  <span className="gm-insert__k">{code.label}</span>
                  <span className="gm-insert__v gm-insert__code">{code.code}</span>
                </button>
              ))}
            </div>
          ) : null}
          {data.canEditBuilding && onEditBuilding ? (
            <button type="button" className="gm-insert__foot" onClick={() => onEditBuilding(building.canonicalName)}>
              {copy.insertEditBuilding}
            </button>
          ) : null}
        </>
      )}
    </>
  );
}
