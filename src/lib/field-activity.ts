import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplaySessionRoomLabel,
  localizeRoomPlaceLabel,
} from "@/lib/room-label-normalization";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tasks";
import { getDictionary, type Locale } from "@/lib/i18n";

/**
 * 현장 활동 — 투두 밖에서 **사용자가 확실하게 완료 처리한** 일을 완료·기록 탭과 업무일지에 얹기 위한
 * 읽기 전용 소스.
 *
 * ## 왜 `tasks` 행을 만들지 않는가 (2026-08-04 결정)
 *
 * "청소를 끝내면 자동으로 투두 완료 기록에 남게 하자"를 `tasks` 행 자동 생성으로 구현하면:
 *   1. 오늘·내일·관리함 목록이 사용자가 만들지 않은 항목으로 오염된다.
 *   2. `tasks` 는 soft delete + 실행취소 계약을 지는데 청소 기록엔 그 계약이 없다 — 되돌리기를
 *      누르면 무엇이 되살아나야 하는지 정의되지 않는다.
 *   3. 청소 기록이 나중에 수정되면 복제된 task 행까지 따로 고쳐야 한다(이 저장소가 반복 규칙을
 *      두 파일에 복제했다가 실제 데이터 손실을 낸 것과 같은 종류의 위험).
 *
 * 그래서 **읽을 때만 합친다.** DB 쓰기는 0건이고, 원본이 바뀌면 다음 조회에 자동으로 반영된다.
 *
 * ## "확실하게 완료"의 기준
 *
 * 시작·신고·접수는 완료가 아니다. 각 소스에서 사용자가 **끝냈다고 스스로 표시한 시점**만 센다:
 *   - 청소: `status = completed` (진행 중 / 취소 제외), 실제 청소한 `staff_user_id` 기준
 *   - 유지보수: `status = closed` 이고 `completed_by` 가 본인 (open / in_progress / cancelled 제외)
 *   - 린넨: 반품 등록이 완료된 행 (`registered_at`)
 *   - 주문: 요청 등록이 완료된 행 (`created_at`)
 *
 * 분실물은 의도적으로 뺐다.
 */

export type FieldActivityKind = "cleaning" | "maintenance" | "linen" | "order";

export type FieldActivityRecord = {
  /** Tokyo 운영일(YYYY-MM-DD). 완료·기록의 날짜 그룹 키. */
  day: string;
  /** 그룹 안 정렬용 타임스탬프(ISO). */
  at: string;
  kind: FieldActivityKind;
  /** 이미 로케일이 적용된 표시 문구. */
  label: string;
};

// ── 문구 템플릿 ──────────────────────────────────────────────────────────────
// i18n-ignore-start: 현장 활동 줄 문구를 로케일별로 한곳에 모아 둔다(report-actions 의 보고서
// 템플릿과 같은 방식). 건물명은 `아라키초A` 처럼 한국어 정규 명칭으로 저장돼 있어 넣을 때 보는 사람 언어로 바꾼다.
const FIELD_TEMPLATE: Record<
  string,
  { cleaning: string; maintenance: string; linen: string; order: string }
> = {
  ko: {
    cleaning: "{room} 청소 완료",
    maintenance: "{room} 유지보수 완료",
    linen: "린넨 반품처리 및 등록 완료",
    order: "재고조사 및 주문요청 처리 완료",
  },
  ja: {
    cleaning: "{room} 清掃完了",
    maintenance: "{room} メンテナンス完了",
    linen: "リネン返品処理・登録完了",
    order: "在庫確認・発注依頼処理完了",
  },
  en: {
    cleaning: "{room} cleaning completed",
    maintenance: "{room} maintenance completed",
    linen: "Linen return processed and registered",
    order: "Stock check and order request submitted",
  },
};
// i18n-ignore-end

/** 완료·기록이 보여주는 범위와 맞춘다(`getTaskCompletions` 와 동일한 120일). */
const WINDOW_DAYS = 120;

/**
 * 유지보수는 Beds24 원본 이름을 그대로 저장한다("Arakicho A" / "202#"). 청소 세션이 쓰는
 * `{정규 건물명} {정규 방라벨}` 형태로 맞춰야 두 줄의 표기가 갈라지지 않는다.
 * 건물 전체 건(`is_building_only`)은 방 번호 없이 건물명만 남긴다.
 */
function maintenanceRoomLabel(propertyName: string, roomLabel: string, buildingOnly: boolean) {
  const property = getCanonicalPropertyName(propertyName ?? "");
  if (buildingOnly) return property;
  const room = getCanonicalRoomLabel(propertyName ?? "", roomLabel ?? "");
  if (!room || room === property) return property;
  return `${property} ${room}`;
}

/**
 * 로그인 사용자가 최근 `WINDOW_DAYS` 일 동안 완료 처리한 현장 활동을 Tokyo 운영일로 묶어 돌려준다.
 *
 * 린넨·주문은 **하루에 몇 번 했든 한 줄로 합친다.** 횟수를 세는 게 목적이 아니라 "했다"를 남기는
 * 것이고, 같은 문구가 여러 줄 반복되면 일지가 읽기 나빠진다. 청소·유지보수는 호수가 달라 자연히
 * 구분되므로 합치지 않는다(같은 방을 두 번 할 일도 없다).
 */
export async function getFieldActivities(opts: {
  organizationId: string;
  userId: string;
  locale: Locale;
}): Promise<FieldActivityRecord[]> {
  const { organizationId, userId, locale } = opts;
  const tmpl = FIELD_TEMPLATE[locale] ?? FIELD_TEMPLATE.ko;
  // 방 라벨의 건물 부분은 한국어 정규 명칭으로 저장돼 있다 — 일지 · 기록에 찍을 때 보는 사람 언어로(2026-10-22).
  const buildingLabels = getDictionary(locale).cleaning.buildingLabels;
  const place = (room: string) => localizeRoomPlaceLabel(room, buildingLabels);
  const since = ymdShift(tokyoToday(), -WINDOW_DAYS);
  const sinceIso = new Date(`${since}T00:00:00+09:00`).toISOString();

  const supabase = await getSupabaseServerClient();
  const [cleaning, maintenance, linen, order] = await Promise.all([
    supabase
      .from("cleaning_sessions")
      .select("room_label, cleaning_date, completed_at")
      .eq("organization_id", organizationId)
      .eq("staff_user_id", userId)
      .eq("status", "completed")
      .eq("closed_without_cleaning", false)
      .gte("cleaning_date", since),
    supabase
      .from("maintenance_reports")
      .select("property_name, room_label, is_building_only, completed_at")
      .eq("organization_id", organizationId)
      .eq("completed_by", userId)
      .eq("status", "closed")
      .gte("completed_at", sinceIso),
    supabase
      .from("linen_return_records")
      .select("registered_at")
      .eq("organization_id", organizationId)
      .eq("registered_by_user_id", userId)
      .gte("registered_at", sinceIso),
    supabase
      .from("order_requests")
      .select("created_at")
      .eq("organization_id", organizationId)
      .eq("reported_by_user_id", userId)
      .gte("created_at", sinceIso),
  ]);

  const out: FieldActivityRecord[] = [];

  for (const row of (cleaning.data ?? []) as {
    room_label: string | null;
    cleaning_date: string | null;
    completed_at: string | null;
  }[]) {
    // 청소는 `cleaning_date` 자체가 이미 Tokyo 운영일 키다 — 타임스탬프에서 다시 계산하면
    // 자정을 넘겨 끝낸 청소가 다음 날로 밀린다(운영일과 달력일은 다르다).
    const day = row.cleaning_date;
    // 저장된 세션 라벨은 매칭용 원본이라 아라키초 서브리스팅 접미사가 남아 있다("아라키초A 501_2").
    // 사용자에게 보이는 자리에서는 표시형으로 접는다 — 일지에 "501_2" 가 찍히면 방 번호로 안 읽힌다.
    const room = getDisplaySessionRoomLabel(row.room_label ?? "");
    if (!day || !room) continue;
    out.push({
      day,
      at: row.completed_at ?? `${day}T00:00:00+09:00`,
      kind: "cleaning",
      label: tmpl.cleaning.replace("{room}", place(room)),
    });
  }

  for (const row of (maintenance.data ?? []) as {
    property_name: string | null;
    room_label: string | null;
    is_building_only: boolean | null;
    completed_at: string | null;
  }[]) {
    const day = tokyoDateOf(row.completed_at);
    const room = maintenanceRoomLabel(
      row.property_name ?? "",
      row.room_label ?? "",
      !!row.is_building_only,
    );
    if (!day || !room) continue;
    out.push({
      day,
      at: row.completed_at ?? "",
      kind: "maintenance",
      label: tmpl.maintenance.replace("{room}", place(room)),
    });
  }

  // 린넨 · 주문 — 하루 한 줄로 접는다. 같은 날 여러 건이면 가장 늦은 시각을 대표로 쓴다.
  const collapse = (
    rows: { at: string | null }[],
    kind: FieldActivityKind,
    label: string,
  ) => {
    const latestByDay = new Map<string, string>();
    for (const row of rows) {
      const day = tokyoDateOf(row.at);
      if (!day) continue;
      const at = row.at ?? "";
      if (at > (latestByDay.get(day) ?? "")) latestByDay.set(day, at);
    }
    for (const [day, at] of latestByDay) out.push({ day, at, kind, label });
  };

  collapse(
    ((linen.data ?? []) as { registered_at: string | null }[]).map((r) => ({ at: r.registered_at })),
    "linen",
    tmpl.linen,
  );
  collapse(
    ((order.data ?? []) as { created_at: string | null }[]).map((r) => ({ at: r.created_at })),
    "order",
    tmpl.order,
  );

  // 최신순 — 완료·기록의 날짜 그룹 안 정렬과 같은 규칙.
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}
