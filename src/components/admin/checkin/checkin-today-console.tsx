"use client";

// 셀프 체크인 · 오늘 도착(시안 S1) — 날짜(공용 피커) · 건물 거르기 · 요약 · 할 일 순 목록 · 줄을 누르면 오른쪽 패널.
// 권한 `checkin.view`. 목록은 서버(페이지)가 읽어 내려 주고 날짜 · 건물은 주소의 쿼리로 바꾼다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GetCheckinArrivalsResult } from "@/actions/checkin/stays";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { useBuildingName } from "@/components/shared/building-names";
import type { CheckinArrivalRow } from "@/lib/checkin/model";
import { groupArrivalRows, formatTokyoTime, rosterDots, roomsText, rowStatus } from "@/lib/checkin/staff-view";
import type { Locale } from "@/lib/i18n";
import { channelLabel, fill, localeTagOf, routeLabel, statusLabel, type CheckinCopy, type CheckinSharedCopy } from "./checkin-copy";
import { CheckinStayPanel } from "./checkin-stay-panel";
import { CheckinState } from "./checkin-ui";
import "./checkin.css";

export function CheckinTodayConsole({
  copy,
  shared,
  locale,
  date,
  propertyKey,
  properties,
  result,
}: {
  copy: CheckinCopy;
  shared: CheckinSharedCopy;
  locale: Locale;
  date: string;
  propertyKey: string | null;
  properties: { key: string; name: string }[];
  result: GetCheckinArrivalsResult;
}) {
  const router = useRouter();
  const buildingName = useBuildingName();
  const { toast, showToast, dismiss } = useAdminToast();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function go(next: { date?: string; property?: string | null }) {
    const params = new URLSearchParams();
    params.set("date", next.date ?? date);
    const nextProperty = next.property === undefined ? propertyKey : next.property;
    if (nextProperty) params.set("property", nextProperty);
    setSelectedId(null);
    startTransition(() => router.replace(`/admin/checkin?${params.toString()}`));
  }

  const toolbar = (
    <div className="ck-bar">
      <AdminDatePicker
        value={date}
        onChange={(value) => value && go({ date: value })}
        localeTag={localeTagOf(locale)}
        ariaLabel={copy.dateLabel}
        labels={{ prevMonth: shared.datePrevMonth, nextMonth: shared.dateNextMonth, today: shared.dateToday }}
      />
      <AdmDropdown
        size="sm"
        value={propertyKey ?? "all"}
        onChange={(value) => go({ property: value === "all" ? null : value })}
        ariaLabel={copy.propertyLabel}
        options={[{ value: "all", label: copy.allProperties }, ...properties.map((property) => ({ value: property.key, label: buildingName(property.name) }))]}
      />
    </div>
  );

  if (!result.ok) {
    const kind = result.errorKey === "forbidden" ? "forbidden" : result.errorKey === "not_ready" ? "notReady" : "error";
    return (
      <div className="ck">
        {toolbar}
        <CheckinState
          kind={kind}
          title={kind === "forbidden" ? shared.noAccessTitle : kind === "notReady" ? copy.notReadyTitle : copy.errorTitle}
          body={kind === "forbidden" ? shared.noAccessBody : kind === "notReady" ? copy.notReadyBody : copy.errorBody}
          action={
            kind === "error" ? (
              <button type="button" className="ck-btn is-sm" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
                {copy.retry}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const { summary, rows } = result;
  const groups = groupArrivalRows(rows);

  return (
    <div className="ck">
      {toolbar}

      <div className="ck-sum" aria-label={copy.title}>
        <Stat value={summary.arrivals} label={copy.sumArrivals} />
        <Stat value={summary.checkedIn} label={copy.sumCheckedIn} />
        <Stat value={summary.inProgress} label={copy.sumInProgress} />
        <Stat value={summary.notYet} label={copy.sumNotYet} />
        <Stat value={summary.needsAttention} label={copy.sumAttention} red={summary.needsAttention > 0} />
      </div>

      <div className={pending ? "ck-busy" : undefined} aria-busy={pending}>
        {rows.length === 0 ? (
          <CheckinState kind="empty" title={copy.emptyTitle} body={copy.emptyBody} />
        ) : (
          <>
            <div className="ck-th" aria-hidden="true">
              <span>{copy.colGuest}</span>
              <span>{copy.colRoom}</span>
              <span>{copy.colParty}</span>
              <span>{copy.colRoster}</span>
              <span>{copy.colStatus}</span>
              <span>{copy.colTime}</span>
            </div>
            {groups.map(({ group, rows: groupRows }) => (
              <section key={group} aria-label={groupLabel(group, groupRows.length, copy)}>
                <div className={`ck-grp num${group === "attention" ? " is-red" : ""}`}>{groupLabel(group, groupRows.length, copy)}</div>
                <div className="ck-rows">
                  {groupRows.map((row) => (
                    <ArrivalRow key={row.stayId} row={row} copy={copy} selected={row.stayId === selectedId} onSelect={() => setSelectedId(row.stayId)} />
                  ))}
                </div>
              </section>
            ))}
            <p className="ck-soft" style={{ marginTop: 14 }}>
              {copy.channelsHint}
            </p>
          </>
        )}
      </div>

      {selectedId ? (
        <CheckinStayPanel
          key={selectedId}
          stayId={selectedId}
          copy={copy}
          locale={locale}
          noAccessTitle={shared.noAccessTitle}
          onClose={() => setSelectedId(null)}
          onToast={showToast}
          onChanged={() => startTransition(() => router.refresh())}
        />
      ) : null}
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

function groupLabel(group: CheckinArrivalRow["group"], n: number, copy: CheckinCopy): string {
  const template =
    group === "attention" ? copy.groupAttention : group === "in_progress" ? copy.groupInProgress : group === "not_yet" ? copy.groupNotYet : copy.groupDone;
  return fill(template, { n });
}

function Stat({ value, label, red }: { value: number; label: string; red?: boolean }) {
  return (
    <div>
      <b className={`num${red ? " is-red" : ""}`}>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function ArrivalRow({ row, copy, selected, onSelect }: { row: CheckinArrivalRow; copy: CheckinCopy; selected: boolean; onSelect: () => void }) {
  const buildingName = useBuildingName();
  const status = rowStatus(row);
  const time = formatTokyoTime(row.checkedInAt ?? row.startedAt);
  const route = routeLabel(row.route, copy);
  const dots = rosterDots(row.rosterFilled, row.partySize);
  return (
    <button type="button" className={`ck-tr${selected ? " on" : ""}`} aria-current={selected ? "true" : undefined} onClick={onSelect}>
      <span className="ck-who">
        <span className={`ck-dot is-${row.channel}`} aria-hidden="true" />
        <span className="ck-nm">
          <b>{row.leadName ?? "—"}</b>
          <span className="num">
            {channelLabel(row.channel, copy)} · {row.reservationNumber}
          </span>
        </span>
      </span>
      <span className="ck-c">{roomsText({ propertyName: row.propertyName, roomLabels: row.roomLabels, localizedProperty: buildingName(row.propertyName) })}</span>
      <span className="ck-c num">{fill(copy.partyN, { n: row.partySize })}</span>
      <span className="ck-c is-soft num" aria-label={fill(copy.rosterAria, { filled: row.rosterFilled, total: row.partySize })}>
        <span className="ck-pd" aria-hidden="true">
          {dots.map((filled, index) => (
            <i key={index} className={filled ? undefined : "o"} />
          ))}
        </span>
        {row.rosterFilled}/{row.partySize}
      </span>
      <span className={`ck-c ${status.tone === "red" ? "is-red" : status.tone === "ok" ? "is-ok" : "is-soft"}`}>{statusLabel(status.key, copy)}</span>
      <span className="ck-c is-soft num">{[time, route].filter(Boolean).join(" ")}</span>
    </button>
  );
}
