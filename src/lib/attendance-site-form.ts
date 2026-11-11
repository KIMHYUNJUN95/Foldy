/** 근무지 설정 폼 — 저장 실패 때 돌아갈 주소 · 입력값 되살리기(2026-11-11). */

export type SiteDraft = {
  name: string;
  printName: string;
  latitude: string;
  longitude: string;
  radius: string;
  propertyId: string;
};

const DRAFT_KEYS: Record<keyof SiteDraft, string> = {
  name: "d_name",
  printName: "d_print",
  latitude: "d_lat",
  longitude: "d_lng",
  radius: "d_radius",
  propertyId: "d_property",
};

/**
 * 저장 실패 주소. 새 근무지(`siteId` 빈 값)는 `?site=new` 로 돌아가 새 등록 폼을 그대로 보이고, 친 값을 주소에 실어 되살린다
 * — 전에는 `?site=` 가 비어 첫 근무지 폼이 열렸고 입력이 사라졌다. 있는 근무지는 저장된 값이 기준이라 싣지 않는다.
 * 근무지 이름 · 좌표는 비밀이 아니다(목록에 그대로 보인다).
 */
export function siteFormErrorHref(siteId: string, code: string, draft: SiteDraft): string {
  const params = new URLSearchParams();
  params.set("site", siteId || "new");
  params.set("error", code);
  if (!siteId) {
    for (const key of Object.keys(DRAFT_KEYS) as (keyof SiteDraft)[]) {
      if (draft[key]) params.set(DRAFT_KEYS[key], draft[key]);
    }
  }
  return `/admin/settings/attendance?${params.toString()}`;
}

/** 주소의 입력값 → 폼 기본값. 하나도 없으면 null. */
export function readSiteDraft(params: Record<string, string | string[] | undefined>): SiteDraft | null {
  const pick = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
  };
  const draft = Object.fromEntries(
    (Object.keys(DRAFT_KEYS) as (keyof SiteDraft)[]).map((key) => [key, pick(DRAFT_KEYS[key])]),
  ) as SiteDraft;
  return Object.values(draft).some(Boolean) ? draft : null;
}
