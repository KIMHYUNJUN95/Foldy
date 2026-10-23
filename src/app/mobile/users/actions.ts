"use server";

import { revalidatePath } from "next/cache";
import { createInviteCodeAs, deleteInviteCodeAs, setInviteCodeActiveAs, type InviteResult } from "@/lib/invite-codes-server";
import { getCurrentAppSession } from "@/lib/session";

/**
 * 모바일 사용자 관리 — 초대코드 액션(2026-10-20). 본체는 대시보드와 같은 `src/lib/invite-codes-server.ts` 이고, 여기는 결과를
 * 화면에 그대로 돌려준다(대시보드 폼 액션은 주소로 넘긴다). 멤버 역할 · 상태 · 권한 액션은 `src/actions/users.ts` 를 그대로 쓴다.
 */

async function actor() {
  const session = await getCurrentAppSession();
  if (!session) return null;
  return { userId: session.user.id, role: session.user.role };
}

function refresh() {
  revalidatePath("/mobile/users");
  revalidatePath("/mobile/users/invites");
  revalidatePath("/admin/users/invites");
}

export async function createMobileInviteCode(input: {
  organizationId: string;
  defaultRole: string;
  code?: string;
  name?: string;
  expiresAt?: string;
  maxUses?: string;
}): Promise<InviteResult> {
  const who = await actor();
  if (!who) return { ok: false, error: "forbidden" };
  const result = await createInviteCodeAs(who, input);
  if (result.ok) refresh();
  return result;
}

export async function setMobileInviteActive(input: { inviteCodeId: string; organizationId: string; active: boolean }): Promise<InviteResult> {
  const who = await actor();
  if (!who) return { ok: false, error: "forbidden" };
  const result = await setInviteCodeActiveAs(who, input);
  if (result.ok) refresh();
  return result;
}

export async function deleteMobileInviteCode(input: { inviteCodeId: string; organizationId: string }): Promise<InviteResult> {
  const who = await actor();
  if (!who) return { ok: false, error: "forbidden" };
  const result = await deleteInviteCodeAs(who, input);
  if (result.ok) refresh();
  return result;
}
