import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";

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
): Promise<Map<string, string>> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await readAllPages<Pick<ReservationInternalNoteRow, "reservation_id" | "note">>((from, to) =>
    untyped(supabase)
      .from("reservation_internal_notes")
      .select("reservation_id, note, reservations!inner(id)")
      .eq("organization_id", session.organization.id)
      .lt("reservations.check_in_date", window.checkInBefore)
      .gte("reservations.check_out_date", window.checkOutFrom)
      .order("reservation_id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    throw new Error(error.message);
  }
  return new Map(data.map((row) => [row.reservation_id, row.note]));
}

/** 화면에 그리는 예약만 남긴다 — 예전 `listReservationInternalNotes` 의 결과 모양(id → 메모). */
export function pickReservationNotes(notes: Map<string, string>, reservationIds: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const id of reservationIds) {
    const note = notes.get(id);
    if (note !== undefined) result[id] = note;
  }
  return result;
}

export const RESERVATION_INTERNAL_NOTE_MAX_LENGTH = 2000;

/** 코드가 붙은 오류 — 화면에는 DB 원문 대신 이 코드만 넘긴다. */
export class ReservationInternalNoteError extends Error {
  constructor(readonly code: "note_too_long" | "reservation_not_found" | "save_failed") {
    super(code);
  }
}

export async function saveReservationInternalNote(input: {
  note: string;
  reservationId: string;
  session: AppSession;
}): Promise<string> {
  const { note, reservationId, session } = input;
  const trimmed = String(note ?? "").trim();
  if (trimmed.length > RESERVATION_INTERNAL_NOTE_MAX_LENGTH) throw new ReservationInternalNoteError("note_too_long");
  const supabase = await getSupabaseServerClient();

  // 이 조직의 예약인지 먼저 본다 — 남의 조직 예약 id 에 메모 줄이 생기지 않게(RLS 와 별개로 서버에서 한 번 더).
  const owned = await supabase.from("reservations").select("id").eq("organization_id", session.organization.id).eq("id", reservationId).maybeSingle();
  if (owned.error) throw new ReservationInternalNoteError("save_failed");
  if (!owned.data) throw new ReservationInternalNoteError("reservation_not_found");

  if (!trimmed) {
    const { error } = await untyped(supabase)
      .from("reservation_internal_notes")
      .delete()
      .eq("organization_id", session.organization.id)
      .eq("reservation_id", reservationId);

    if (error) {
      console.error("[reservation-note] delete failed", { code: error.code });
      throw new ReservationInternalNoteError("save_failed");
    }

    return "";
  }

  const payload: Database["public"]["Tables"]["reservation_internal_notes"]["Insert"] = {
    note: trimmed,
    organization_id: session.organization.id,
    reservation_id: reservationId,
    updated_by_user_id: session.user.id,
  };

  const { data, error } = await untyped(supabase)
    .from("reservation_internal_notes")
    .upsert(payload, {
      onConflict: "organization_id,reservation_id",
    })
    .select("note")
    .single();

  if (error || !data) {
    console.error("[reservation-note] save failed", { code: error?.code });
    throw new ReservationInternalNoteError("save_failed");
  }

  return (data as Pick<ReservationInternalNoteRow, "note">).note;
}
