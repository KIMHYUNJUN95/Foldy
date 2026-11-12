"use client";

/**
 * PC 「정해 둔 문구」 탭 — 왼쪽 목록 · 오른쪽 고치기(시안 R2Building 꼴). docs/product/47-guest-messaging.md §6-3
 * `guest_messages.manage` 만(서버 페이지가 거르고, 액션이 다시 본다). 지우기는 하드 삭제 + 확인 창(CLAUDE.md 9).
 * 고치기 저장은 연 때의 버전(`updated_at`)일 때만 — 남이 먼저 고쳤으면 쓴 글은 두고 「최신 값 불러오기 / 내 글로 덮기」.
 * 순서 바꾸기는 저장 중엔 막는다(DB 함수 한 번).
 */

import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  deleteSavedReplyAction,
  reorderSavedRepliesAction,
  saveSavedReplyAction,
  setResolvedSavedReplyAction,
  type SavedReplyActionResult,
} from "@/app/admin/messages/actions";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { GmConfirm } from "@/components/guest-messages/gm-parts";
import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { GUEST_LANGS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import type { SavedReply } from "@/lib/guest-messages/saved-replies-server";
import { SAVED_REPLY_LIMITS, SAVED_REPLY_VARIABLES, type SavedReplyVariable } from "@/lib/guest-messages/saved-reply-model";
import { haptic } from "@/lib/haptics";

const LANG_KEY: Record<GuestLang, "langAutonymKo" | "langAutonymJa" | "langAutonymEn"> = {
  ko: "langAutonymKo",
  ja: "langAutonymJa",
  en: "langAutonymEn",
};
const VAR_KEY: Record<SavedReplyVariable, keyof GmCopy> = {
  guest_name: "varGuestName",
  checkin_date: "varCheckin",
  checkout_date: "varCheckout",
  nights: "varNights",
  building: "varBuilding",
  room: "varRoom",
};

/** `version` = 고치기 시작할 때 본 `updated_at`(새 문구는 null). */
type Editing = { id: string | null; title: string; bodies: Localized; version: string | null };

const EMPTY: Editing = { id: null, title: "", bodies: { ko: "", ja: "", en: "" }, version: null };

const editingOf = (reply: SavedReply): Editing => ({ id: reply.id, title: reply.title, bodies: { ...reply.bodies }, version: reply.updatedAt });

function errorOf(key: Extract<SavedReplyActionResult, { ok: false }>["errorKey"] | "invalid", copy: GmCopy): string {
  switch (key) {
    case "empty":
      return copy.replyErrEmpty;
    case "too_long":
      return copy.replyErrTooLong;
    case "limit":
      return copy.replyErrLimit;
    case "not_found":
      return copy.replyErrNotFound;
    case "forbidden":
      return copy.forbidden;
    default:
      return copy.replyErrFailed;
  }
}

export function SavedRepliesManager({
  copy,
  locale,
  replies,
  resolvedId = null,
}: {
  copy: GmCopy;
  locale: string;
  replies: SavedReply[] | null;
  /** 「해결 초안」으로 표시한 문구 id(조직마다 하나, 6단계). */
  resolvedId?: string | null;
}) {
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
  const [list, setList] = useState<SavedReply[]>(replies ?? []);
  const [seen, setSeen] = useState(replies);
  const [resolved, setResolved] = useState<string | null>(resolvedId);
  const [seenResolved, setSeenResolved] = useState(resolvedId);
  if (seen !== replies) {
    setSeen(replies);
    setList(replies ?? []);
  }
  if (seenResolved !== resolvedId) {
    setSeenResolved(resolvedId);
    setResolved(resolvedId);
  }
  const [editing, setEditing] = useState<Editing | null>(() => {
    const first = replies?.[0];
    return first ? editingOf(first) : null;
  });
  const [lang, setLang] = useState<GuestLang>(GUEST_LANGS.includes(locale as GuestLang) ? (locale as GuestLang) : "en");
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<{ kind: "delete"; reply: SavedReply } | { kind: "discard"; next: Editing | null } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [conflict, setConflict] = useState(false);
  const reordering = useRef(false);

  if (replies === null) {
    return (
      <div className="gm-root gm-settings">
        <p className="gm-set__error" role="alert">
          {copy.loadFailed}
        </p>
      </div>
    );
  }

  const original = editing?.id ? list.find((reply) => reply.id === editing.id) ?? null : null;
  const dirty = editing
    ? editing.id === null
      ? Boolean(editing.title.trim() || editing.bodies.ko || editing.bodies.ja || editing.bodies.en)
      : !!original && (original.title !== editing.title || GUEST_LANGS.some((l) => original.bodies[l] !== editing.bodies[l]))
    : false;

  const pick = (next: Editing | null) => {
    if (dirty) {
      setConfirm({ kind: "discard", next });
      return;
    }
    setEditing(next);
    setConflict(false);
  };

  const save = () => {
    if (!editing || pending) return;
    startTransition(async () => {
      const result = await saveSavedReplyAction({
        id: editing.id,
        title: editing.title,
        bodies: editing.bodies,
        expectedUpdatedAt: editing.version,
      });
      if (result.ok) {
        haptic("success");
        setList((current) =>
          editing.id ? current.map((reply) => (reply.id === result.reply.id ? result.reply : reply)) : [...current, result.reply],
        );
        setEditing(editingOf(result.reply));
        setConflict(false);
        showToast(copy.replySaved);
        router.refresh();
      } else if (result.errorKey === "conflict") {
        // 쓴 글은 그대로 — 기준 · 버전만 최신으로(덮기는 그 버전으로 다시 저장).
        haptic("error");
        const latest = result.current;
        setList((current) => current.map((reply) => (reply.id === latest.id ? latest : reply)));
        setEditing((current) => (current && current.id === latest.id ? { ...current, version: latest.updatedAt } : current));
        setConflict(true);
      } else {
        haptic("error");
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const remove = (reply: SavedReply) => {
    setConfirm(null);
    startTransition(async () => {
      const result = await deleteSavedReplyAction(reply.id);
      if (result.ok) {
        haptic("light");
        setList((current) => current.filter((item) => item.id !== reply.id));
        if (editing?.id === reply.id) setEditing(null);
        showToast(copy.replyDeleted);
        router.refresh();
      } else {
        haptic("error");
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  // 「해결 초안」 표시 — 누르면 바로 저장(문구 글 저장과 따로). 실패하면 그대로 되돌린다.
  const toggleResolved = (reply: SavedReply) => {
    if (pending) return;
    const next = resolved === reply.id ? null : reply.id;
    const before = resolved;
    setResolved(next);
    haptic("light");
    startTransition(async () => {
      const result = await setResolvedSavedReplyAction(next);
      if (result.ok) {
        showToast(next ? copy.savedReplyResolvedSaved : copy.savedReplyResolvedCleared);
        router.refresh();
      } else {
        setResolved(before);
        haptic("error");
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length || pending || reordering.current) return;
    reordering.current = true;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    const before = list;
    setList(next);
    haptic("light");
    startTransition(async () => {
      const result = await reorderSavedRepliesAction(next.map((reply) => reply.id));
      reordering.current = false;
      if (!result.ok) {
        haptic("error");
        setList(before);
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const insertVariable = (name: SavedReplyVariable) => {
    if (!editing) return;
    const token = `{${name}}`;
    const el = bodyRef.current;
    const value = editing.bodies[lang];
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
    setEditing({ ...editing, bodies: { ...editing.bodies, [lang]: nextValue } });
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const langsOf = (bodies: Localized) => {
    const names = GUEST_LANGS.filter((l) => bodies[l].trim()).map((l) => copy[LANG_KEY[l]]);
    return names.length ? names.join(" · ") : copy.replyLangsNone;
  };

  return (
    <div className="gm-root gm-replies">
      <section className="gm-replies__list" aria-label={copy.repliesListLabel}>
        <div className="gm-replies__top">
          <p>{copy.repliesBody}</p>
          <button
            type="button"
            className="gm-btn gm-btn--primary gm-btn--lg"
            disabled={list.length >= SAVED_REPLY_LIMITS.count}
            onClick={() => pick({ ...EMPTY, bodies: { ...EMPTY.bodies } })}
          >
            {copy.repliesAdd}
          </button>
        </div>
        {list.length === 0 && editing?.id !== null ? (
          <div className="gm-empty">
            <b>{copy.repliesEmpty}</b>
            <span>{copy.repliesEmptyHint}</span>
          </div>
        ) : null}
        {list.map((reply, index) => (
          <div key={reply.id} className="gm-reply-row" data-selected={editing?.id === reply.id ? "" : undefined}>
            <button
              type="button"
              className="gm-reply-row__main"
              aria-current={editing?.id === reply.id ? "true" : undefined}
              onClick={() => pick(editingOf(reply))}
            >
              <b>
                {reply.title}
                {resolved === reply.id ? <em className="gm-reply-row__tag">{copy.savedReplyResolvedTag}</em> : null}
              </b>
              <span>{reply.bodies[lang] || reply.bodies.en || reply.bodies.ko || reply.bodies.ja}</span>
            </button>
            <span className="gm-reply-row__langs">{langsOf(reply.bodies)}</span>
            <span className="gm-reply-row__move">
              <button
                type="button"
                className="gm-iconbtn-sm"
                aria-label={`${copy.replyMoveUp} · ${reply.title}`}
                disabled={index === 0 || pending}
                onClick={() => move(index, -1)}
              >
                <ChevronUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="gm-iconbtn-sm"
                aria-label={`${copy.replyMoveDown} · ${reply.title}`}
                disabled={index === list.length - 1 || pending}
                onClick={() => move(index, 1)}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      </section>

      {editing ? (
        <aside className="gm-editor" aria-label={editing.id ? editing.title || copy.replyNew : copy.replyNew}>
          <div>
            <span className="gm-editor__kicker">{copy.tabSavedReplies}</span>
            <h2 className="gm-editor__title">{editing.id ? original?.title ?? editing.title : copy.replyNew}</h2>
          </div>
          {conflict && original ? (
            <div className="gm-conflict" role="alert">
              <span>{copy.replyConflict}</span>
              <span className="gm-conflict__acts">
                <button
                  type="button"
                  className="gm-btn gm-btn--sm"
                  onClick={() => {
                    haptic("light");
                    setEditing(editingOf(original));
                    setConflict(false);
                  }}
                >
                  {copy.replyConflictLoad}
                </button>
                <button type="button" className="gm-btn gm-btn--sm gm-btn--primary" disabled={pending} onClick={save}>
                  {copy.replyConflictOverwrite}
                </button>
              </span>
            </div>
          ) : null}
          <label className="gm-notch" style={{ marginTop: 8 }}>
            <span className="gm-notch__label">{copy.replyTitleLabel}</span>
            <input
              className="gm-notch__input"
              value={editing.title}
              maxLength={SAVED_REPLY_LIMITS.title}
              placeholder={copy.replyTitlePlaceholder}
              onChange={(event) => setEditing({ ...editing, title: event.target.value })}
            />
          </label>
          <div className="gm-set__head" style={{ alignItems: "center" }}>
            <span className="gm-hint">{copy.guestInfoLangLabel}</span>
            <div className="gm-langseg" role="tablist" aria-label={copy.guestInfoLangLabel}>
              {GUEST_LANGS.map((code) => (
                <button key={code} type="button" role="tab" aria-selected={lang === code} onClick={() => setLang(code)}>
                  {copy[LANG_KEY[code]]}
                </button>
              ))}
            </div>
          </div>
          <label className="gm-notch">
            <span className="gm-notch__label">{fill(copy.replyBodyLabel, { lang: copy[LANG_KEY[lang]] })}</span>
            <textarea
              ref={bodyRef}
              className="gm-notch__input"
              rows={8}
              lang={lang}
              value={editing.bodies[lang]}
              maxLength={SAVED_REPLY_LIMITS.body}
              placeholder={copy.replyBodyPlaceholder}
              onChange={(event) => setEditing({ ...editing, bodies: { ...editing.bodies, [lang]: event.target.value } })}
            />
          </label>
          <div className="gm-vars">
            <span className="gm-hint">{copy.replyVariablesTitle}</span>
            {SAVED_REPLY_VARIABLES.map((name) => (
              <button key={name} type="button" className="gm-btn gm-btn--sm" onClick={() => insertVariable(name)}>
                {copy[VAR_KEY[name]] as string}
              </button>
            ))}
          </div>
          {editing.id && original ? (
            <label className="gm-resolved-toggle">
              <input type="checkbox" checked={resolved === original.id} disabled={pending} onChange={() => toggleResolved(original)} />
              <span>{copy.savedReplyResolved}</span>
            </label>
          ) : null}
          <div className="gm-editor__foot">
            {editing.id && original ? (
              <button
                type="button"
                className="gm-iconbtn-sm"
                data-tone="danger"
                aria-label={copy.replyDelete}
                disabled={pending}
                onClick={() => setConfirm({ kind: "delete", reply: original })}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            ) : null}
            {dirty ? (
              <button type="button" className="gm-btn gm-btn--lg" disabled={pending} onClick={() => pick(original ? editingOf(original) : null)}>
                {copy.replyCancel}
              </button>
            ) : null}
            <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={!dirty || pending} onClick={save}>
              {pending ? copy.settingsSaving : copy.replySave}
            </button>
          </div>
        </aside>
      ) : null}

      {confirm?.kind === "delete" ? (
        <GmConfirm
          title={fill(copy.replyDeleteTitle, { title: confirm.reply.title })}
          body={copy.replyDeleteBody}
          confirmLabel={copy.replyDelete}
          cancelLabel={copy.replyCancel}
          onConfirm={() => remove(confirm.reply)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm?.kind === "discard" ? (
        <GmConfirm
          title={copy.replyUnsavedTitle}
          body={copy.replyUnsavedBody}
          confirmLabel={copy.replyDiscard}
          cancelLabel={copy.replyCancel}
          onConfirm={() => {
            setEditing(confirm.next);
            setConflict(false);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
