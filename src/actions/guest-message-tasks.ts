"use server";

/**
 * 손님 메시지 → 업무 한 번에(6단계, 2026-11-13) — PC `/admin/messages` · 모바일 `/mobile/messages` 공용(CLAUDE.md `src/actions`).
 * docs/product/47-guest-messaging.md §6-4 · §5-7
 *
 * - 권한: 대화를 읽어야 하니 `guest_messages.view`, 그리고 **그 업무의 기존 권한 그대로**(`creatableKinds` — 수리 · 분실물 · 할 일 =
 *   조직 구성원, 게스트 피드백 = `complaint.write`). 새 권한 키는 없다. 거부는 redirect 없이 `forbidden`.
 * - 저장은 각 기능의 공용 만들기 함수를 그대로 부른다(`createMaintenanceRecord` · `createLostItemRecord` · `createTaskRecord` ·
 *   `createComplaint`) — 검사 · 권한 · 사진 규칙 · RLS 를 우회하지 않는다.
 * - 건물 · 방 · 예약 · 손님 이름은 **서버가 대화에서** 다시 읽는다(화면이 보낸 id 를 믿지 않는다). 수리 · 분실물은 직원이 고른 건물 · 방
 *   (활성 방 카탈로그로 다시 검사)이 예약의 자리와 같을 때만 예약을 잇는다.
 * - 손님 사진은 복사하지 않는다 — 1단계부터 첨부는 정보만 저장한다(파일은 Beds24 에). 화면이 「사진은 Beds24 에 있어요」로 알린다.
 * - 만든 뒤 `guest_message_links` 에 한 줄(service_role, 조직 필터). 링크만 실패하면 업무는 남기고 `linkFailed`.
 */

import { revalidatePath } from "next/cache";
import { createComplaint } from "@/lib/complaints";
import { loadConversationRow } from "@/lib/guest-messages/inbox-server";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import {
  canCreateKind,
  complaintPlatformFor,
  creatableKinds,
  isLinkTargetType,
  isStayingNow,
  linkTargetHref,
  type LinkTargetType,
} from "@/lib/guest-messages/task-link-model";
import { findConversationForTarget, insertGuestMessageLink, isOwnFreshTarget } from "@/lib/guest-messages/task-link-server";
import type { GuestChannelKey } from "@/lib/guest-messages/types";
import { createLostItemRecord } from "@/lib/lost-item-create";
import { createMaintenanceRecord } from "@/lib/maintenance-create";
import { getCanonicalPropertyName, getCanonicalRoomLabel, getDisplayRoomLabel } from "@/lib/room-label-normalization";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createTaskRecord } from "@/lib/task-create";
import { tokyoToday } from "@/lib/tokyo-date";

type Failure = { ok: false; errorKey: TaskFromMessageErrorKey };

export type TaskFromMessageErrorKey =
  | "forbidden"
  | "invalid"
  | "not_found"
  | "missing_title"
  | "missing_building"
  | "invalid_room"
  /** 같은 요청 id 로 돌아온 업무가 이 사람이 방금 만든 것이 아니거나, 다른 대화에 이미 붙어 있다. */
  | "conflict"
  | "failed";

export type TaskPlaceOption = { propertyName: string; rooms: string[] };

export type TaskFormContext = {
  kinds: LinkTargetType[];
  /** 활성 방 카탈로그(건물 → 표시 방 라벨). 정본 이름 — 그릴 때 localize. */
  places: TaskPlaceOption[];
  /** 대화(예약)의 자리 — 카탈로그에 있을 때만. */
  place: { propertyName: string; roomLabel: string | null } | null;
  /** 숙박 중인 손님(도쿄) — 수리 · 점검 「급함」 처음 값. */
  stayingNow: boolean;
};

export type TaskFormContextResult = ({ ok: true } & TaskFormContext) | Failure;

async function sessionGate(): Promise<{ ok: true; session: AppSession } | Failure> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  if (!session.capabilities.includes("guest_messages.view")) return { ok: false, errorKey: "forbidden" };
  return { ok: true, session };
}

function db() {
  return getSupabaseServiceClient();
}

type ConversationPlace = {
  id: string;
  reservationId: string | null;
  propertyId: string | null;
  roomId: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  guestName: string | null;
  channel: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
};

async function loadConversationPlace(organizationId: string, conversationId: string): Promise<ConversationPlace | null> {
  const row = await loadConversationRow(db(), organizationId, conversationId);
  if (!row) return null;
  // 건물 · 방 id(할 일 · 피드백의 연결 칸)는 목록 칸에 없어 따로 읽는다 — 이 조직의 대화만.
  const ids = await db()
    .from("guest_conversations")
    .select("property_id, room_id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  const extra = (ids.data ?? null) as { property_id: string | null; room_id: string | null } | null;
  return {
    id: row.id,
    reservationId: row.reservation_id,
    propertyId: extra?.property_id ?? null,
    roomId: extra?.room_id ?? null,
    propertyName: row.property_name,
    roomLabel: row.room_label,
    guestName: row.guest_name,
    channel: row.channel,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
  };
}

/** 예약(있으면) → 대화 순으로 정본 건물 · 표시 방 라벨. 수리 · 분실물 만들기가 예약과 비교하는 값과 같은 꼴. */
async function placeOf(organizationId: string, conversation: ConversationPlace): Promise<{ propertyName: string; roomLabel: string | null } | null> {
  let propertyName = conversation.propertyName;
  let roomLabel = conversation.roomLabel;
  if (conversation.reservationId) {
    const { data } = await db()
      .from("reservations")
      .select("property_name, room_label")
      .eq("organization_id", organizationId)
      .eq("id", conversation.reservationId)
      .maybeSingle();
    const reservation = data as { property_name: string; room_label: string } | null;
    if (reservation) {
      propertyName = reservation.property_name;
      roomLabel = reservation.room_label;
    }
  }
  if (!propertyName?.trim()) return null;
  const canonicalProperty = getCanonicalPropertyName(propertyName.trim());
  if (!roomLabel?.trim()) return { propertyName: canonicalProperty, roomLabel: null };
  const canonicalRoom = getCanonicalRoomLabel(canonicalProperty, roomLabel) ?? roomLabel.trim();
  return { propertyName: canonicalProperty, roomLabel: getDisplayRoomLabel(canonicalProperty, canonicalRoom) };
}

function groupCatalog(catalog: Array<{ propertyName: string; displayRoomLabel: string }>): TaskPlaceOption[] {
  const byProperty = new Map<string, Set<string>>();
  for (const item of catalog) {
    const set = byProperty.get(item.propertyName) ?? new Set<string>();
    set.add(item.displayRoomLabel);
    byProperty.set(item.propertyName, set);
  }
  return [...byProperty.entries()].map(([propertyName, rooms]) => ({
    propertyName,
    rooms: [...rooms].sort((a, b) => a.localeCompare(b, "ja", { numeric: true })),
  }));
}

/** 만들기 칸을 열 때 — 종류(권한) · 방 카탈로그 · 대화의 자리. */
export async function getTaskFormContext(conversationId: string): Promise<TaskFormContextResult> {
  const auth = await sessionGate();
  if (!auth.ok) return auth;
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) return { ok: false, errorKey: "invalid" };
  const organizationId = auth.session.organization.id;
  try {
    const conversation = await loadConversationPlace(organizationId, conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    const [place, catalog] = await Promise.all([
      placeOf(organizationId, conversation),
      getActiveRoomCatalogServer(organizationId).catch(() => undefined),
    ]);
    const places = groupCatalog(catalog ?? []);
    const known = place ? places.find((p) => p.propertyName === place.propertyName) : undefined;
    return {
      ok: true,
      kinds: creatableKinds(auth.session.capabilities),
      places,
      place: known && place ? { propertyName: place.propertyName, roomLabel: place.roomLabel && known.rooms.includes(place.roomLabel) ? place.roomLabel : null } : null,
      stayingNow: isStayingNow(conversation.checkInDate, conversation.checkOutDate, tokyoToday()),
    };
  } catch (error) {
    console.error("[guest-messages] task form context failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export type CreateTaskFromMessageInput = {
  conversationId: string;
  kind: LinkTargetType;
  /** 고른 손님 말(이 대화의 손님 말만 받는다). 첫 말이 링크의 `message_id`. */
  messageIds: string[];
  title: string;
  body: string;
  /** 수리 · 점검 · 할 일 「급함」. */
  urgent: boolean;
  /** 수리 · 점검 분류 · 분실물 분류(모르는 값 = 그 기능의 기본값). */
  category: string;
  /** 수리 · 분실물 자리(정본 건물 · 표시 방). 수리는 `buildingOnly` 가능. */
  propertyName: string | null;
  roomLabel: string | null;
  buildingOnly: boolean;
  /** 만들기 한 번당 화면이 만든 uuid — 수리 · 분실물 · 피드백은 같은 값으로 다시 와도 한 건. */
  submissionId: string;
};

export type CreateTaskFromMessageResult =
  | {
      ok: true;
      kind: LinkTargetType;
      targetId: string;
      adminHref: string;
      mobileHref: string;
      /** 업무는 만들었지만 대화에 잇지 못했다(드묾 — 화면이 알린다). */
      linkFailed: boolean;
    }
  | Failure;

const MAX_MESSAGES = 20;

const TARGET_LIST_PATHS: Record<LinkTargetType, string[]> = {
  maintenance: ["/mobile/requests", "/admin/maintenance"],
  lost_found: ["/mobile/requests", "/admin/lost-found"],
  task: ["/mobile/tasks"],
  complaint: ["/mobile/complaints", "/admin/complaints"],
};

function complaintError(error: unknown): TaskFromMessageErrorKey {
  const message = error instanceof Error ? error.message : "";
  if (message === "forbidden" || message === "no_org") return "forbidden";
  if (message === "title_required") return "missing_title";
  if (message === "invalid_link" || message === "invalid_platform" || message === "invalid_submission") return "invalid";
  return "failed";
}

export async function createTaskFromGuestMessage(input: CreateTaskFromMessageInput): Promise<CreateTaskFromMessageResult> {
  const auth = await sessionGate();
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!input || typeof input !== "object") return { ok: false, errorKey: "invalid" };
  if (!isLinkTargetType(input.kind)) return { ok: false, errorKey: "invalid" };
  // 그 업무의 기존 권한 — 화면 숨김만으로 막지 않는다(CLAUDE.md 6).
  if (!canCreateKind(session.capabilities, input.kind)) return { ok: false, errorKey: "forbidden" };
  if (typeof input.conversationId !== "string" || !UUID_RE.test(input.conversationId)) return { ok: false, errorKey: "invalid" };
  if (typeof input.submissionId !== "string" || !UUID_RE.test(input.submissionId)) return { ok: false, errorKey: "invalid" };
  const messageIds = Array.isArray(input.messageIds) ? [...new Set(input.messageIds)] : [];
  if (messageIds.length > MAX_MESSAGES || messageIds.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
    return { ok: false, errorKey: "invalid" };
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title) return { ok: false, errorKey: "missing_title" };
  const organizationId = session.organization.id;

  let conversation: ConversationPlace | null = null;
  let firstMessageId: string | null = null;
  try {
    conversation = await loadConversationPlace(organizationId, input.conversationId);
    if (!conversation) return { ok: false, errorKey: "not_found" };
    if (messageIds.length > 0) {
      const { data, error } = await db()
        .from("guest_messages")
        .select("id, direction, sent_at")
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversation.id)
        .in("id", messageIds);
      if (error) return { ok: false, errorKey: "failed" };
      const rows = (data ?? []) as Array<{ id: string; direction: string; sent_at: string }>;
      // 이 대화의 손님 말만 — 다른 대화 · 다른 조직 · 우리 답장 id 가 섞이면 거절한다.
      if (rows.length !== messageIds.length || rows.some((row) => row.direction !== "guest")) return { ok: false, errorKey: "invalid" };
      firstMessageId = [...rows].sort((a, b) => a.sent_at.localeCompare(b.sent_at))[0]?.id ?? null;
    }
  } catch (error) {
    console.error("[guest-messages] task from message read failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
  if (!conversation) return { ok: false, errorKey: "not_found" };

  // 정본 건물 · 표시 방 라벨(예약 → 대화). 수리 · 분실물의 예약 비교와 게스트 피드백 저장이 같은 값을 쓴다 —
  // 대화의 칸은 예약 원문(「201_2」 등)이라 그대로 저장하면 피드백 폼이 만든 줄과 꼴이 달라진다.
  const place = await placeOf(organizationId, conversation).catch(() => null);

  let targetId: string;
  if (input.kind === "maintenance" || input.kind === "lost_found") {
    const chosenProperty = typeof input.propertyName === "string" ? input.propertyName.trim() : "";
    const chosenRoom = typeof input.roomLabel === "string" ? input.roomLabel.trim() : "";
    const buildingOnly = input.kind === "maintenance" && input.buildingOnly === true;
    // 예약은 직원이 고른 자리가 예약의 자리와 같을 때만 잇는다(다르면 기능의 검사가 저장을 막으므로 잇지 않고 만든다).
    const reservationId =
      conversation.reservationId && place && !buildingOnly && place.propertyName === chosenProperty && place.roomLabel === chosenRoom
        ? conversation.reservationId
        : null;
    if (input.kind === "maintenance") {
      const result = await createMaintenanceRecord(session, {
        id: input.submissionId,
        propertyName: chosenProperty || null,
        roomLabel: chosenRoom,
        isBuildingOnly: buildingOnly,
        issueTitle: title,
        description: body,
        category: typeof input.category === "string" ? input.category : "other",
        priority: input.urgent ? "urgent" : "normal",
        imageUrls: [],
        reservationId,
      });
      if (!result.ok) return { ok: false, errorKey: mapRequestError(result.error) };
      targetId = result.id;
    } else {
      const result = await createLostItemRecord(session, {
        id: input.submissionId,
        propertyName: chosenProperty,
        roomLabel: chosenRoom,
        itemName: title,
        category: typeof input.category === "string" ? input.category : "other",
        memo: body,
        imageUrls: [],
        reservationId,
      });
      if (!result.ok) return { ok: false, errorKey: mapRequestError(result.error) };
      targetId = result.id;
    }
  } else if (input.kind === "task") {
    const result = await createTaskRecord(session, {
      // 같은 만들기를 다시 보내도 한 건(응답을 못 받고 다시 누름) — 수리 · 분실물 · 피드백과 같은 요청 id.
      id: input.submissionId,
      title,
      description: body,
      scheduledDate: "",
      dueDate: "",
      time: "",
      durationMinutes: "",
      priority: input.urgent ? "urgent" : "normal",
      repeat: "",
      tags: [],
      shareUserIds: [],
      directive: false,
      imageUrls: [],
      ctxPropertyId: conversation.propertyId,
      ctxRoomId: conversation.roomId,
      ctxReservationId: conversation.reservationId,
      ctxGuestName: conversation.guestName,
      projectId: null,
      sectionId: null,
    });
    if (!result.ok) return { ok: false, errorKey: result.error === "forbidden" ? "forbidden" : result.error === "missing_title" ? "missing_title" : "failed" };
    targetId = result.id;
  } else {
    try {
      const created = await createComplaint({
        session,
        input: {
          platform: complaintPlatformFor((conversation.channel as GuestChannelKey | null) ?? null),
          title,
          description: body || null,
          rating: null,
          propertyId: conversation.propertyId,
          propertyName: place?.propertyName ?? conversation.propertyName,
          roomId: conversation.roomId,
          roomLabel: place ? place.roomLabel : conversation.roomLabel,
          reservationId: conversation.reservationId,
          guestName: conversation.guestName,
          imageUrls: [],
          submissionId: input.submissionId,
        },
      });
      targetId = created.id;
    } catch (error) {
      return { ok: false, errorKey: complaintError(error) };
    }
  }

  // 만들기 함수는 같은 요청 id 면 이미 있는 줄을 돌려준다 — 그 줄이 이 사람이 방금 만든 것일 때만 대화에 잇는다.
  const own = await isOwnFreshTarget(db(), { organizationId, targetType: input.kind, targetId, userId: session.user.id }).catch(() => false);
  if (!own) return { ok: false, errorKey: "conflict" };

  const link = await insertGuestMessageLink(db(), {
    organizationId,
    conversationId: conversation.id,
    messageId: firstMessageId,
    targetType: input.kind,
    targetId,
    createdBy: session.user.id,
  }).catch(() => ({ ok: false as const, error: "failed" as const }));
  if (!link.ok) console.error("[guest-messages] link insert failed", link.error);

  revalidatePath("/admin/messages");
  revalidatePath("/mobile/messages");
  // 만든 업무가 그 기능 목록에도 바로 보이게.
  for (const path of TARGET_LIST_PATHS[input.kind]) revalidatePath(path);
  return {
    ok: true,
    kind: input.kind,
    targetId,
    adminHref: linkTargetHref(input.kind, targetId, "admin"),
    mobileHref: linkTargetHref(input.kind, targetId, "mobile"),
    linkFailed: !link.ok,
  };
}

function mapRequestError(error: string): TaskFromMessageErrorKey {
  if (error === "missing_issue_title" || error === "missing_item_name") return "missing_title";
  if (error === "missing_building") return "missing_building";
  if (error === "invalid_room") return "invalid_room";
  return "failed";
}

export type GuestMessageBackLinkResult = { ok: true; conversationId: string; guestName: string | null } | { ok: false };

/** 업무 상세의 「손님 메시지에서」 — 메시지함을 볼 수 있는 사람에게만 대화를 알려 준다. */
export async function getGuestMessageLinkForTarget(targetType: string, targetId: string): Promise<GuestMessageBackLinkResult> {
  const auth = await sessionGate();
  if (!auth.ok) return { ok: false };
  if (!isLinkTargetType(targetType) || typeof targetId !== "string" || !UUID_RE.test(targetId)) return { ok: false };
  try {
    const found = await findConversationForTarget(db(), auth.session.organization.id, targetType, targetId);
    return found ? { ok: true, ...found } : { ok: false };
  } catch {
    return { ok: false };
  }
}
