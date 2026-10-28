"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSplitPush } from "@/components/shell/split-list";
import { AlertTriangle, ChevronLeft, LogOut, MoreHorizontal, Plus, Trash2, UserPlus, X } from "lucide-react";
import { completeTask, reopenTask } from "@/app/mobile/tasks/[id]/actions";
import {
  addProjectSection,
  deleteProject,
  deleteProjectSection,
  inviteProjectMembers,
  leaveProject,
  removeProjectMember,
  renameProjectSection,
  reorderProjectSections,
} from "@/app/mobile/tasks/projects/actions";
import { ReorderableSectionList } from "@/components/tasks/reorderable-section-list";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { SharePicker } from "@/components/tasks/share-picker";
import { TaskToast } from "@/components/tasks/task-toast";
import { CheckMark, contextLabelOf, prioRingClass } from "@/components/tasks/task-card";
import { haptic } from "@/lib/haptics";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { ProjectDetailData, ProjectSectionInfo } from "@/lib/projects";
import type { ShareableUser } from "@/lib/tasks";
import type { TaskRecord } from "@/lib/tasks";
import { isStandardRecurrence } from "@/lib/tasks-recurrence";
import { tokyoToday } from "@/lib/tokyo-date";
import { cn } from "@/lib/utils";
import "./tasks-white.css";

type Copy = Dictionary["tasks"];

function anchorChip(task: TaskRecord, locale: Locale): string | null {
  const iso = task.dueAt ?? (task.scheduledDate ? `${task.scheduledDate}T00:00:00+09:00` : null);
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

/** 프로젝트 작업 한 줄 — 투두 줄(`TaskCard`)과 같은 모양(고리 · 제목 · 회색 메타), 완료하면 끝에 완료 날짜. */
function TaskRow({
  buildingLabels,
  task,
  locale,
  copy,
  currentUserId,
  onToggle,
}: {
  buildingLabels: Record<string, string>;
  task: TaskRecord;
  locale: Locale;
  copy: Copy;
  currentUserId: string;
  onToggle: (task: TaskRecord) => void;
}) {
  const splitPush = useSplitPush();
  const w = copy.mobileWhite;
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // 반복 업무는 행 status 가 언제나 열림이고 완료는 회차별이다(2026-07-30). 이 줄에서 바로 완료하면
  // 회차를 모른 채 시리즈 시작일이 완료돼 버렸다(2026-10-26) — 반복은 고리를 눌러도 오늘 회차로 상세를
  // 연다(상세가 그 날짜가 실제 회차인지 다시 확인하고, 아니면 완료 칸을 막는다 = task-detail-view 가드).
  const recurring = isStandardRecurrence(task.recurrenceRule);
  const done = !recurring && task.status === "completed";
  const due = anchorChip(task, locale);
  const others = task.participants.filter((p) => p.userId !== currentUserId).length;
  const meta = [
    !done && task.priority === "urgent" ? copy.prioUrgent : null,
    !done && task.priority === "important" ? copy.prioImportant : null,
    !done ? due : null,
    contextLabelOf(task, buildingLabels, copy.contextPickerRoomSuffix),
    task.status === "in_progress" && !done ? copy.statusInProgress : null,
    task.tags.length ? task.tags.slice(0, 2).map((t) => `#${t}`).join(" ") : null,
    task.imageUrls.length ? w.photos.replace("{n}", String(task.imageUrls.length)) : null,
    others > 0 && task.isShared ? w.shared.replace("{n}", String(others)) : null,
    task.authorLeftProject ? `${task.authorName} · ${copy.projects.authorLeftProject}` : null,
  ].filter(Boolean);
  const href = recurring
    ? `/mobile/tasks/${task.id}?view=projects&occurrence=${tokyoToday()}`
    : `/mobile/tasks/${task.id}?view=projects`;
  return (
    <div className={cn("tkw-row", done && "is-done")}>
      <div className="tkw-row__in">
        <button
          aria-label={done ? copy.reopen : copy.complete}
          className={cn("tkw-ck", prioRingClass(task.priority), done && "is-done", checking && "is-checking")}
          onClick={() => {
            if (checking) return;
            if (recurring) {
              haptic("light");
              splitPush(href);
              return;
            }
            if (done) {
              haptic("light");
              onToggle(task);
              return;
            }
            // 「성공」 햅틱은 서버가 저장을 확인한 뒤(onToggle) — 여기선 누름 반응만.
            haptic("light");
            setChecking(true);
            timer.current = setTimeout(() => {
              onToggle(task);
              timer.current = setTimeout(() => setChecking(false), 1500);
            }, 340);
          }}
          type="button"
        >
          <CheckMark />
        </button>
        <a
          className="tkw-row__b"
          href={href}
          onClick={(e) => {
            e.preventDefault();
            splitPush(href);
          }}
        >
          <span className="tkw-row__t">{task.title}</span>
          {meta.length ? <span className="tkw-row__m">{meta.join(" · ")}</span> : null}
        </a>
        {done && due ? <span className="tkw-row__tr">{due}</span> : null}
      </div>
    </div>
  );
}

/**
 * 프로젝트 화면 — 화이트 리디자인(2026-10-15, 시안 TodoProj-Phone).
 * 「‹ 프로젝트 목록」 → 「# 이름」 → 「섹션 n · 작업 n · 사진 최대 20장」 → 멤버(누르면 관리 시트) → 섹션 묶음(주인은 손잡이로
 * 순서 바꾸기 · 이름 바꾸기 · 삭제) → 「+ 섹션 추가」.
 */
export function ProjectDetailView({
  buildingLabels,
  copy,
  currentUserId,
  locale,
  project,
  shareableUsers,
}: {
  buildingLabels: Record<string, string>;
  copy: Copy;
  currentUserId: string;
  locale: Locale;
  project: ProjectDetailData;
  shareableUsers: ShareableUser[];
}) {
  const p = copy.projects;
  const w = copy.mobileWhite;
  // 소유자 전용 관리 단추 — 플랫폼 개발자에게도 보인다(viewerCanManage, 2026-10-23).
  const isOwner = project.viewerCanManage;

  const [, startToggle] = useTransition();
  const [toggleError, setToggleError] = useState(false);
  useEffect(() => {
    if (!toggleError) return;
    const t = setTimeout(() => setToggleError(false), 4000);
    return () => clearTimeout(t);
  }, [toggleError]);
  const onToggle = (task: TaskRecord) => {
    // 반복 업무는 TaskRow 가 상세로 보낸다 — 회차 없이 완료하면 시리즈 시작일이 완료된다.
    if (isStandardRecurrence(task.recurrenceRule)) return;
    const completing = task.status !== "completed";
    startToggle(async () => {
      let ok = false;
      try {
        const res = completing ? await completeTask(task.id) : await reopenTask(task.id);
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (ok) {
        if (completing) haptic("success");
        setToggleError(false);
      } else {
        haptic("error");
        setToggleError(true);
      }
    });
  };

  // 실패 안내는 ReorderableSectionList 가 순서를 되돌린 뒤 onPersistError 로 부른다(2026-10-28).
  const persistSectionOrder = (orderedIds: string[]) => reorderProjectSections(project.id, orderedIds);
  const notifyFailed = () => {
    haptic("error");
    setToggleError(true);
  };

  // 멤버 초대 — 숨은 폼 없이 만든 FormData 로 직접 호출하므로, 선택한
  // id 가 반드시 서버 액션에 닿는다(예전 숨은 input + requestSubmit 방식은 상태와 경쟁했다).
  const [, startInvite] = useTransition();
  const inviteMembers = (ids: string[]) => {
    if (ids.length === 0) return;
    startInvite(async () => {
      const fd = new FormData();
      fd.set("projectId", project.id);
      fd.set("shareJson", JSON.stringify(ids));
      let ok = false;
      try {
        const res = (await inviteProjectMembers(fd)) as { ok?: boolean } | void;
        ok = !res || res.ok !== false;
      } catch {
        ok = false;
      }
      if (ok) {
        haptic("success"); // 서버가 초대를 확인한 뒤에만
      } else {
        // 실패 — 고른 사람은 시트와 함께 사라졌으니 시트를 다시 열어 바로 재시도하게 하고 이유를 알린다.
        setPickerOpen(true);
        notifyFailed();
      }
    });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteSection, setDeleteSection] = useState<ProjectSectionInfo | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectSectionInfo | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);
  // 멤버 시트 — 공용 BottomSheet 가 슬라이드 + 드래그로 닫기 + Esc 생명주기를 맡는다.
  const [membersOpen, setMembersOpen] = useState(false);
  const openMembers = useCallback(() => setMembersOpen(true), []);

  const ownerName = project.members.find((m) => m.role === "owner")?.name ?? "";
  const myOpen = project.openTasksByAuthor[currentUserId] ?? { count: 0, titles: [] };
  const removeCount = removeTarget ? (project.openTasksByAuthor[removeTarget.userId]?.count ?? 0) : 0;

  const unsectioned = project.tasks.filter((t) => !t.sectionId);
  const tasksOf = (sectionId: string) => project.tasks.filter((t) => t.sectionId === sectionId);
  const taskCountOf = (key: string) => (key === "none" ? unsectioned.length : tasksOf(key).length);

  // "작업 추가" 는 전체 생성 폼을 연다(프로젝트 업무에 방/예약을 연결하고 설정할 수 있도록:
  // 날짜, 우선순위 등), 이 프로젝트와 섹션에 미리 묶여 있다. 저장하면 createTask 가 여기로 돌아온다.
  const addTaskLink = (sectionId: string | null) => (
    <Link
      className="tkw-add"
      href={`/mobile/tasks/new?project=${project.id}${sectionId ? `&section=${sectionId}` : ""}`}
    >
      <Plus aria-hidden="true" />
      {p.addTask}
    </Link>
  );
  const rows = (list: TaskRecord[]) => (
    <div className="tkw-list">
      {list.map((t) => (
        <TaskRow buildingLabels={buildingLabels} copy={copy} currentUserId={currentUserId} key={t.id} locale={locale} onToggle={onToggle} task={t} />
      ))}
    </div>
  );

  return (
    <div className="tkw relative min-h-[60vh] pb-24" data-wide="projects">
      <Link className="tkw-back" href="/mobile/tasks?view=projects">
        <ChevronLeft aria-hidden="true" />
        {w.backToProjects}
      </Link>

      <div className="tkw-head" style={{ marginBottom: 12 }}>
        <div className="tkw-head__b">
          <h1>
            <span style={{ color: "#16141f" }}>#</span> {project.title}
          </h1>
          <span className="tkw-head__s">
            {w.projectMeta
              .replace("{sections}", String(project.sections.length))
              .replace("{tasks}", String(project.tasks.length))}
          </span>
        </div>
        <div className="relative">
          <button
            aria-expanded={menuOpen}
            aria-label={copy.a11yMoreActions}
            className="tkw-icon"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </div>
      </div>

      {project.description ? (
        <p className="tkw-hint" style={{ margin: "-4px 0 14px" }}>
          {project.description}
        </p>
      ) : null}

      {/* 멤버 — 누르면 관리 시트(주인은 초대 · 내보내기). */}
      <button aria-label={p.memberManage} className="tkw-pmeta" onClick={openMembers} type="button">
        <span aria-hidden="true" className="tkw-avs">
          {project.members.slice(0, 4).map((m) => (
            <span className="tkw-av" key={m.userId}>
              {m.name.slice(0, 1)}
            </span>
          ))}
          {project.members.length > 4 ? <span className="tkw-av is-gray">+{project.members.length - 4}</span> : null}
        </span>
        {w.members.replace("{n}", String(project.members.length))}
      </button>

      {/* 섹션 없는 작업 — 있을 때만(섹션이 하나도 없으면 여기에 작업을 더한다). */}
      {unsectioned.length > 0 || project.sections.length === 0 ? (
        <section className="tkw-sec">
          <div className="tkw-sec__h">
            <b>{p.sectionNone}</b>
            <span className="tkw-sec__n">{w.count.replace("{n}", String(taskCountOf("none")))}</span>
          </div>
          {rows(unsectioned)}
          {addTaskLink(null)}
        </section>
      ) : null}

      {/* 이름 있는 섹션 — 소유자가 드래그로 순서 변경(그립 핸들). */}
      {project.sections.length > 0 ? (
        <ReorderableSectionList
          countLabel={w.count}
          countOf={(id) => taskCountOf(id)}
          deleteLabel={copy.deleteAction}
          disabled={!isOwner}
          editLabel={copy.actionEdit}
          isOwner={isOwner}
          onDelete={(s) => setDeleteSection(s)}
          onPersist={persistSectionOrder}
          onPersistError={notifyFailed}
          onRename={(s) => setRenameTarget(s)}
          renderBody={(section) => (
            <>
              {rows(tasksOf(section.id))}
              {addTaskLink(section.id)}
            </>
          )}
          reorderHandleLabel={copy.reorderHandle}
          sections={project.sections}
        />
      ) : null}

      {/* 섹션 추가(소유자만) */}
      {isOwner ? (
        addingSection ? (
          <form action={addProjectSection} className="tkw-secform" onSubmit={() => haptic("light")}>
            <input name="projectId" type="hidden" value={project.id} />
            <input aria-label={p.sectionNamePlaceholder} autoFocus name="title" placeholder={p.sectionNamePlaceholder} required />
            <button className="tkw-btn is-pri" style={{ width: "auto", height: 44, padding: "0 16px", fontSize: 14 }} type="submit">
              {p.add}
            </button>
            <button aria-label={copy.cancel} className="tkw-icon" onClick={() => setAddingSection(false)} style={{ marginRight: -8 }} type="button">
              <X aria-hidden="true" />
            </button>
          </form>
        ) : (
          <button className="tkw-add" onClick={() => setAddingSection(true)} type="button">
            <Plus aria-hidden="true" />
            {p.addSection}
          </button>
        )
      ) : null}

      {/* 더 보기 메뉴 */}
      {menuOpen ? (
        <BottomSheet ariaLabel={copy.a11yMoreActions} onClose={() => setMenuOpen(false)}>
          {({ close }) => (
            <div className="tkw-sheet">
              <p className="tkw-sheet__t"># {project.title}</p>
              <div className="tkw-act">
                <button
                  onClick={() => {
                    close();
                    openMembers();
                  }}
                  type="button"
                >
                  <UserPlus aria-hidden="true" />
                  {p.memberManage}
                </button>
                {isOwner ? (
                  <button
                    className="is-red"
                    onClick={() => {
                      close();
                      setDeleteProjectOpen(true);
                    }}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                    {p.deleteProject}
                  </button>
                ) : (
                  <button
                    className="is-red"
                    onClick={() => {
                      close();
                      setLeaveOpen(true);
                    }}
                    type="button"
                  >
                    <LogOut aria-hidden="true" />
                    {p.leave}
                  </button>
                )}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* 섹션 삭제 확인 */}
      {deleteSection ? (
        <ConfirmSheet
          body={p.deleteSectionBody
            .replace("{name}", deleteSection.title)
            .replace("{count}", String(tasksOf(deleteSection.id).length))}
          cancelLabel={copy.cancel}
          onClose={() => setDeleteSection(null)}
          title={p.deleteSectionTitle}
        >
          <form action={deleteProjectSection}>
            <input name="projectId" type="hidden" value={project.id} />
            <input name="sectionId" type="hidden" value={deleteSection.id} />
            <button className="tkw-btn is-red" type="submit">
              {copy.deleteAction}
            </button>
          </form>
        </ConfirmSheet>
      ) : null}

      {/* Rename section — 가운데 확인 창(의도된 BottomSheet 예외: 짧은 이름 한 칸). */}
      {renameTarget
        ? createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-7"
              onClick={() => setRenameTarget(null)}
              style={{ animation: "modal-overlay-in 180ms ease-out both" }}
            >
              <div
                className="tkw-sheet w-full max-w-[340px] rounded-[20px] bg-white p-5"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                style={{ animation: "modal-card-in 240ms cubic-bezier(0.34,1.26,0.64,1) both" }}
              >
                <h2>{p.renameSectionTitle}</h2>
                <form action={renameProjectSection}>
                  <input name="projectId" type="hidden" value={project.id} />
                  <input name="sectionId" type="hidden" value={renameTarget.id} />
                  <label className="tkw-nf">
                    <input
                      aria-label={p.renameSectionTitle}
                      autoFocus
                      className="tkw-nf__in is-sm"
                      defaultValue={renameTarget.title}
                      name="title"
                      required
                    />
                  </label>
                  <div className="tkw-btns2">
                    <button className="tkw-btn is-gray" onClick={() => setRenameTarget(null)} type="button">
                      {copy.cancel}
                    </button>
                    <button className="tkw-btn is-pri" type="submit">
                      {copy.save}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* 프로젝트 삭제 확인 */}
      {deleteProjectOpen ? (
        <ConfirmSheet
          body={p.deleteProjectBody}
          cancelLabel={copy.cancel}
          onClose={() => setDeleteProjectOpen(false)}
          title={p.deleteProjectTitle}
        >
          <form action={deleteProject}>
            <input name="projectId" type="hidden" value={project.id} />
            <button className="tkw-btn is-red" type="submit">
              {p.deleteProject}
            </button>
          </form>
        </ConfirmSheet>
      ) : null}

      {/* 프로젝트 나가기 확인 */}
      {leaveOpen ? (
        <ConfirmSheet
          body={
            myOpen.count > 0
              ? p.leaveConfirmBody
                  .replace("{count}", String(myOpen.count))
                  .replace("{owner}", ownerName)
              : p.leaveConfirmBodyNone
          }
          cancelLabel={copy.cancel}
          list={myOpen.titles}
          onClose={() => setLeaveOpen(false)}
          title={p.leaveConfirmTitle.replace("{project}", project.title)}
        >
          <form action={leaveProject}>
            <input name="projectId" type="hidden" value={project.id} />
            <button className="tkw-btn is-red" type="submit">
              {p.leave}
            </button>
          </form>
        </ConfirmSheet>
      ) : null}

      {/* 멤버 관리 */}
      {membersOpen ? (
        <BottomSheet ariaLabel={p.memberManage} onClose={() => setMembersOpen(false)}>
          {({ close, dragHandleProps }) => (
            <div className="tkw-sheet">
              <div className="flex items-center justify-between" {...dragHandleProps}>
                <h2>
                  {p.memberManage} <span className="tkw-sec__n">{project.members.length}</span>
                </h2>
                {isOwner ? (
                  <button
                    className="tkw-tl"
                    onClick={() => {
                      close();
                      setPickerOpen(true);
                    }}
                    style={{ fontSize: 14, marginTop: -14 }}
                    type="button"
                  >
                    + {p.inviteLabel}
                  </button>
                ) : null}
              </div>
              <div className="tkw-people max-h-[60vh] overflow-y-auto">
                {project.members.map((m) => (
                  <div key={m.userId}>
                    <span aria-hidden="true" className="tkw-av">
                      {m.name.slice(0, 1)}
                    </span>
                    <span className="tkw-people__n">{m.name}</span>
                    <span className="tkw-people__r">{m.role === "owner" ? p.roleOwner : p.roleMember}</span>
                    {isOwner && m.role !== "owner" && m.userId !== project.createdByUserId ? (
                      <button
                        aria-label={`${p.removeMember} · ${m.name}`}
                        className="tkw-people__x"
                        onClick={() => {
                          haptic("light");
                          close();
                          setRemoveTarget({ userId: m.userId, name: m.name });
                        }}
                        type="button"
                      >
                        <X aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {/* 멤버 빼기 확인 — 그 사람이 쓴 열린 할 일 수는 서버 값(openTasksByAuthor). */}
      {removeTarget ? (
        <ConfirmSheet
          body={(removeCount > 0 ? p.removeMemberBody : p.removeMemberBodyNone)
            .replaceAll("{name}", removeTarget.name)
            .replace("{count}", String(removeCount))}
          cancelLabel={copy.cancel}
          onClose={() => setRemoveTarget(null)}
          title={p.removeMemberTitle.replace("{name}", removeTarget.name)}
        >
          <form action={removeProjectMember}>
            <input name="projectId" type="hidden" value={project.id} />
            <input name="userId" type="hidden" value={removeTarget.userId} />
            <button className="tkw-btn is-danger" type="submit">
              {p.removeMember}
            </button>
          </form>
        </ConfirmSheet>
      ) : null}

      {pickerOpen ? (
        <SharePicker
          copy={copy}
          initialSelected={[]}
          onApply={(ids) => {
            setPickerOpen(false);
            inviteMembers(ids);
          }}
          onClose={() => setPickerOpen(false)}
          users={shareableUsers.filter((u) => !project.members.some((m) => m.userId === u.id))}
        />
      ) : null}

      {/* 완료 / 되돌리기 저장 실패 — 낙관적 체크는 1.5초 뒤 빈 고리로 돌아가고, 이 안내가 이유를 말한다. */}
      {toggleError ? (
        <TaskToast
          icon={AlertTriangle}
          message={copy.errors.save_failed}
          onDismiss={() => setToggleError(false)}
          tone="danger"
        />
      ) : null}
    </div>
  );
}

function ConfirmSheet({
  body,
  cancelLabel,
  children,
  list,
  onClose,
  title,
}: {
  body: string;
  cancelLabel: string;
  children: React.ReactNode;
  list?: string[];
  onClose: () => void;
  title: string;
}) {
  return (
    <BottomSheet ariaLabel={title} onClose={onClose}>
      {({ close }) => (
        <div className="tkw-sheet">
          <h2>{title}</h2>
          <p className="tkw-sheet__sub">{body}</p>
          {list && list.length > 0 ? (
            <ul className="tkw-sheet__list">
              {list.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          <div className="tkw-btns2">
            <button className="tkw-btn is-gray" onClick={close} type="button">
              {cancelLabel}
            </button>
            {children}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
