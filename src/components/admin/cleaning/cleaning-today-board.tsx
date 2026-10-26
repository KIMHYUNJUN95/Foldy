"use client";

// 관리자 청소 콘솔 — "오늘 현황" 보드: 방 타일을 건물별 또는 상태별
// 묶음으로 보여 주고, 그 아래에 셋팅 대상 목록과 직원별 오늘 요약을 나란히 둔다. 화이트 리디자인 (2026-10-13,
// docs/design/05-white-redesign.md): 타일은 테두리나 왼쪽 상태 막대 없이 옅은 채움이고,
// 상태는 작은 텍스트 배지이며, 섹션 헤더는 단순 제목 + 진행 막대다.
// 데이터는 2026-07-14 부로 실제 데이터다 (src/lib/admin-cleaning.ts).
import type { ReactNode } from "react";
import { Check, Search } from "lucide-react";
import type { AdminCleaningTask, AdminSettingTarget } from "@/lib/admin-cleaning";
import { BUILDING_ORDER, durationMin, elapsedMin, type BuildingKey, type CleaningTaskType } from "./cleaning-console-data";
import {
  CancelledBadge,
  ReportBadges,
  buildingLabelOf,
  durLabel,
  statusLabel,
  type ConsoleCopy,
  type StaffDirectory,
  staffLabelOf,
  typeLabel,
} from "./cleaning-console-shared";
import { useRoomPlaceLabel } from "@/components/shared/building-names";

type TodayBoardProps = {
  tasks: AdminCleaningTask[];
  setupTargets: AdminSettingTarget[];
  staffDirectory: StaffDirectory;
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  group: "building" | "status";
  propFilter: BuildingKey | "all";
  staffFilter: string;
  typeFilter: CleaningTaskType | "all";
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedSetupKey: string | null;
  onSelectSetupTarget: (roomKey: string) => void;
  onClearFilters: () => void;
};

function Initial({ name }: { name: string }) {
  return <span className="cl-av">{name ? Array.from(name)[0] : "–"}</span>;
}

function RoomCard({
  task,
  t,
  buildingLabels,
  staffDirectory,
  showProp,
  selected,
  onSelect,
}: {
  task: AdminCleaningTask;
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  staffDirectory: StaffDirectory;
  showProp: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const bRoom = useRoomPlaceLabel();
  const minutes =
    task.status === "progress" ? elapsedMin(task.start) : task.status === "done" ? durationMin(task.start, task.end) : null;
  const staffName = task.staffId ? staffLabelOf(task.staffId, staffDirectory) : "";

  return (
    <div
      className={`cl-tile is-${task.status}${selected ? " sel" : ""}`}
      onClick={() => onSelect(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      <div className="cl-tile__top">
        <span className="cl-tile__rm">{bRoom(task.room)}</span>
        <span className="cl-tile__badges">
          <CancelledBadge count={task.cancelledCount} t={t} />
          <ReportBadges reports={task.reports} t={t} />
          <span className={`cl-st cl-st--${task.status}`}>{statusLabel(task.status, t)}</span>
        </span>
      </div>
      <div className="cl-tile__type">
        {showProp ? `${buildingLabelOf(task, buildingLabels)} · ` : ""}
        {typeLabel(task.type, t)}
      </div>
      <div className="cl-tile__foot">
        {staffName ? <Initial name={staffName} /> : <span className="cl-av cl-av--none">–</span>}
        <span className={`cl-tile__who${staffName ? "" : " is-none"}`}>{staffName || t.unassigned}</span>
        {task.closed ? <span className="cl-proxy">{t.stClosed}</span> : task.proxy ? <span className="cl-proxy">{t.stProxy}</span> : null}
        {minutes != null ? (
          <span className={`cl-tile__min mono${task.status === "progress" ? " is-live" : ""}`}>{durLabel(minutes, t)}</span>
        ) : null}
      </div>
    </div>
  );
}

function SectionHead({ title, count, progress }: { title: string; count: number; progress?: ReactNode }) {
  return (
    <div className="cl-sec">
      <b>{title}</b>
      <span className="cl-sec__c">{count}</span>
      {progress ? <span className="cl-sec__prog">{progress}</span> : null}
    </div>
  );
}

function BuildingSections(props: {
  tasks: AdminCleaningTask[];
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  staffDirectory: StaffDirectory;
  propFilter: BuildingKey | "all";
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { tasks, t, buildingLabels, staffDirectory, propFilter, selectedId, onSelect } = props;

  // 먼저 알려진 BuildingKey 로 묶는다 (고정 운영 순서). 7개 표준 건물 중 어느 것으로도
  // 해석되지 않은 방 라벨의 작업은 자기 그룹을 갖고 뒤에 붙으며,
  // 원래 프로퍼티 이름을 키로 삼아 실제 데이터에서 방이 조용히 빠지지 않게 한다.
  const knownGroups = new Map<BuildingKey, AdminCleaningTask[]>();
  const otherGroups = new Map<string, AdminCleaningTask[]>();
  for (const task of tasks) {
    if (task.building) {
      const list = knownGroups.get(task.building) ?? [];
      list.push(task);
      knownGroups.set(task.building, list);
    } else {
      const list = otherGroups.get(task.buildingRaw) ?? [];
      list.push(task);
      otherGroups.set(task.buildingRaw, list);
    }
  }

  const sections: { key: string; label: string; items: AdminCleaningTask[] }[] = [];
  for (const b of BUILDING_ORDER) {
    if (propFilter !== "all" && b !== propFilter) continue;
    const items = knownGroups.get(b);
    if (items?.length) sections.push({ key: b, label: buildingLabels[b] ?? b, items });
  }
  if (propFilter === "all") {
    for (const [raw, items] of [...otherGroups].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (items.length) sections.push({ key: raw, label: raw, items });
    }
  }

  return (
    <>
      {sections.map(({ key, label, items }) => {
        const done = items.filter((task) => task.status === "done").length;
        const pct = Math.round((done / items.length) * 100);
        return (
          <div key={key}>
            <SectionHead
              title={label}
              count={items.length}
              progress={
                <>
                  <span className="mono">
                    {done}/{items.length}
                  </span>{" "}
                  {t.doneN}
                  <span className="cl-prog">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span className="mono">{pct}%</span>
                </>
              }
            />
            <div className="cl-grid">
              {items.map((task) => (
                <RoomCard
                  key={task.id}
                  task={task}
                  t={t}
                  buildingLabels={buildingLabels}
                  staffDirectory={staffDirectory}
                  showProp={false}
                  selected={selectedId === task.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function StatusBuckets(props: {
  tasks: AdminCleaningTask[];
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  staffDirectory: StaffDirectory;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { tasks, t, buildingLabels, staffDirectory, selectedId, onSelect } = props;
  // 취소 카드는 예약 대상이 없는 임의(기타) 청소가 취소된 경우에만 생긴다 — 있을 때만 4번째
  // 칼럼을 붙여 평소 3칼럼 레이아웃을 유지한다.
  const hasCancelled = tasks.some((task) => task.status === "cancelled");
  const buckets: Array<{
    key: "pending" | "progress" | "done" | "cancelled";
    label: string;
    has: (task: AdminCleaningTask) => boolean;
  }> = [
    { key: "pending", label: t.bkPending, has: (task) => task.status === "pending" },
    { key: "progress", label: t.bkProgress, has: (task) => task.status === "progress" },
    { key: "done", label: t.bkDone, has: (task) => task.status === "done" },
  ];
  if (hasCancelled) {
    buckets.push({ key: "cancelled", label: t.stCancelled, has: (task) => task.status === "cancelled" });
  }
  return (
    <div className={`cl-bk${hasCancelled ? " cl-bk--4" : ""}`}>
      {buckets.map((bucket) => {
        const items = tasks.filter(bucket.has);
        return (
          <section className="cl-bk__col" key={bucket.key}>
            <div className="cl-sec cl-sec--col">
              <b>{bucket.label}</b>
              <span className="cl-sec__c">{items.length}</span>
            </div>
            <div className="cl-bk__body">
              {items.length ? (
                items.map((task) => (
                  <RoomCard
                    key={task.id}
                    task={task}
                    t={t}
                    buildingLabels={buildingLabels}
                    staffDirectory={staffDirectory}
                    showProp
                    selected={selectedId === task.id}
                    onSelect={onSelect}
                  />
                ))
              ) : (
                <div className="cl-none">{t.emptyT}</div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SetupSection({
  targets,
  t,
  buildingLabels,
  selectedSetupKey,
  onSelectSetupTarget,
}: {
  targets: AdminSettingTarget[];
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  selectedSetupKey: string | null;
  onSelectSetupTarget: (roomKey: string) => void;
}) {
  const bRoom = useRoomPlaceLabel();
  if (!targets.length) return null;
  return (
    <section className="cl-split__col">
      <div className="cl-sec cl-sec--col">
        <b>{t.secSetup}</b>
        <span className="cl-sec__c">{targets.length}</span>
      </div>
      <div className="cl-sub">{t.secSetupSub}</div>
      <div className="cl-list">
        {targets.map((target) => (
          <div
            className={`cl-setrow${selectedSetupKey === target.roomKey ? " sel" : ""}`}
            key={target.roomKey}
            onClick={() => onSelectSetupTarget(target.roomKey)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSetupTarget(target.roomKey);
              }
            }}
          >
            <span className="cl-setrow__rm mono">{bRoom(target.room)}</span>
            <div className="cl-setrow__b">
              <div className="cl-setrow__t">{target.guest}</div>
              <div className="cl-setrow__s">
                {buildingLabelOf(target, buildingLabels)} · {t.arriving} {t.today}
              </div>
            </div>
            {target.pax != null ? (
              <span className="cl-setrow__pax">
                {target.pax}
                {t.pax}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function StaffSummarySection({
  tasks,
  t,
  staffDirectory,
}: {
  tasks: AdminCleaningTask[];
  t: ConsoleCopy;
  staffDirectory: StaffDirectory;
}) {
  // 완료했거나 지금 청소 중인 사람 — 시안 「완료 1 · 진행 1」(2026-10-13, 진행만 있는 사람도 보인다).
  // 청소 배정 「처리 끝」 기록은 누른 관리자의 청소가 아니다 — 직원별 요약에서 뺀다.
  const worked = tasks.filter((task) => task.staffId && !task.closed && (task.status === "done" || task.status === "progress"));
  const ids = new Set(worked.map((task) => task.staffId));
  const staffList = [...staffDirectory.values()].filter((s) => ids.has(s.id));
  if (!staffList.length) return null;
  return (
    <section className="cl-split__col">
      <div className="cl-sec cl-sec--col">
        <b>{t.secStaff}</b>
      </div>
      <div className="cl-staff">
        {staffList.map((s) => {
          const mine = worked.filter((task) => task.staffId === s.id);
          const done = mine.filter((task) => task.status === "done");
          const prog = mine.length - done.length;
          const durs = done.map((task) => durationMin(task.start, task.end)).filter((v): v is number => v != null);
          const avg = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null;
          return (
            <div className="cl-staffc" key={s.id}>
              <span className="cl-av cl-av--lg">{Array.from(s.name)[0] ?? "–"}</span>
              <div className="cl-staffc__b">
                <div className="cl-staffc__nm">{s.name}</div>
                <div className="cl-staffc__s">
                  {t.staffDoneProg.replace("{done}", String(done.length)).replace("{prog}", String(prog))}
                </div>
              </div>
              <div className="cl-staffc__stat">
                <div className="cl-staffc__v mono">{avg == null ? "—" : durLabel(avg, t)}</div>
                <div className="cl-staffc__k">{t.avg}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TodayBoard({
  tasks,
  setupTargets,
  staffDirectory,
  t,
  buildingLabels,
  group,
  propFilter,
  staffFilter,
  typeFilter,
  query,
  selectedId,
  onSelect,
  selectedSetupKey,
  onSelectSetupTarget,
  onClearFilters,
}: TodayBoardProps) {
  const q = query.trim().toLowerCase();
  const match = (task: AdminCleaningTask) => {
    if (propFilter !== "all" && task.building !== propFilter) return false;
    if (staffFilter !== "all" && task.staffId !== staffFilter) return false;
    if (typeFilter !== "all" && task.type !== typeFilter) return false;
    if (!q) return true;
    const buildingText = buildingLabelOf(task, buildingLabels).toLowerCase();
    const staffText = task.staffId ? staffLabelOf(task.staffId, staffDirectory).toLowerCase() : "";
    return task.room.toLowerCase().includes(q) || staffText.includes(q) || buildingText.includes(q);
  };
  const all = tasks.filter((task) => task.type !== "setup" && match(task));

  const setups = setupTargets.filter(
    (target) => propFilter === "all" || target.building === propFilter,
  );
  const filtersActive = staffFilter !== "all" || propFilter !== "all" || typeFilter !== "all" || Boolean(q);

  if (!all.length) {
    return (
      <div className="cl-empty">
        <span className={`cl-empty__ic${filtersActive ? "" : " is-ok"}`}>
          {filtersActive ? <Search aria-hidden="true" /> : <Check aria-hidden="true" />}
        </span>
        <div className="cl-empty__t">{t.emptyT}</div>
        <div className="cl-empty__s">{t.emptyS}</div>
        {filtersActive ? (
          <button type="button" className="cl-empty__btn" onClick={onClearFilters}>
            {t.clearFilter}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {group === "status" ? (
        <StatusBuckets
          tasks={all}
          t={t}
          buildingLabels={buildingLabels}
          staffDirectory={staffDirectory}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : (
        <BuildingSections
          tasks={all}
          t={t}
          buildingLabels={buildingLabels}
          staffDirectory={staffDirectory}
          propFilter={propFilter}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
      <div className="cl-split">
        <SetupSection
          targets={setups}
          t={t}
          buildingLabels={buildingLabels}
          selectedSetupKey={selectedSetupKey}
          onSelectSetupTarget={onSelectSetupTarget}
        />
        <StaffSummarySection tasks={tasks} t={t} staffDirectory={staffDirectory} />
      </div>
    </>
  );
}
