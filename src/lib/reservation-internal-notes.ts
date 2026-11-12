import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";
import {
  classifyNoteDbError,
  planReservationNoteWrite,
  RESERVATION_INTERNAL_NOTE_MAX_LENGTH,
  type ReservationNoteErrorCode,
  type ReservationNoteSnapshot,
  validateNoteInput,
} from "@/lib/reservation-note-sync";

type ReservationInternalNoteRow =
  Database["public"]["Tables"]["reservation_internal_notes"]["Row"];

function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * 예약 캘린더 창에 걸치는 예약의 메모 — **예약 목록을 기다리지 않고** 예약 · 객실 읽기와 동시에 한 번 묻는다(2026-10-19 속도).
 *
 * 전에는 읽어 온 예약 id 를 200개씩 잘라 `.in()` 으로 차례로 물었다(954건 = 5번 직렬, URL 길이 때문에 잘랐다). 이제는
 * 메모 → 예약을 `!inner` 로 붙여 예약 쪽 날짜 조건(캘린더와 같은 창)으로 거른다. 창 조건만 같고 상태 · 건물 제외는
 * 걸지 않으므로, 부르는 쪽이 **화면에 그리는 예약 id 로 다시 거른다**(결과는 전과 같다).
 */
export async function listReservationInternalNotesInWindow(
  session: AppSession,
  window: { checkInBefore: string; checkOutFrom: string },
): Promise<Map<string, ReservationNoteSnapshot>> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await readAllPages<Pick<ReservationInternalNoteRow, "reservation_id" | "note" | "updated_at">>((from, to) =>
    untyped(supabase)
      .from("reservation_internal_notes")
      .select("reservation_id, note, updated_at, reservations!inner(id)")
      .eq("organization_id", session.organization.id)
      .lt("reservations.check_in_date", window.checkInBefore)
      .gte("reservations.check_out_date", window.checkOutFrom)
      .order("reservation_id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    throw new Error(error.message);
  }
  return new Map(data.map((row) => [row.reservation_id, { note: row.note, updatedAt: row.updated_at }]));
}

/** 화면에 그리는 예약만 남긴다 — id → { 메모, updated_at }. 저장할 때 `updatedAt` 을 「내가 본 버전」으로 다시 보낸다. */
export function pickReservationNotes(
  notes: Map<string, ReservationNoteSnapshot>,
  reservationIds: readonly string[],
): Record<string, ReservationNoteSnapshot> {
  const result: Record<string, ReservationNoteSnapshot> = {};
  for (const id of reservationIds) {
    const note = notes.get(id);
    if (note !== undefined) result[id] = note;
  }
  return result;
}

export { RESERVATION_INTERNAL_NOTE_MAX_LENGTH };

export type SaveReservationNoteResult =
  | { ok: true; snapshot: ReservationNoteSnapshot }
  | { ok: false; error: "conflict"; current: ReservationNoteSnapshot }
  | { ok: false; error: Exclude<ReservationNoteErrorCode, "conflict"> };

/**
 * 메모 저장 — 화면이 본 버전일 때만 고친다(2026-11-12 예약 캘린더 점검, 규칙은 `reservation-note-sync.ts`).
 *
 * 쓰기는 사용자 세션(RLS)으로 한다 — DB 규칙이 `admin_web.access` 권한으로 막는다(202611120001). 거절(42501)은 `forbidden`.
 */
export async function saveReservationInternalNote(input: {
  expectedUpdatedAt: string | null;
  note: string;
  reservationId: string;
  session: AppSession;
}): Promise<SaveReservationNoteResult> {
  const { expectedUpdatedAt, reservationId, session } = input;
  const checked = validateNoteInput(input.note);
  if (!checked.ok) return { ok: false, error: checked.error };
  const supabase = untyped(await getSupabaseServerClient());
  const organizationId = session.organization.id;

  // 이 조직의 예약인지 먼저 본다 — 남의 조직 예약 id 에 메모 줄이 생기지 않게(RLS 와 별개로 서버에서 한 번 더).
  const owned = await supabase.from("reservations").select("id").eq("organization_id", organizationId).eq("id", reservationId).maybeSingle();
  if (owned.error) return { ok: false, error: "save_failed" };
  if (!owned.data) return { ok: false, error: "reservation_not_found" };

  const readCurrent = async (): Promise<ReservationNoteSnapshot | null> => {
    const { data, error } = await supabase
      .from("reservation_internal_notes")
      .select("note, updated_at")
      .eq("organization_id", organizationId)
      .eq("reservation_id", reservationId)
      .maybeSingle();
    if (error) return null;
    const row = data as Pick<ReservationInternalNoteRow, "note" | "updated_at"> | null;
    return row ? { note: row.note, updatedAt: row.updated_at } : { note: "", updatedAt: null };
  };
  const conflict = async (): Promise<SaveReservationNoteResult> => {
    const current = await readCurrent();
    if (!current) return { ok: false, error: "save_failed" };
    // update · delete 가 RLS 에 막히면 오류 없이 0줄이다 — 버전이 그대로면 누가 고친 게 아니라 권한이 없는 것.
    if (expectedUpdatedAt !== null && current.updatedAt === expectedUpdatedAt) return { ok: false, error: "forbidden" };
    return { ok: false, error: "conflict", current };
  };
  const failed = (code: string | undefined, step: string): Promise<SaveReservationNoteResult> | SaveReservationNoteResult => {
    const kind = classifyNoteDbError(code);
    console.error(`[reservation-note] ${step} failed`, { code });
    if (kind === "conflict") return conflict();
    return { ok: false, error: kind };
  };

  const plan = planReservationNoteWrite({ note: checked.note, expectedUpdatedAt });
  if (plan === "noop") {
    const current = await readCurrent();
    if (!current) return { ok: false, error: "save_failed" };
    return current.updatedAt === null ? { ok: true, snapshot: current } : { ok: false, error: "conflict", current };
  }

  if (plan === "insert") {
    const payload: Database["public"]["Tables"]["reservation_internal_notes"]["Insert"] = {
      note: checked.note,
      organization_id: organizationId,
      reservation_id: reservationId,
      updated_by_user_id: session.user.id,
    };
    const { data, error } = await supabase.from("reservation_internal_notes").insert(payload).select("note, updated_at").single();
    if (error || !data) return failed(error?.code, "insert");
    const row = data as Pick<ReservationInternalNoteRow, "note" | "updated_at">;
    return { ok: true, snapshot: { note: row.note, updatedAt: row.updated_at } };
  }

  if (plan === "delete") {
    const { data, error } = await supabase
      .from("reservation_internal_notes")
      .delete()
      .eq("organization_id", organizationId)
      .eq("reservation_id", reservationId)
      .eq("updated_at", expectedUpdatedAt as string)
      .select("id");
    if (error) return failed(error.code, "delete");
    // 0줄 = 그사이 누가 고쳤다(또는 이미 지웠다) — 덮어쓰지 않고 최신 값을 돌려준다.
    if (!data || data.length === 0) return conflict();
    return { ok: true, snapshot: { note: "", updatedAt: null } };
  }

  const { data, error } = await supabase
    .from("reservation_internal_notes")
    .update({ note: checked.note, updated_by_user_id: session.user.id })
    .eq("organization_id", organizationId)
    .eq("reservation_id", reservationId)
    .eq("updated_at", expectedUpdatedAt as string)
    .select("note, updated_at")
    .maybeSingle();
  if (error) return failed(error.code, "update");
  if (!data) return conflict();
  const row = data as Pick<ReservationInternalNoteRow, "note" | "updated_at">;
  return { ok: true, snapshot: { note: row.note, updatedAt: row.updated_at } };
}
