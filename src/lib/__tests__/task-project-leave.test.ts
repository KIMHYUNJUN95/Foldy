import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import {
  authorLeftProjectOf,
  buildProjectMembershipMap,
  buildTaskScope,
  canEditTaskAsOwnerOrAuthor,
  canEditTaskCore,
} from "@/lib/tasks";
import { countOpenTasksByAuthor } from "@/lib/projects";

/**
 * 프로젝트를 나가거나 빠진 사람의 할 일(2026-10-28).
 *  - 나간 사람은 그 프로젝트 할 일을 더 못 본다 — 자기가 쓴 것도. 직접 초대받은 할 일만 남는다.
 *  - 프로젝트 주인은 프로젝트의 모든 할 일을 고치고 · 완료하고 · 지운다(나간 멤버가 쓴 것 포함).
 */

const ME = "u-me";
const OWNER = "u-owner";
const DEV = { id: "u-dev", role: "developer_super_admin" };

describe("buildTaskScope", () => {
  it("멤버가 아닌 프로젝트의 내 author 행은 범위에서 뺀다", () => {
    const scope = buildTaskScope({
      participantRows: [{ taskId: "t-left", role: "author", projectId: "p-left" }],
      memberProjectIds: [],
      projectTaskIds: [],
    });
    expect(scope.taskIds.has("t-left")).toBe(false);
  });

  it("직접 초대(author 가 아닌 행)는 프로젝트를 나가도 남는다", () => {
    const scope = buildTaskScope({
      participantRows: [{ taskId: "t-invited", role: "participant", projectId: "p-left" }],
      memberProjectIds: [],
      projectTaskIds: [],
    });
    expect(scope.taskIds.has("t-invited")).toBe(true);
  });

  it("프로젝트 밖 내 할 일과 멤버인 프로젝트의 할 일은 그대로 보인다", () => {
    const scope = buildTaskScope({
      participantRows: [
        { taskId: "t-personal", role: "author", projectId: null },
        { taskId: "t-mine-in-project", role: "author", projectId: "p-in" },
      ],
      memberProjectIds: ["p-in"],
      projectTaskIds: ["t-mine-in-project", "t-other-in-project"],
    });
    expect([...scope.taskIds].sort()).toEqual(["t-mine-in-project", "t-other-in-project", "t-personal"]);
    expect(scope.projectIds.has("p-in")).toBe(true);
  });
});

describe("canEditTaskAsOwnerOrAuthor / canEditTaskCore", () => {
  const me = { id: ME, role: "office_admin" };

  it("작성자는 고칠 수 있다", () => {
    expect(canEditTaskAsOwnerOrAuthor(me, ME, null)).toBe(true);
  });

  it("프로젝트 주인은 남(나간 멤버 포함)이 쓴 할 일도 고칠 수 있다", () => {
    expect(canEditTaskAsOwnerOrAuthor({ id: OWNER, role: "office_admin" }, ME, OWNER)).toBe(true);
    expect(
      canEditTaskCore({ user: { id: OWNER, role: "office_admin" } } as never, {
        createdByUserId: ME,
        projectOwnerUserId: OWNER,
      }),
    ).toBe(true);
  });

  it("주인도 작성자도 아니면 못 고친다 — 프로젝트 밖 할 일에는 주인이 없다", () => {
    expect(canEditTaskAsOwnerOrAuthor(me, "u-other", OWNER)).toBe(false);
    expect(canEditTaskAsOwnerOrAuthor(me, "u-other", null)).toBe(false);
  });

  it("플랫폼 개발자는 그대로 통과한다", () => {
    expect(canEditTaskAsOwnerOrAuthor(DEV, "u-other", null)).toBe(true);
  });
});

describe("authorLeftProjectOf", () => {
  const membership = buildProjectMembershipMap([
    { project_id: "p1", user_id: OWNER, role: "owner" },
    { project_id: "p1", user_id: ME, role: "member" },
  ]);

  it("주인을 멤버십에서 찾는다", () => {
    expect(membership.get("p1")?.ownerUserId).toBe(OWNER);
  });

  it("작성자가 멤버가 아니면 나감", () => {
    expect(authorLeftProjectOf("p1", "u-gone", membership)).toBe(true);
    expect(authorLeftProjectOf("p1", ME, membership)).toBe(false);
  });

  it("프로젝트 밖이거나 멤버십을 읽을 수 없으면 나감으로 보지 않는다", () => {
    expect(authorLeftProjectOf(null, "u-gone", membership)).toBe(false);
    expect(authorLeftProjectOf("p-hidden", "u-gone", membership)).toBe(false);
  });
});

describe("countOpenTasksByAuthor", () => {
  it("열린 할 일만 세고 제목은 5개까지", () => {
    const tasks = [
      ...Array.from({ length: 6 }, (_, i) => ({ createdByUserId: ME, status: "open", title: `t${i}` })),
      { createdByUserId: ME, status: "in_progress", title: "doing" },
      { createdByUserId: ME, status: "completed", title: "done" },
      { createdByUserId: OWNER, status: "open", title: "owner" },
    ];
    const out = countOpenTasksByAuthor(tasks);
    expect(out[ME].count).toBe(7);
    expect(out[ME].titles).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(out[OWNER].count).toBe(1);
  });
});
