"use client";

// Admin cleaning console — force-complete confirmation modal (the console's only mutating action).
// Admin enters the actual finish time so started_at → entered time drives the recorded duration,
// picks who they're completing on behalf of, and may leave a note. Mirrors clean-views.js modal().
// Data is real (src/lib/admin-cleaning.ts) as of 2026-07-14 — onConfirm's result maps 1:1 onto
// ForceCompleteCleaningInput (src/app/admin/cleaning/actions.ts) so the parent can call the server
// action directly with it.
import { useState } from "react";
import { Clock, ShieldCheck, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminTimePicker } from "@/components/admin/shared/admin-time-picker";
import type { AdminCleaningTask } from "@/lib/admin-cleaning";
import { fmtDur, toMin, type CleaningTaskType } from "./cleaning-console-data";
import {
  StatusPill,
  buildingLabelOf,
  staffLabelOf,
  typeLabel,
  type ConsoleCopy,
  type StaffDirectory,
} from "./cleaning-console-shared";
import { useRoomPlaceLabel } from "@/components/shared/building-names";

export type ForceCompleteResult = {
  sessionId: string | null;
  /**
   * canonical `cleaning_sessions.room_label` (예: "아라키초A 501_2").
   * 카드에 보이는 `task.room` 은 아라키초 서브유닛이 축약된 표시용 값이라 저장에 쓰면
   * 모바일 청소 큐와 매칭이 깨진다 — 반드시 canonical 라벨을 보낸다.
   */
  sessionRoomLabel: string;
  taskType: CleaningTaskType;
  staffId: string;
  start: string;
  end: string;
  note: string;
};

type ForceCompleteModalProps = {
  task: AdminCleaningTask;
  nowLabel: string;
  t: ConsoleCopy;
  buildingLabels: Record<string, string>;
  staffDirectory: StaffDirectory;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (result: ForceCompleteResult) => void;
};

export function CleaningForceCompleteModal({
  task,
  nowLabel,
  t,
  buildingLabels,
  staffDirectory,
  pending,
  onCancel,
  onConfirm,
}: ForceCompleteModalProps) {
  const bRoom = useRoomPlaceLabel();
  const [start, setStart] = useState(task.start ?? "11:00");
  const [end, setEnd] = useState(nowLabel);
  const [staffId, setStaffId] = useState(task.staffId ?? "");
  const [note, setNote] = useState(task.note ?? "");

  const durMin = toMin(end) != null && toMin(start) != null ? (toMin(end) as number) - (toMin(start) as number) : null;
  const durInvalid = durMin != null && durMin <= 0;
  const durText = durMin != null && durMin > 0 ? fmtDur(durMin) : "—";

  const staffOptions = [...staffDirectory.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return (
    <>
      <div className="modal-scrim on" onClick={onCancel} />
      <div className="modal on" style={{ width: 520 }}>
        <div className="modal__h">
          <div>
            <div className="modal__kicker">{t.mKicker}</div>
            <div className="modal__t">{t.mTitle}</div>
          </div>
          <button type="button" className="panel__x" onClick={onCancel} aria-label={t.mCancel}>
            <X />
          </button>
        </div>
        <div className="modal__body">
          <div className="mrow">
            <span className="mrow__rm">{bRoom(task.room)}</span>
            <div className="mrow__b">
              <div className="mrow__t">
                {buildingLabelOf(task, buildingLabels)} · {typeLabel(task.type, t)}
              </div>
              {task.staffId ? <div className="mrow__s">{staffLabelOf(task.staffId, staffDirectory)}</div> : null}
            </div>
            <StatusPill status={task.status} t={t} />
          </div>

          <div className="fld">
            <label className="fld__l">{t.mStaff}</label>
            <AdmDropdown
              value={staffId}
              onChange={setStaffId}
              placeholder={t.mStaffPh}
              ariaLabel={t.mStaff}
              options={staffOptions.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>

          <div className="fld2">
            <div className="fld">
              <label className="fld__l">{t.mStartAt}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AdminTimePicker value={start} onChange={setStart} ariaLabel={t.mStartAt} />
                <button type="button" className="tpick__now" onClick={() => setStart(nowLabel)}>
                  <Clock className="ic" aria-hidden="true" />
                  {t.mNowBtn}
                </button>
              </div>
            </div>
            <div className="fld">
              <label className="fld__l">{t.mEndAt}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AdminTimePicker value={end} onChange={setEnd} ariaLabel={t.mEndAt} />
                <button type="button" className="tpick__now" onClick={() => setEnd(nowLabel)}>
                  <Clock className="ic" aria-hidden="true" />
                  {t.mNowBtn}
                </button>
              </div>
            </div>
          </div>

          <div className="mdur">
            <Clock className="ic" aria-hidden="true" />
            {t.mDurLabel} · <b>{durText}</b>
            {durInvalid ? <span role="alert" style={{ marginLeft: 8, color: "#c4364b" }}>{t.mDurInvalid}</span> : null}
          </div>

          <div className="fld">
            <label className="fld__l">{t.mNote}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.mNotePh} />
          </div>
        </div>
        <div className="modal__foot">
          <span className="modal__foot-note">
            <ShieldCheck className="ic" aria-hidden="true" />
            {t.mFootNote}
          </span>
          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={pending}>
              {t.mCancel}
            </button>
            <button
              type="button"
              className="btn btn--pri"
              disabled={!staffId || pending || durMin == null || durMin <= 0}
              onClick={() =>
                onConfirm({
                  sessionId: task.sessionId,
                  sessionRoomLabel: task.sessionRoomLabel,
                  taskType: task.type,
                  staffId,
                  start,
                  end,
                  note,
                })
              }
            >
              {t.mConfirm}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
