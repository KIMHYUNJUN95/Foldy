"use client";

// 공지 관리 콘솔 — 화이트 리디자인(2026-10-15, 시안 Notice-PC · NoticeNew-PC).
// 게시 중 · 초안 · 보관 탭(숫자 붙음) + 한 줄 요약 + 목록(제목 · 대상 · 작성자 · 날짜 · 읽음 글자) + 오른쪽 상세 패널
// (본문 · 사진 · 읽음 「안 읽음 | 읽음」 명단 · 관리 버튼). 새 공지 · 수정은 목록 자리에 작성 화면을 펼친다.
// 흰 바탕 · 상자 · 세로선 없음 · 선택은 옅은 보라 바탕만. See docs/product/11-announcement-workflow.md.
import { LiveWash } from "@/components/shared/live-wash";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Pin, Plus, Trash2, X } from "lucide-react";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { getAnnouncementDictionary, type AnnouncementWhiteCopy } from "@/lib/announcement-i18n";
import { haptic } from "@/lib/haptics";
import type { Locale } from "@/lib/i18n";
import type { OrganizationRole } from "@/config/roles";
import type { AdminAnnouncementVM, AdminAnnouncementsData } from "@/lib/admin-announcements";
import {
  deleteAnnouncementConsole,
  getAnnouncementReadStatusConsole,
  setAnnouncementStatusConsole,
} from "@/app/admin/announcements/actions";
import { type AnnCopy, type RoleLabel, initial } from "./announcements-console-shared";
import { annDate, annDateTime, announcementPanelHref, readAnnouncementPanelId } from "@/lib/announcement-display";
import { AnnouncementComposer } from "./announcement-composer";
import "./announcements-white.css";

type Tab = "published" | "draft" | "archived";
type ConfirmKind = "publish" | "republish" | "archive" | "revert" | "del";

/** 도쿄 기준 「2026.11.18」 — 날짜 표기는 lib/announcement-display 하나로(2026-11-20). */
function shortDate(iso: string | null): string {
  return annDate(iso) || "—";
}

function listDate(a: AdminAnnouncementVM): string | null {
  return a.status === "draft" ? a.updatedAt : a.publishedAt;
}

function targetText(a: AdminAnnouncementVM, w: AnnouncementWhiteCopy, roleLabel: RoleLabel): string {
  return a.targetScope === "everyone" ? w.everyone : a.targetRoles.map(roleLabel).join(" · ");
}

function popupText(a: AdminAnnouncementVM, w: AnnouncementWhiteCopy): string | null {
  if (!a.popup) return null;
  if (a.status === "published" && !a.isPopupActive) return w.popupEnded;
  return a.popupUntil ? w.popupUntil.replace("{date}", shortDate(a.popupUntil)) : w.popupOn;
}

export function AnnouncementsConsole({
  locale,
  data,
  currentOrgId,
}: {
  locale: Locale;
  data: AdminAnnouncementsData;
  /** 지금 보고 있는 조직(플랫폼 관리자는 null) — 새 공지의 처음 조직. */
  currentOrgId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dictionary = getAnnouncementDictionary(locale);
  const t = dictionary.console;
  const w = dictionary.white;
  const roleLabel: RoleLabel = (role: OrganizationRole) => dictionary.targetRoles[role];
  const { toast, showToast, dismiss } = useAdminToast();
  const { announcements, loadError, creatableOrganizationIds } = data;
  const creatableOrganizations = useMemo(
    () => data.organizations.filter((o) => creatableOrganizationIds.includes(o.id)),
    [data.organizations, creatableOrganizationIds],
  );
  const canCreate = creatableOrganizations.length > 0;
  const multiOrg = data.organizations.length > 1;

  // 열린 패널은 주소 `?id=` 가 정한다(2026-11-20, 2차) — 알림 · 예전 상세 주소로 들어오거나, 화면 안에서 주소만 바뀌거나
  // (같은 화면 이동), 뒤로 · 앞으로 가도 패널이 주소를 따라간다. 패널이 열려 있으면 그 공지가 있는 탭을 보여 준다.
  const rawPanelId = searchParams.get("id");
  const panelId = readAnnouncementPanelId(rawPanelId ?? undefined);
  const selected = panelId ? (announcements.find((a) => a.id === panelId) ?? null) : null;
  const selectedId = selected?.id ?? null;
  const [tabChoice, setTab] = useState<Tab>("published");
  const tab: Tab = selected?.status ?? tabChoice;
  // 목록에 없는 `?id=`(지운 공지 · 볼 수 없는 공지 · 꼴이 틀린 값)는 주소에서 뺀다. 기록을 남기지 않는 replaceState 는
  // App Router 와 맞물려 useSearchParams 가 따라오고 서버를 다시 부르지 않는다.
  const stalePanelId = rawPanelId !== null && !selected;
  useEffect(() => {
    if (stalePanelId) window.history.replaceState(null, "", pathname);
  }, [stalePanelId, pathname]);
  // null = 목록, "new" = 새 공지, 그 밖 = 수정할 공지 id
  const [composer, setComposer] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      published: announcements.filter((a) => a.status === "published").length,
      draft: announcements.filter((a) => a.status === "draft").length,
      archived: announcements.filter((a) => a.status === "archived").length,
    }),
    [announcements],
  );

  const summary = useMemo(() => {
    const live = announcements.filter((a) => a.status === "published");
    const impUnread = live.filter((a) => a.isImportant && a.unreadCount > 0);
    return {
      pinned: live.filter((a) => a.isPinned).length,
      popup: live.filter((a) => a.isPopupActive).length,
      important: live.filter((a) => a.isImportant).length,
      impUnread: impUnread.length,
      impUnreadPeople: impUnread.reduce((sum, a) => sum + a.unreadCount, 0),
    };
  }, [announcements]);

  const rows = useMemo(
    () =>
      announcements
        .filter((a) => a.status === tab)
        .slice()
        .sort((x, y) => {
          if (x.isPinned !== y.isPinned) return x.isPinned ? -1 : 1;
          return (listDate(y) ?? "").localeCompare(listDate(x) ?? "");
        }),
    [announcements, tab],
  );

  // 줄을 고르거나 패널을 닫으면 주소만 바꾼다(기록 없이) — 새로 고침해도 지금 보던 패널이 그대로 열린다.
  // 닫을 때는 보던 공지의 탭에 머문다.
  const selectPanel = (id: string | null) => {
    if (selected) setTab(selected.status);
    window.history.replaceState(null, "", id ? announcementPanelHref(id) : pathname);
  };
  const closePanel = () => selectPanel(null);
  const editing = composer && composer !== "new" ? (announcements.find((a) => a.id === composer) ?? null) : null;

  if (composer) {
    return (
      <div className="anw">
        <AnnouncementComposer
          key={composer}
          item={editing}
          w={w}
          t={t}
          localeTag={adminLocaleTag(locale)}
          roleLabel={roleLabel}
          organizations={editing ? data.organizations : creatableOrganizations}
          currentOrgId={currentOrgId}
          roleCountsByOrg={data.roleCountsByOrg}
          orgMemberTotal={data.orgMemberTotal}
          myRoleByOrg={data.myRoleByOrg}
          onClose={() => setComposer(null)}
          onSaved={(published) => {
            setComposer(null);
            setTab(published ? "published" : "draft");
            // 게시 중인 공지를 고쳐 저장하면 「저장했어요」 — 「게시했어요」는 새로 게시할 때만(2026-11-20, 2차).
            showToast(editing?.status === "published" && published ? t.tSaved : published ? t.tPublished : t.tDraftSaved);
            router.refresh();
          }}
        />
        {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
      </div>
    );
  }

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "published", label: w.stPublished, n: counts.published },
    { key: "draft", label: w.stDraft, n: counts.draft },
    { key: "archived", label: t.tabArchived, n: counts.archived },
  ];
  const emptyText = tab === "published" ? w.emptyPub : tab === "draft" ? w.emptyDraft : w.emptyArc;

  return (
    <div className="anw">
      <div className="anw-bar">
        <div className="anw-seg is-tabs" role="tablist" aria-label={t.colAnnouncement}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={tab === item.key ? "on" : ""}
              onClick={() => {
                closePanel();
                setTab(item.key);
              }}
            >
              {item.label}
              {item.n > 0 ? <b className="num">{item.n}</b> : null}
            </button>
          ))}
        </div>
        {canCreate ? (
          <button type="button" className="anw-new" onClick={() => setComposer("new")}>
            <Plus aria-hidden="true" />
            {t.newBtn}
          </button>
        ) : null}
      </div>

      {tab === "published" && !loadError && counts.published > 0 ? (
        <p className="anw-sum">
          <span>{w.sumPinned.replace("{n}", String(summary.pinned))}</span>
          <span className="dot" aria-hidden="true">·</span>
          <span>{w.sumPopup.replace("{n}", String(summary.popup))}</span>
          {summary.important > 0 ? (
            <>
              <span className="dot" aria-hidden="true">·</span>
              {summary.impUnread > 0 ? (
                <span className="is-red">
                  {w.sumImpUnread.replace("{n}", String(summary.impUnread)).replace("{p}", String(summary.impUnreadPeople))}
                </span>
              ) : (
                <span className="is-green">{w.sumImpClear}</span>
              )}
            </>
          ) : null}
        </p>
      ) : null}

      {loadError ? (
        <div className="anw-empty">
          <b>{w.loadError}</b>
          <span>{t.errS}</span>
          <button type="button" className="anw-link" onClick={() => router.refresh()}>
            {t.retry}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="anw-empty">
          <b>{emptyText}</b>
          {tab !== "archived" && canCreate ? (
            <>
              <span>{w.emptyPubHint}</span>
              <button type="button" className="anw-link" onClick={() => setComposer("new")}>
                {t.newBtn}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className="anw-th" aria-hidden="true">
            <span>{w.colTitle}</span>
            <span>{w.colTarget}</span>
            <span>{w.colAuthor}</span>
            <span>{tab === "draft" ? w.colUpdated : w.colPublished}</span>
            <span>{w.colRead}</span>
          </div>
          <div className="anw-rows">
            <LiveWash move sig={rows.map((a) => a.id).join(",")}>{rows.map((a) => {
              const pop = popupText(a, w);
              const sent = a.status !== "draft";
              const allRead = sent && a.unreadCount === 0 && a.targetTotal > 0;
              return (
                <button
                  key={a.id} data-live={a.id}
                  type="button"
                  className={`anw-tr${selectedId === a.id ? " on" : ""}`}
                  onClick={() => selectPanel(a.id)}
                  aria-current={selectedId === a.id ? "true" : undefined}
                >
                  <span className="anw-ttl">
                    {a.isPinned ? <Pin className="anw-pin" aria-label={w.pinned} /> : null}
                    <b>{a.title}</b>
                    {a.isImportant ? <em className="is-red">{w.important}</em> : null}
                    {pop ? <em>{pop}</em> : null}
                  </span>
                  <span className="anw-c">{targetText(a, w, roleLabel)}</span>
                  <span className="anw-c">{a.authorName || "—"}</span>
                  <span className="anw-c is-soft num">{shortDate(listDate(a))}</span>
                  <span className="anw-read num">
                    {sent ? (
                      <>
                        <b className={allRead ? "is-green" : a.isImportant ? "is-red" : ""}>
                          {allRead ? (
                            <>
                              <Check aria-hidden="true" />
                              {w.allRead}
                            </>
                          ) : (
                            w.unreadPeople.replace("{n}", String(a.unreadCount))
                          )}
                        </b>
                        <span>{w.readOf.replace("{r}", String(a.readCount)).replace("{t}", String(a.targetTotal))}</span>
                      </>
                    ) : (
                      <span>{w.notPublished}</span>
                    )}
                  </span>
                </button>
              );
            })}</LiveWash>
          </div>
        </>
      )}

      {selected ? (
        <NoticePanel
          key={selected.id}
          item={selected}
          w={w}
          t={t}
          roleLabel={roleLabel}
          showOrg={multiOrg}
          onClose={closePanel}
          onEdit={() => setComposer(selected.id)}
          onToast={showToast}
          onDeleted={closePanel}
        />
      ) : null}
      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

type Reader = { id: string; name: string; role: string; readAt: string | null };

function NoticePanel({
  item,
  w,
  t,
  roleLabel,
  showOrg,
  onClose,
  onEdit,
  onToast,
  onDeleted,
}: {
  item: AdminAnnouncementVM;
  w: AnnouncementWhiteCopy;
  t: AnnCopy;
  roleLabel: RoleLabel;
  showOrg: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToast: (message: string) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [pending, startTransition] = useTransition();
  const [listTab, setListTab] = useState<"unread" | "read">(item.unreadCount > 0 ? "unread" : "read");
  const [readers, setReaders] = useState<{ read: Reader[]; unread: Reader[] } | null>(null);
  const [readError, setReadError] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, {
    disabled: confirm !== null || photo !== null || pending,
    trapFocus: true,
  });
  const sent = item.status !== "draft";

  // 명단은 패널을 열 때 서버에서 읽는다(목록 숫자는 빠른 집계, 명단은 지금 대상자 기준).
  useEffect(() => {
    if (!sent) return;
    let active = true;
    getAnnouncementReadStatusConsole(item.id)
      .then((result) => {
        if (!active) return;
        if (!result.ok) return setReadError(true);
        const byName = (a: Reader, b: Reader) => a.name.localeCompare(b.name);
        setReaders({
          read: result.readers.map((r) => ({ ...r })).sort(byName),
          unread: result.unreadUsers.map((u) => ({ ...u, readAt: null })).sort(byName),
        });
      })
      // 네트워크 · 서버 오류도 「명단을 못 불러옴」으로(예전엔 「불러오는 중」에 멈췄다).
      .catch(() => {
        if (active) setReadError(true);
      });
    return () => {
      active = false;
    };
  }, [item.id, sent]);

  const readCount = readers ? readers.read.length : item.readCount;
  const unreadCount = readers ? readers.unread.length : item.unreadCount;
  const total = readCount + unreadCount;
  const pct = total > 0 ? Math.round((readCount / total) * 100) : 0;
  const list = readers ? (listTab === "unread" ? readers.unread : readers.read) : [];

  const stamp = (iso: string | null) => annDateTime(iso) || "—";
  const statusText = item.status === "published" ? w.stPublished : item.status === "draft" ? w.stDraft : w.stArchived;
  const pop = popupText(item, w);
  const roleName = (role: string) => roleLabel(role as OrganizationRole) ?? role;

  function run(kind: ConfirmKind) {
    startTransition(async () => {
      const result =
        kind === "del"
          ? await deleteAnnouncementConsole(item.id)
          : await setAnnouncementStatusConsole(item.id, kind === "archive" ? "archived" : kind === "revert" ? "draft" : "published");
      setConfirm(null);
      if (!result.ok) {
        haptic("error");
        onToast(t.errProcess);
        return;
      }
      haptic("success");
      onToast(
        kind === "publish" ? t.tPublished : kind === "republish" ? t.tRepublished : kind === "archive" ? t.tArchived : kind === "revert" ? t.tReverted : t.tDeleted,
      );
      if (kind === "del") onDeleted();
      router.refresh();
    });
  }

  const actions: { kind: ConfirmKind | "edit"; label: string; pri?: boolean }[] = [];
  if (item.status === "published") {
    if (item.canOperate) actions.push({ kind: "archive", label: w.archive });
    if (item.canEdit) actions.push({ kind: "edit", label: w.edit, pri: true });
  } else if (item.status === "draft") {
    if (item.canEdit) actions.push({ kind: "edit", label: w.edit });
    if (item.canOperate) actions.push({ kind: "publish", label: w.publish, pri: true });
  } else if (item.canOperate) {
    actions.push({ kind: "revert", label: w.revert });
    actions.push({ kind: "republish", label: w.republish, pri: true });
  }

  return (
    <>
      <div className="panel-scrim on" onClick={pending ? undefined : onClose} />
      <aside ref={panelRef} className="panel on anw-panel" role="dialog" aria-label={item.title} tabIndex={-1}>
        <div className="anw-hd">
          <div className="anw-hd__main">
            <span className="anw-meta">
              {item.isImportant ? <b className="is-red">{w.important}</b> : null}
              {item.isPinned ? <b className="is-violet">{w.pinned}</b> : null}
              <span>{statusText}</span>
              {pop ? <span>{pop}</span> : null}
            </span>
            <h2>{item.title}</h2>
            <span className="anw-sub">
              {[showOrg ? item.organizationName : null, targetText(item, w, roleLabel), item.authorName || null, stamp(item.status === "draft" ? item.updatedAt : item.publishedAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {item.canOperate ? (
            <button type="button" className="anw-ic is-danger" aria-label={w.delete} onClick={() => setConfirm("del")} disabled={pending}>
              <Trash2 aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="anw-ic anw-hd__x" aria-label={w.close} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="anw-pb">
          <p className="anw-body">{item.content}</p>

          {item.images.length > 0 ? (
            <div className="anw-shots">
              {item.images.map((url, index) => (
                <button type="button" key={url} className="anw-shot" onClick={() => setPhoto(url)} aria-label={w.photoOpen.replace("{n}", String(index + 1))}>
                  <Image alt="" src={url} fill sizes="120px" />
                </button>
              ))}
            </div>
          ) : null}

          <section className="anw-reads" aria-label={w.readTitle}>
            {sent ? (
              <>
                <div className="anw-reads__h">
                  <b>{w.readTitle}</b>
                  <span className="num">{w.readOf.replace("{r}", String(readCount)).replace("{t}", String(total))}</span>
                </div>
                <span className="anw-bar2" aria-hidden="true">
                  <i style={{ transform: `scaleX(${pct / 100})` }} />
                </span>
                <div className="anw-seg is-small" role="tablist" aria-label={w.readTitle}>
                  <button type="button" role="tab" aria-selected={listTab === "unread"} className={listTab === "unread" ? "on" : ""} onClick={() => setListTab("unread")}>
                    {w.tabUnread} <b className="num">{unreadCount}</b>
                  </button>
                  <button type="button" role="tab" aria-selected={listTab === "read"} className={listTab === "read" ? "on" : ""} onClick={() => setListTab("read")}>
                    {w.tabRead} <b className="num">{readCount}</b>
                  </button>
                </div>
                {readError ? (
                  <p className="anw-soft">{w.readListError}</p>
                ) : !readers ? (
                  <p className="anw-soft">{w.readLoading}</p>
                ) : list.length === 0 ? (
                  <p className="anw-soft">{listTab === "unread" ? w.noneUnread : w.noneRead}</p>
                ) : (
                  <ul className="anw-people" key={listTab}>
                    {list.map((person) => (
                      <li key={person.id}>
                        <span className="anw-av" aria-hidden="true">
                          {initial(person.name)}
                        </span>
                        <span className="anw-people__n">{person.name}</span>
                        <span className="anw-people__r">{listTab === "read" && person.readAt ? stamp(person.readAt) : roleName(person.role)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {item.popup && item.popupDismissed > 0 ? <p className="anw-soft">{w.popupNote.replace("{d}", String(item.popupDismissed))}</p> : null}
              </>
            ) : (
              <p className="anw-soft">{w.notSentNote.replace("{n}", String(item.targetTotal))}</p>
            )}
          </section>
        </div>

        {actions.length > 0 ? (
          <div className={`anw-pf${actions.length === 1 ? " is-one" : ""}`}>
            {actions.map((action) => (
              <button
                key={action.kind}
                type="button"
                className={`anw-btn ${action.pri ? "is-tint" : "is-gray"}`}
                disabled={pending}
                onClick={() => (action.kind === "edit" ? onEdit() : setConfirm(action.kind))}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="anw-pf anw-soft">{w.noPermission}</p>
        )}
      </aside>

      {confirm ? (
        <ConfirmModal kind={confirm} item={item} w={w} pending={pending} onCancel={() => setConfirm(null)} onConfirm={() => run(confirm)} />
      ) : null}

      {photo ? <PhotoViewer src={photo} title={item.title} closeLabel={w.close} onClose={() => setPhoto(null)} /> : null}
    </>
  );
}

// 사진 크게 보기 — 열면 닫기 버튼에 초점, 닫으면 누른 사진 단추로 초점을 돌려준다. Esc 로 닫는다(2026-11-12).
function PhotoViewer({ src, title, closeLabel, onClose }: { src: string; title: string; closeLabel: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        // 닫기 버튼 하나뿐 — 초점이 뒤 패널로 빠지지 않게 붙잡는다.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div className="anw-viewer" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <button ref={closeRef} type="button" className="anw-viewer__x" aria-label={closeLabel} onClick={onClose}>
        <X aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- 원본 비율 그대로 크게 보기 */}
      <img alt={title} src={src} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

function ConfirmModal({
  kind,
  item,
  w,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: ConfirmKind;
  item: AdminAnnouncementVM;
  w: AnnouncementWhiteCopy;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, pending]);
  const n = String(item.targetTotal);
  const copy: Record<ConfirmKind, { title: string; body: string; ok: string }> = {
    del: { title: w.cDelT, body: w.cDelS, ok: w.cDelBtn },
    archive: { title: w.cArcT, body: w.cArcS, ok: w.archive },
    revert: { title: w.cRevT, body: w.cRevS, ok: w.revert },
    publish: { title: w.cPubT, body: w.cPubS.replace("{n}", n), ok: w.publish },
    republish: { title: w.cRepT, body: w.cPubS.replace("{n}", n), ok: w.republish },
  };
  const c = copy[kind];
  return (
    <>
      <div className="modal-scrim on anw-scrim" onClick={pending ? undefined : onCancel} />
      <div className="modal on anw-modal" role="alertdialog" aria-modal="true" aria-labelledby="anw-confirm-t" aria-describedby="anw-confirm-b">
        <div className="anw-modal__h">
          <h2 id="anw-confirm-t">{c.title}</h2>
          <span>{item.title}</span>
        </div>
        <p id="anw-confirm-b" className="anw-modal__b">
          {c.body}
        </p>
        <div className="anw-modal__f">
          {/* 첫 초점은 「그대로 두기」 — Enter 한 번에 되돌리기 어려운 일이 일어나지 않게. */}
          <button type="button" className="anw-btn is-gray" disabled={pending} onClick={onCancel} autoFocus>
            {w.keep}
          </button>
          <button type="button" className={`anw-btn ${kind === "del" ? "is-danger" : "is-pri"}`} disabled={pending} onClick={onConfirm} aria-busy={pending}>
            {c.ok}
          </button>
        </div>
      </div>
    </>
  );
}
