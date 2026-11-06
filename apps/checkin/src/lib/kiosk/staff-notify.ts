import "server-only";

import type { CheckinServiceClient } from "../supabase/service";

// 직원 알림 — 받는 사람 계산과 넣기는 SQL `checkin.notify_staff` 한 곳(46 §4). 알림 실패가 호출 · 체크인을 망치면 안 된다.

export const CHECKIN_NOTICE_HREF = "/admin/checkin";

export type StaffNotice = {
  organizationId: string;
  capability: "checkin.call" | "checkin.view";
  type: "checkin_staff_call" | "checkin_call_missed" | "checkin_staff_check";
  sourceId: string;
  /** 손님 정보를 넣지 않는다. 호출 · 놓침은 `checkin.call` 만 가진 직원에게도 가므로 stayId 를 싣지 않는다. */
  payload: { callId: string; propertyKey: string } | { stayId: string; propertyKey: string };
};

/** 받는 사람 수. 실패하면 null(모름) — 0(받을 사람 없음)과 다르다. */
export async function notifyStaff(db: CheckinServiceClient, notice: StaffNotice): Promise<number | null> {
  try {
    const { data, error } = await db.rpc("notify_staff", {
      p_organization_id: notice.organizationId,
      p_capability: notice.capability,
      p_type: notice.type,
      p_dedupe_key: `${notice.type}:${notice.sourceId}`,
      p_href: CHECKIN_NOTICE_HREF,
      p_payload: notice.payload,
    });
    if (error) throw new Error(error.message);
    return data as number;
  } catch (error) {
    console.error("[staff-notify]", notice.type, error instanceof Error ? error.message : "실패");
    return null;
  }
}
