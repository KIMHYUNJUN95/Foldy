"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSplitPush } from "@/components/shell/split-list";
import { ChevronLeft, LogOut, MoreHorizontal, Plus, Trash2, UserPlus, X } from "lucide-react";
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
import { CheckMark, contextLabelOf, prioRingClass } from "@/components/tasks/task-card";
import { haptic } from "@/lib/haptics";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { ProjectDetailData, ProjectSectionInfo } from "@/lib/projects";
import type { ShareableUser } from "@/lib/tasks";
import type { TaskRecord } from "@/lib/tasks";
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
  const done = task.status === "completed";
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
  ].filter(Boolean);
  const href = `/mobile/tasks/${task.id}?view=projects`;
  return (
    <div className={cn("tkw-row", done && "is-done")}>
      <div className="tkw-row__in">
        <button
          aria-label={done ? copy.reopen : copy.complete}
          className={cn("tkw-ck", prioRingClass(task.priority), done && "is-done", checking && "is-checking")}
          onClick={() => {
            if (checking) return;
            if (done) {
              haptic("light");
              onToggle(task);
              return;
            }
            haptic("success");
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
  const isOwner = project.viewerIsOwner;

  const [, startToggle] = useTransition();
  const onToggle = (task: TaskRecord) => {
    startToggle(async () => {
      if (task.status === "completed") await reopenTask(task.id);
      else await completeTask(task.id);
    });
  };

  const [, startReorder] = useTransition();
  const persistSectionOrder = (orderedIds: string[]) => {
    startReorder(async () => {
      await reorderProjectSections(project.id, orderedIds);
    });
  };

  // Invite members — called directly with a constructed FormData (no hidden form), so the selected
  // ids are guaranteed to reach the server action (the old hidden-input + requestSubmit raced state).
  const [, startInvite] = useTransition();
  const inviteMembers = (ids: string[]) => {
    if (ids.length === 0) return;
    startInvite(async () => {
      const fd = new FormData();
      fd.set("projectId", project.id);
      fd.set("shareJson", JSON.stringify(ids));
      await inviteProjectMembers(fd);
    });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteSection, setDeleteSection] = useState<ProjectSectionInfo | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectSectionInfo | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // Members sheet — the shared BottomSheet owns the slide + drag-to-dismiss + Esc lifecycle.
  const [membersOpen, setMembersOpen] = useState(false);
  const openMembers = useCallback(() => setMembersOpen(true), []);

  const unsectioned = project.tasks.filter((t) => !t.sectionId);
  const tasksOf = (sectionId: string) => project.tasks.filter((t) => t.sectionId === sectionId);
  const taskCountOf = (key: string) => (key === "none" ? unsectioned.length : tasksOf(key).length);

  // "작업 추가" opens the full create form (so a project task can link a room/reservation, set a
  // date, priority, etc.), pre-bound to this project and section; createTask returns here on save.
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

      {/* Named sections — drag-reorderable by the owner (grip handle). */}
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

      {/* Add section (Owner only) */}
      {isOwner ? (
        addingSection ? (
          <form action={addProjectSection} className="tkw-secform" onSubmit={() => haptic("success")}>
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

      {/* Section delete confirm */}
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

      {/* Delete project confirm */}
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

      {/* Leave project confirm */}
      {leaveOpen ? (
        <ConfirmSheet
          body={p.leaveConfirmBody}
          cancelLabel={copy.cancel}
          onClose={() => setLeaveOpen(false)}
          title={p.leaveConfirmTitle}
        >
          <form action={leaveProject}>
            <input name="projectId" type="hidden" value={project.id} />
            <button className="tkw-btn is-red" type="submit">
              {p.leave}
            </button>
          </form>
        </ConfirmSheet>
      ) : null}

      {/* Members management */}
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
                      <form action={removeProjectMember}>
                        <input name="projectId" type="hidden" value={project.id} />
                        <input name="userId" type="hidden" value={m.userId} />
                        <button aria-label={copy.deleteAction} className="tkw-people__x" type="submit">
                          <X aria-hidden="true" />
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </BottomSheet>
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
    </div>
  );
}

function ConfirmSheet({
  body,
  cancelLabel,
  children,
  onClose,
  title,
}: {
  body: string;
  cancelLabel: string;
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <BottomSheet ariaLabel={title} onClose={onClose}>
      {({ close }) => (
        <div className="tkw-sheet">
          <h2>{title}</h2>
          <p className="tkw-sheet__sub">{body}</p>
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
