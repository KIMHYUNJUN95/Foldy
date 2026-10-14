"use client";

// 공지 작성 · 수정 — 화이트 리디자인(2026-10-15, 시안 NoticeNew-PC). 모달 대신 목록 자리에 펼치는 작성 화면.
// 왼쪽은 제목 · 본문 · 사진(≤5), 오른쪽은 게시 설정(대상 · 중요 · 고정 · 팝업 + 끝나는 날)과 저장 버튼.
// 사진은 저장할 때 브라우저에서 Storage 로 바로 올리고(Server Action 크기 제한 우회) URL 만 액션에 넘긴다.
// See docs/product/11-announcement-workflow.md → Composer / Edit Flow.
import Image from "next/image";
import { startTransition, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, Plus, X } from "lucide-react";
import { AdmDropdown, type AdmOption } from "@/components/admin/shared/adm-dropdown";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import {
  cleanupAnnouncementImagePaths,
  saveAnnouncementConsole,
} from "@/app/admin/announcements/actions";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import { organizationRoles, type OrganizationRole } from "@/config/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { haptic } from "@/lib/haptics";
import type { AnnouncementWhiteCopy } from "@/lib/announcement-i18n";
import type { AdminAnnouncementRoleCount, AdminAnnouncementVM } from "@/lib/admin-announcements";
import { type AnnCopy, type RoleLabel, tokyoDateKey, tokyoTimeHm } from "./announcements-console-shared";

const BUCKET = "announcement-images";
const MAX_IMAGES = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];

type NewImage = { id: string; file: File; previewUrl: string };

function fileExtension(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  return file.type.split("/")[1] ?? "jpg";
}

export function AnnouncementComposer({
  item,
  w,
  t,
  localeTag,
  roleLabel,
  organizations,
  roleCountsByOrg,
  orgMemberTotal,
  onClose,
  onSaved,
}: {
  /** 없으면 새 공지. */
  item: AdminAnnouncementVM | null;
  w: AnnouncementWhiteCopy;
  t: AnnCopy;
  localeTag: string;
  roleLabel: RoleLabel;
  organizations: { id: string; name: string }[];
  roleCountsByOrg: Record<string, AdminAnnouncementRoleCount[]>;
  orgMemberTotal: Record<string, number>;
  onClose: () => void;
  onSaved: (published: boolean) => void;
}) {
  const isNew = item === null;
  // 게시 중인 공지를 고칠 때는 게시 상태 그대로 「저장」만 — 초안으로 내리는 건 패널의 「초안으로」가 맡는다.
  const editingLive = item?.status === "published";
  const [org, setOrg] = useState(() => item?.organizationId ?? organizations[0]?.id ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.content ?? "");
  const [scope, setScope] = useState<"everyone" | "roles">(item?.targetScope ?? "everyone");
  const [roles, setRoles] = useState<OrganizationRole[]>(item?.targetRoles ?? []);
  const [important, setImportant] = useState(item?.isImportant ?? false);
  const [pinned, setPinned] = useState(item?.isPinned ?? false);
  const [popup, setPopup] = useState(item?.popup ?? false);
  // `popup_until` 은 UTC 시각으로 저장되고, 화면은 도쿄 날짜를 고친다. 시각은 원래 값(없으면 23:59)을 지킨다.
  const [popupDate, setPopupDate] = useState(() => tokyoDateKey(item?.popupUntil ?? null));
  const popupTime = tokyoTimeHm(item?.popupUntil ?? null) || "23:59";
  const [existingImages, setExistingImages] = useState<string[]>(item?.images ?? []);
  const [newImages, setNewImages] = useState<NewImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingAs, setSavingAs] = useState<"draft" | "published" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startServerTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [leaving, setLeaving] = useState(false);
  const busy = pending || uploading;
  const totalImages = existingImages.length + newImages.length;
  // 처음 값에서 하나라도 바뀌었으면 나갈 때 묻는다.
  const dirty =
    title !== (item?.title ?? "") ||
    body !== (item?.content ?? "") ||
    newImages.length > 0 ||
    existingImages.length !== (item?.images.length ?? 0) ||
    scope !== (item?.targetScope ?? "everyone") ||
    roles.join() !== (item?.targetRoles ?? []).join() ||
    important !== (item?.isImportant ?? false) ||
    pinned !== (item?.isPinned ?? false) ||
    popup !== (item?.popup ?? false) ||
    popupDate !== tokyoDateKey(item?.popupUntil ?? null);

  useEffect(() => {
    if (!dirty || savingAs) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, savingAs]);

  const leave = () => (dirty ? setLeaving(true) : onClose());

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  // 미리보기 주소는 화면을 떠날 때 돌려준다.
  const previewsRef = useRef(newImages);
  useEffect(() => {
    previewsRef.current = newImages;
  }, [newImages]);
  useEffect(() => () => previewsRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl)), []);

  const roleCounts = useMemo(() => new Map((roleCountsByOrg[org] ?? []).map((r) => [r.role, r.count])), [org, roleCountsByOrg]);
  const recipients =
    scope === "everyone" ? (orgMemberTotal[org] ?? 0) : roles.reduce((sum, role) => sum + (roleCounts.get(role) ?? 0), 0);

  const orgOptions: AdmOption[] = organizations.map((o) => ({ value: o.id, label: o.name }));

  function toggleRole(role: OrganizationRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    if (picked.some((f) => !ALLOWED_TYPES.includes(f.type))) return setError(t.fImgBadType);
    if (totalImages + picked.length > MAX_IMAGES) return setError(t.fImgTooMany);
    if (picked.some((f) => f.size > MAX_BYTES)) return setError(t.fImgTooLarge);
    setError(null);
    void Promise.all(
      picked.map(async (file) => {
        const compressed = await compressImageFile(file);
        return { id: crypto.randomUUID(), file: compressed, previewUrl: URL.createObjectURL(compressed) };
      }),
    ).then((items) => setNewImages((prev) => [...prev, ...items]));
  }

  function removeNew(id: string) {
    setNewImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  async function submit(status: "draft" | "published") {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) {
      titleRef.current?.focus();
      return setError(t.vTitleRequired);
    }
    if (!trimmedBody) {
      bodyRef.current?.focus();
      return setError(t.vBodyRequired);
    }
    if (scope === "roles" && roles.length === 0) return setError(t.vRolesRequired);
    if (isNew && !org) return setError(t.errProcess);
    setError(null);
    setSavingAs(status);

    const announcementId = item?.id ?? crypto.randomUUID();
    const targetOrg = item?.organizationId ?? org;
    const uploadedUrls: string[] = [];
    const uploadedPaths: string[] = [];
    const cleanup = () => {
      if (isNew && uploadedPaths.length > 0) {
        startTransition(async () => {
          await cleanupAnnouncementImagePaths(announcementId, uploadedPaths);
        });
      }
    };

    if (newImages.length > 0) {
      setUploading(true);
      try {
        const supabase = getSupabaseBrowserClient();
        for (const image of newImages) {
          const path = `${targetOrg}/${announcementId}/${crypto.randomUUID()}.${fileExtension(image.file)}`;
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, image.file, { contentType: image.file.type, upsert: false });
          if (uploadError) throw uploadError;
          uploadedPaths.push(path);
          uploadedUrls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
        }
      } catch {
        cleanup();
        haptic("error");
        setError(t.errProcess);
        setUploading(false);
        setSavingAs(null);
        return;
      }
      setUploading(false);
    }

    // 고른 값은 도쿄 날짜라 +09:00 을 붙여 보낸다(붙이지 않으면 서버 시간대로 읽혀 9시간 밀린다).
    const popupUntil = popup && popupDate ? `${popupDate}T${popupTime}:00+09:00` : null;

    startServerTransition(async () => {
      const result = await saveAnnouncementConsole({
        announcementId,
        organizationId: targetOrg,
        title: trimmedTitle,
        content: trimmedBody,
        status,
        targetScope: scope,
        targetRoles: scope === "roles" ? roles : [],
        imageUrls: [...existingImages, ...uploadedUrls],
        isImportant: important,
        isPinned: pinned,
        showPopup: popup,
        popupUntil,
      });
      setSavingAs(null);
      if (result.ok) {
        haptic("success");
        onSaved(status === "published");
      } else {
        haptic("error");
        setError(t.errProcess);
      }
    });
  }

  const sw = (on: boolean, label: string, sub: string, onToggle: () => void) => (
    <div className="anw-swrow">
      <span className="anw-swrow__t">
        <b>{label}</b>
        <span>{sub}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`anw-sw${on ? " on" : ""}`} onClick={onToggle} disabled={busy}>
        <i />
      </button>
    </div>
  );

  const busyLabel = uploading ? w.uploading : w.saving;

  return (
    <div className="anw-cmp">
      <div className="anw-cmp__main">
        <button type="button" className="anw-back" onClick={leave} disabled={busy}>
          <ChevronLeft aria-hidden="true" />
          {w.back}
        </button>
        <h2 className="anw-cmp__t">{isNew ? w.newTitle : w.editTitle}</h2>

        {isNew && organizations.length > 1 ? (
          <div className="anw-cmp__org">
            <span className="anw-k">{w.org}</span>
            <AdmDropdown options={orgOptions} value={org} onChange={setOrg} ariaLabel={w.org} />
          </div>
        ) : null}

        <label className="anw-nf">
          <span>{w.fTitle}</span>
          <input
            ref={titleRef}
            name="title"
            autoComplete="off"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={w.fTitlePh}
            maxLength={200}
            disabled={busy}
          />
        </label>
        <label className="anw-nf">
          <span>{w.fBody}</span>
          <textarea ref={bodyRef} name="body" rows={13} value={body} onChange={(event) => setBody(event.target.value)} placeholder={w.fBodyPh} disabled={busy} />
        </label>

        <div className="anw-photos">
          {existingImages.map((url) => (
            <div className="anw-pic" key={url}>
              <Image alt="" src={url} fill sizes="96px" />
              <button type="button" className="anw-pic__x" onClick={() => setExistingImages((prev) => prev.filter((u) => u !== url))} aria-label={w.photoRemove} disabled={busy}>
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          {newImages.map((image) => (
            <div className="anw-pic" key={image.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 아직 올리지 않은 로컬 미리보기(blob:) */}
              <img alt="" src={image.previewUrl} />
              <button type="button" className="anw-pic__x" onClick={() => removeNew(image.id)} aria-label={w.photoRemove} disabled={busy}>
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          {totalImages < MAX_IMAGES ? (
            <button type="button" className="anw-pic is-add" onClick={() => fileRef.current?.click()} aria-label={w.photoAdd} disabled={busy}>
              <Plus aria-hidden="true" />
            </button>
          ) : null}
          <span className="anw-photos__n num">{w.photoCount.replace("{n}", String(totalImages))}</span>
          <input ref={fileRef} type="file" accept="image/gif,image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={handlePick} tabIndex={-1} />
        </div>

        {error ? (
          <p className="anw-err" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <aside className="anw-cmp__side" aria-label={w.settings}>
        <h3>{w.settings}</h3>
        <div className="anw-field">
          <span className="anw-k">{w.target}</span>
          <div className="anw-seg" role="radiogroup" aria-label={w.target}>
            <button type="button" role="radio" aria-checked={scope === "everyone"} className={scope === "everyone" ? "on" : ""} onClick={() => setScope("everyone")} disabled={busy}>
              {w.scopeEveryone}
            </button>
            <button type="button" role="radio" aria-checked={scope === "roles"} className={scope === "roles" ? "on" : ""} onClick={() => setScope("roles")} disabled={busy}>
              {w.scopeRoles}
            </button>
          </div>
          {scope === "roles" ? (
            <div className="anw-roles">
              {organizationRoles.map((role) => (
                <button type="button" key={role} aria-pressed={roles.includes(role)} className={roles.includes(role) ? "on" : ""} onClick={() => toggleRole(role)} disabled={busy}>
                  {roleLabel(role)}
                </button>
              ))}
            </div>
          ) : null}
          <span className="anw-soft num">{w.recipients.replace("{n}", String(recipients))}</span>
        </div>

        <div className="anw-sws">
          {sw(important, w.fImportant, w.fImportantSub, () => setImportant((v) => !v))}
          {sw(pinned, w.fPinned, w.fPinnedSub, () => setPinned((v) => !v))}
          {sw(popup, w.fPopup, w.fPopupSub, () => setPopup((v) => !v))}
          {popup ? (
            <div className="anw-until">
              <span>{w.fPopupEnd}</span>
              {/* 콘솔 공용 날짜 고르기만 쓴다 — 브라우저 기본 달력(<input type="date">) 금지(CLAUDE.md §4a). */}
              <AdminDatePicker
                value={popupDate}
                onChange={setPopupDate}
                localeTag={localeTag}
                ariaLabel={w.fPopupEnd}
                placeholder={w.fPopupEndPh}
                labels={{ prevMonth: t.datePickerPrevMonth, nextMonth: t.datePickerNextMonth, today: t.datePickerToday }}
              />
            </div>
          ) : null}
        </div>

        <div className="anw-cmp__foot">
          <span className="anw-soft" aria-live="polite">
            {busy ? busyLabel : w.publishHint}
          </span>
          {editingLive ? (
            <div className="anw-two">
              <button type="button" className="anw-btn is-gray" onClick={leave} disabled={busy}>
                {w.cancel}
              </button>
              <button type="button" className="anw-btn is-pri" onClick={() => submit("published")} disabled={busy} aria-busy={savingAs === "published"}>
                {w.save}
              </button>
            </div>
          ) : (
            <div className="anw-two">
              <button type="button" className="anw-btn is-gray" onClick={() => submit("draft")} disabled={busy} aria-busy={savingAs === "draft"}>
                {w.saveDraft}
              </button>
              <button type="button" className="anw-btn is-pri" onClick={() => submit("published")} disabled={busy} aria-busy={savingAs === "published"}>
                {w.publish}
              </button>
            </div>
          )}
        </div>
      </aside>

      {leaving ? <LeaveConfirm w={w} onStay={() => setLeaving(false)} onLeave={onClose} /> : null}
    </div>
  );
}

function LeaveConfirm({ w, onStay, onLeave }: { w: AnnouncementWhiteCopy; onStay: () => void; onLeave: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onStay();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onStay]);
  return (
    <>
      <div className="modal-scrim on anw-scrim" onClick={onStay} />
      <div className="modal on anw-modal" role="alertdialog" aria-modal="true" aria-labelledby="anw-leave-t" aria-describedby="anw-leave-b">
        <div className="anw-modal__h">
          <h2 id="anw-leave-t">{w.leaveT}</h2>
        </div>
        <p id="anw-leave-b" className="anw-modal__b">
          {w.leaveS}
        </p>
        <div className="anw-modal__f">
          {/* 첫 초점은 「그대로 두기」 — 실수로 쓴 내용을 버리지 않게. */}
          <button type="button" className="anw-btn is-gray" onClick={onStay} autoFocus>
            {w.keep}
          </button>
          <button type="button" className="anw-btn is-danger" onClick={onLeave}>
            {w.leaveBtn}
          </button>
        </div>
      </div>
    </>
  );
}
