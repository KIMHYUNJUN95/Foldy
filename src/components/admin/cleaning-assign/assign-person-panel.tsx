"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { loadPersonShiftForPanel } from "@/app/admin/cleaning-assign/actions";
import { resolveCancelRequest, toggleApplicationForUser } from "@/actions/cleaning-assign-shift";
import { fill, type CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import type { PersonShift } from "@/lib/cleaning-assign/person-shift";
import { haptic } from "@/lib/haptics";
import { localizeBuildingName } from "@/lib/room-label-normalization";
import { PersonShiftCalendar, PersonShiftDay, PersonShiftStats, PersonShiftUpcoming, psPersonLine } from "./person-shift-parts";
import type { PsAction } from "./person-shift-text";

/**
 * 월 보기 오른쪽 사람 패널 — 이름을 누르면 그 사람 한 달(시안 72AoNd… ①~③, 2026-10-23). 공용 `.panel` 오른쪽 상세 패널을 쓰되
 * 가림막 없이 열어 둔다: 보드의 다른 이름을 누르거나 ↑↓ 로 바로 다음 사람으로 넘어간다(한 명씩 차례로 확인).
 * 날짜를 누르면 그날 방 · 같이 · 누가 배정 · 그 사람 청소 기록. 보드가 새로 읽히면(실시간 신호 · 동작 뒤) 패널도 다시 읽는다.
 * 사람이 바뀌면 보드가 `key` 를 바꿔 새로 연다(고른 날도 비워짐).
 * docs/product/37-cleaning-shift-assignment.md 「4-6」
 */

export function AssignPersonPanel({
  userId,
  ym,
  today,
  copy,
  locale,
  buildingLabels,
  refreshKey,
  onClose,
  onStep,
  onDate,
  onMessage,
}: {
  userId: string;
  ym: string;
  today: string;
  copy: CleaningAssignCopy;
  locale: string;
  buildingLabels: Record<string, string>;
  /** 보드 데이터가 바뀔 때마다 달라지는 값 — 패널을 다시 읽는다. */
  refreshKey: unknown;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  /** 고른 날 — 보드 열에도 같이 표시. */
  onDate: (date: string | null) => void;
  onMessage: (text: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<PersonShift | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLElement | null>(null);
  const label = (name: string) => localizeBuildingName(name, buildingLabels);

  useEffect(() => {
    let alive = true;
    loadPersonShiftForPanel({ userId, ym }).then((result) => {
      if (!alive) return;
      if (result.ok) setData(result.data);
      else onMessage(copy.failed);
    });
    return () => {
      alive = false;
    };
    // onMessage · copy 는 바뀌어도 다시 읽지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ym, refreshKey]);

  // Esc 로 닫기 · ↑↓ 로 사람 넘기기(입력 칸에 있을 때는 건드리지 않는다). 가림막이 없어 보드는 그대로 쓸 수 있다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        onStep(event.key === "ArrowUp" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  function pick(date: string) {
    const next = selected === date ? null : date;
    setSelected(next);
    onDate(next);
  }

  function act(action: PsAction, date: string) {
    if (action === "fixDay" || action === "openDay" || action === "addDay") {
      router.push(`/admin/cleaning-assign?date=${date}`);
      return;
    }
    startTransition(async () => {
      const result =
        action === "accept" || action === "reject"
          ? await resolveCancelRequest({ accept: action === "accept", date, userId })
          : await toggleApplicationForUser({ date, userId });
      if (result.ok) {
        haptic("success");
        onMessage(copy.psDone);
      } else {
        haptic("error");
        onMessage(result.reason === "conflict" ? copy.errAssigned : copy.failed);
      }
      router.refresh();
    });
  }

  const person = data?.person;
  const ready = data && data.person.userId === userId && data.ym === ym;

  return (
    <aside ref={ref} className="panel on cas-pp psc-pc" aria-label={person ? fill(copy.psOpen, { name: person.name }) : copy.psSection}>
      <div className="panel__h cas-pp__h">
        <div className="cas-pp__who">
          <span className="cas-pp__av" aria-hidden="true">
            {person?.name.slice(0, 1) ?? ""}
          </span>
          <span className="cas-pp__name">
            <b>{person?.name ?? " "}</b>
            <span>{person ? psPersonLine(person, copy) : " "}</span>
          </span>
          <button type="button" className="cas-pp__step" aria-label={copy.psPrevPerson} onClick={() => onStep(-1)}>
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" className="cas-pp__step" aria-label={copy.psNextPerson} onClick={() => onStep(1)}>
            <ChevronDown aria-hidden="true" />
          </button>
          <button type="button" className="panel__x" aria-label={copy.psClose} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel__body cas-pp__body">
        {ready ? (
          <>
            <PersonShiftStats summary={data.summary} copy={copy} />
            <span className="cas-pp__same">{copy.psSameMonth}</span>
            <PersonShiftCalendar data={data} copy={copy} locale={locale} today={today} selected={selected} onPick={pick} />
            <div className="cas-pp__below">
              {selected ? (
                <PersonShiftDay data={data} date={selected} copy={copy} locale={locale} today={today} label={label} pc pending={pending} onAction={act} />
              ) : (
                <PersonShiftUpcoming data={data} copy={copy} locale={locale} today={today} label={label} limit={5} onPick={pick} />
              )}
            </div>
            <p className="cas-pp__legend">{copy.psLegend}</p>
          </>
        ) : (
          <div className="cas-pp__loading" aria-busy="true" />
        )}
      </div>
    </aside>
  );
}
