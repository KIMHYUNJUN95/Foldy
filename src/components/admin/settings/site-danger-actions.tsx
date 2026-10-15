"use client";

import {
  deleteAttendanceSiteAction,
  setAttendanceSiteActiveAction,
} from "@/app/admin/settings/attendance/actions";
import { SettingsConfirm } from "./settings-confirm";

// 출퇴근 현장 정리 — 비활성화 / 다시 활성화 / 완전 삭제(2026-10-15 화이트 리디자인: 패널 맨 아래 글자 버튼).
//
// 비활성화는 되돌릴 수 있어 바로 실행한다. 삭제는 되돌릴 수 없고(붙여둔 인쇄 QR 도 즉시 죽는다) 확인 창을 거친다.
// **출퇴근 기록이 있는 현장은 삭제 자체가 불가능하다** — `attendance_sessions` 의 FK 가 `on delete restrict`
// 라 DB 가 막는다(급여 근거 보호). 그런 현장은 삭제 버튼 없이 비활성화만 남긴다(안내 한 줄은 페이지가 버튼 줄 아래에 띄운다).

type Labels = {
  delete: string;
  deleteTitle: string;
  deleteConfirm: string;
  deleteOk: string;
  keep: string;
  deactivate: string;
  activate: string;
};

export function SiteDangerActions({
  siteId,
  isActive,
  hasHistory,
  labels,
}: {
  siteId: string;
  isActive: boolean;
  /** 출퇴근 기록이 있으면 삭제 불가 — 비활성화만 제공한다. */
  hasHistory: boolean;
  labels: Labels;
}) {
  return (
    <div className="stw-danger">
        <form action={setAttendanceSiteActiveAction}>
          <input name="siteId" type="hidden" value={siteId} />
          <input name="activate" type="hidden" value={isActive ? "0" : "1"} />
          <button className={`stw-btn is-text ${isActive ? "is-red" : "is-violet"}`} type="submit">
            {isActive ? labels.deactivate : labels.activate}
          </button>
        </form>
        {hasHistory ? null : (
          <SettingsConfirm
            action={deleteAttendanceSiteAction}
            fields={{ siteId }}
            trigger={labels.delete}
            triggerClassName="stw-btn is-text is-red"
            title={labels.deleteTitle}
            body={labels.deleteConfirm}
            keep={labels.keep}
            ok={labels.deleteOk}
            danger
          />
        )}
    </div>
  );
}
