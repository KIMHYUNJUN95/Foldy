"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { FolderOpen, Plus, Search, X } from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import type { Dictionary } from "@/lib/i18n";
import type { ProjectSummary } from "@/lib/projects";
import type { ShareableUser } from "@/lib/tasks";
import { createProject } from "@/app/mobile/tasks/projects/actions";
import { haptic } from "@/lib/haptics";
import "./tasks-white.css";

type Copy = Dictionary["tasks"];

function pctOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function AvatarStack({ members }: { members: ProjectSummary["members"] }) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  return (
    <span aria-hidden="true" className="tkw-avs">
      {shown.map((m) => (
        <span className="tkw-av" key={m.userId}>
          {m.name.slice(0, 1)}
        </span>
      ))}
      {extra > 0 ? <span className="tkw-av is-gray">+{extra}</span> : null}
    </span>
  );
}

export function ProjectsBoard({
  copy,
  projects,
  shareableUsers,
}: {
  copy: Copy;
  projects: ProjectSummary[];
  shareableUsers: ShareableUser[];
}) {
  const p = copy.projects;

  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // 생성 시트 — 공용 BottomSheet 가 슬라이드 + 드래그 닫기 + Esc 생명주기를 맡는다.
  const [createOpen, setCreateOpen] = useState(false);
  const open = useCallback(() => setCreateOpen(true), []);

  // 생성 시트 폼 상태. 초대 검색이 보이도록 공유는 기본 켜짐 (디자인과 같음).
  const [shareOn, setShareOn] = useState(true);
  const [inviteIds, setInviteIds] = useState<string[]>([]);
  const [inviteQuery, setInviteQuery] = useState("");
  const invitedUsers = shareableUsers.filter((u) => inviteIds.includes(u.id));
  const inviteResults = (() => {
    const q = inviteQuery.trim().toLowerCase();
    if (!q) return [];
    return shareableUsers
      .filter((u) => !inviteIds.includes(u.id) && u.name.toLowerCase().includes(q))
      .slice(0, 6);
  })();

  return (
    <div className="relative">
      {/* 화이트 리디자인(2026-10-15): 상자 없는 줄 목록 — 「# 이름」 · 진행률(가는 막대) · 작업 수 · 멤버. */}
      <div className="tkw-head">
        <div className="tkw-head__b">
          <h1>{copy.viewProjects}</h1>
          <span className="tkw-head__s">{copy.mobileWhite.projectsSub.replace("{n}", String(projects.length))}</span>
        </div>
      </div>
      {projects.length === 0 ? (
        <div className="tkw-empty">
          <FolderOpen aria-hidden="true" />
          <b>{p.emptyTitle}</b>
          <span>{p.emptySub}</span>
        </div>
      ) : (
        <div className="tkw-list">
          {projects.map((proj) => {
            const pct = pctOf(proj.completedTasks, proj.totalTasks);
            return (
              <Link className="tkw-prow" href={`/mobile/tasks/projects/${proj.id}`} key={proj.id}>
                <span className="tkw-prow__top">
                  <span className="tkw-prow__t">
                    <span>#</span> {proj.title}
                  </span>
                  <span className="tkw-prow__pct">{pct}%</span>
                </span>
                <span aria-hidden="true" className="tkw-prow__bar">
                  <i style={{ width: `${pct}%` }} />
                </span>
                <span className="tkw-prow__m">
                  {proj.members.length > 0 ? <AvatarStack members={proj.members} /> : null}
                  {p.taskCount
                    .replace("{done}", String(proj.completedTasks))
                    .replace("{total}", String(proj.totalTasks))}
                  {proj.isShared ? ` · ${copy.mobileWhite.members.replace("{n}", String(proj.members.length))}` : ""}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* 프로젝트 만들기 — 떠 있는 알약 버튼(화면에 고정되게 body 로 띄운다). */}
      {hydrated
        ? createPortal(
            <button
              className="tkw-fab is-pill"
              onClick={() => {
                haptic("light");
                open();
              }}
              type="button"
            >
              <Plus aria-hidden="true" strokeWidth={2.2} />
              {p.createFab}
            </button>,
            document.body,
          )
        : null}

      {/* 만들기 시트 — 이름표 칸 · 공유 스위치 · 멤버 초대(이름 검색). */}
      {createOpen && hydrated ? (
        <BottomSheet ariaLabel={p.createTitle} onClose={() => setCreateOpen(false)}>
          {({ close }) => (
            <form action={createProject} className="tkw-sheet tkw-form" onSubmit={() => haptic("light")} style={{ padding: 0, gap: 16 }}>
              <h2 style={{ margin: 0 }}>{p.createTitle}</h2>
              <input name="share" type="hidden" value={shareOn ? "on" : "off"} />
              <input name="shareJson" type="hidden" value={JSON.stringify(inviteIds)} />

              <label className="tkw-nf" style={{ marginTop: 6 }}>
                <span className="tkw-nf__l">{p.nameLabel}</span>
                <input autoFocus className="tkw-nf__in is-title" name="title" placeholder={p.namePlaceholder} required />
              </label>

              <label className="tkw-nf">
                <span className="tkw-nf__l">
                  {p.descLabel} · {p.optional}
                </span>
                <textarea className="tkw-nf__in is-ta" name="description" placeholder={p.descPlaceholder} rows={2} />
              </label>

              <button
                aria-checked={shareOn}
                className="tkw-swrow"
                onClick={() => setShareOn((v) => !v)}
                role="switch"
                type="button"
              >
                <span className="tkw-swrow__b">
                  <b>{p.shareLabel}</b>
                  <span>{p.shareSub}</span>
                </span>
                <span aria-hidden="true" className="tkw-sw__t" />
              </button>

              {shareOn ? (
                <div className="tkw-fsec">
                  <span className="tkw-fsec__l">
                    {p.inviteLabel} <small>{p.optional}</small>
                  </span>
                  <label className="tkw-search__in">
                    <Search aria-hidden="true" />
                    <input
                      enterKeyHint="search"
                      onChange={(e) => setInviteQuery(e.target.value)}
                      placeholder={p.inviteSearch}
                      type="search"
                      value={inviteQuery}
                    />
                  </label>
                  {inviteResults.length > 0 ? (
                    <div className="tkw-people">
                      {inviteResults.map((u) => (
                        <div key={u.id}>
                          <span aria-hidden="true" className="tkw-av">
                            {u.name.slice(0, 1)}
                          </span>
                          <button
                            className="tkw-people__n"
                            onClick={() => {
                              haptic("light");
                              setInviteIds((prev) => [...prev, u.id]);
                              setInviteQuery("");
                            }}
                            style={{ border: 0, background: "transparent", padding: 0, font: "inherit", textAlign: "left", cursor: "pointer" }}
                            type="button"
                          >
                            {u.name}
                          </button>
                          <span className="tkw-people__r">{u.role}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {invitedUsers.length > 0 ? (
                    <div className="tkw-chips">
                      {invitedUsers.map((u) => (
                        <button
                          aria-label={`${u.name} · ${copy.a11yRemoveMember}`}
                          className="tkw-chip is-on"
                          key={u.id}
                          onClick={() => setInviteIds((prev) => prev.filter((x) => x !== u.id))}
                          type="button"
                        >
                          {u.name}
                          <X aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="tkw-btns2" style={{ marginTop: 4 }}>
                <button className="tkw-btn is-gray" onClick={close} type="button">
                  {copy.cancel}
                </button>
                <button className="tkw-btn is-pri" type="submit">
                  {p.create}
                </button>
              </div>
            </form>
          )}
        </BottomSheet>
      ) : null}
    </div>
  );
}
