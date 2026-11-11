/** 근무 수기 입력 창의 입력값 — 처음 열었을 때와 달라졌는지(2026-11-11). 달라졌으면 Esc · 바깥 누르기로 닫기 전에 묻는다. */
export type ManualSessionDraft = {
  userId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  location: string;
  reason: string;
};

export function isManualDraftDirty(draft: ManualSessionDraft, defaultDate: string): boolean {
  return (
    Boolean(draft.userId) ||
    draft.date !== defaultDate ||
    Boolean(draft.clockIn) ||
    Boolean(draft.clockOut) ||
    Boolean(draft.location.trim()) ||
    Boolean(draft.reason.trim())
  );
}

/** 창 안에 날짜(`.adp__pop`) · 시각(`.atp__pop`) 고르기 창이 열려 있는지 — 열려 있으면 Esc 는 그 창 몫이라 이 창은 닫지 않는다.
 *  공용 피커는 preventDefault 를 하지 않아서 DOM 으로 본다(PC 연차 신청 창과 같은 방식). */
export function pickerPopoverOpen(root: Pick<ParentNode, "querySelector"> | { querySelector: (sel: string) => unknown } | null): boolean {
  return Boolean(root?.querySelector(".adp__pop, .atp__pop"));
}
