import "server-only";

import { getFieldActivities, type FieldActivityRecord } from "@/lib/field-activity";
import type { AppSession } from "@/lib/session";
import {
  getOccurrenceOrders,
  getOccurrenceStates,
  getShareableUsers,
  getTaskCompletions,
  getVisibleTasks,
  type OccurrenceOrderRecord,
  type OccurrenceStateRecord,
  type ShareableUser,
  type TaskRecord,
} from "@/lib/tasks";
import { getVisibleProjects, type ProjectSummary } from "@/lib/projects";

/** 도쿄 하루 동안의 작업 순완료 한 건 (`completed`/`reopened` 로그에서). */
export type CompletionRecord = { taskId: string; day: string; byUserId: string | null };

export type AdminTasksData = {
  tasks: TaskRecord[];
  projects: ProjectSummary[];
  users: ShareableUser[];
  completions: CompletionRecord[];
  /** 투두 밖에서 본인이 완료 처리한 현장 활동(청소·유지보수·린넨·주문). 읽기 전용. */
  fieldActivities: FieldActivityRecord[];
  occurrenceStates: OccurrenceStateRecord[];
  /** 반복 회차의 날짜별 수동 순서. 일회성은 tasks.sort_order 를 쓴다(2026-07-30). */
  occurrenceOrders: OccurrenceOrderRecord[];
  me: { id: string; name: string; role: string };
  loadError: boolean;
};

/**
 * 완료 이력 — **`src/lib/tasks.ts` 의 `getTaskCompletions()` 하나만 쓴다.**
 *
 * 예전에는 여기에 같은 net 계산(completed − reopened)이 복사돼 있었다. 이 저장소는 반복 규칙을
 * 두 파일에 복사해 뒀다가 정의가 갈리면서 **오버듀 작업이 하드 삭제되는** 사고를 낸 적이 있다.
 * 완료 집계는 콘솔의 완료·기록 탭과 모바일의 완료·기록/업무일지가 **같은 숫자를 보여야** 하므로
 * 특히 갈라지면 안 된다. 그래서 위임만 하고 콘솔이 쓰는 모양으로 좁힌다(2026-07-31).
 */
async function getCompletionRecords(session: AppSession): Promise<CompletionRecord[]> {
  const rows = await getTaskCompletions(session);
  return rows.map((r) => ({ taskId: r.taskId, day: r.day, byUserId: r.byUserId }));
}

/**
 * 관리자 Todoist 콘솔이 필요로 하는 모든 것을 한 번에 불러온다 — 보는 사람에게 보이는 작업
 * (개인 + 공유 + 지시), 공유 프로젝트, 조직의 공유 가능한 구성원(공유 / 지시 피커용),
 * 완료 로그, 그리고 보는 사람 신원. 모든 읽기는 기존의
 * 세션 범위 작업/프로젝트 라이브러리(화면 무관)를 쓰고, 콘솔은 보기별로 클라이언트에서 거른다 —
 * 모바일 TasksWorkspace 와 똑같다. 참고: docs/product/28-admin-todoist-console.md.
 */
export async function getAdminTasksData(session: AppSession): Promise<AdminTasksData> {
  const me = {
    id: session.user.id,
    name: session.user.name ?? "",
    role: session.user.role,
  };
  try {
    const [
      tasks,
      projects,
      users,
      completions,
      fieldActivities,
      occurrenceStates,
      occurrenceOrders,
    ] = await Promise.all([
      getVisibleTasks(session),
      getVisibleProjects(session),
      getShareableUsers(session),
      getCompletionRecords(session),
      // 모바일 완료·기록과 **같은 함수**를 쓴다 — 두 화면이 같은 줄을 보여야 한다.
      getFieldActivities({
        organizationId: session.organization.id,
        userId: session.user.id,
        locale: session.user.preferredLanguage,
      }),
      getOccurrenceStates(session),
      getOccurrenceOrders(session),
    ]);
    return {
      tasks,
      projects,
      users,
      completions,
      fieldActivities,
      occurrenceStates,
      occurrenceOrders,
      me,
      loadError: false,
    };
  } catch {
    return {
      tasks: [],
      projects: [],
      users: [],
      completions: [],
      fieldActivities: [],
      occurrenceStates: [],
      occurrenceOrders: [],
      me,
      loadError: true,
    };
  }
}
