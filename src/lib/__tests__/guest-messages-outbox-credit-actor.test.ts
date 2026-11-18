import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveOutboxCreditActor } from "@/lib/guest-messages/outbox-runner";

const reply = (createdBy: string | null) => ({ kind: "reply" as const, created_by: createdBy });

function client(profiles: () => unknown) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: profiles }) }) }) } as never;
}

describe("resolveOutboxCreditActor — 발송 크레딧 기록의 「누가」", () => {
  it("보낸 사람이 한 명이면 그 사람", async () => {
    const actor = await resolveOutboxCreditActor(client(async () => ({ data: { name: "김" }, error: null })), [reply("u1"), reply("u1")]);
    expect(actor).toEqual({ kind: "user", userId: "u1", name: "김" });
  });

  it("여럿이거나 자동 안내면 자동", async () => {
    expect(await resolveOutboxCreditActor(client(async () => ({ data: null })), [reply("u1"), reply("u2")])).toEqual({
      kind: "auto",
      job: "guest_messages_outbox",
    });
  });

  it("이름 읽기가 실패해도 던지지 않고 자동으로 — 잡은 줄이 sending 에 멈추지 않게", async () => {
    const actor = await resolveOutboxCreditActor(
      client(() => {
        throw new Error("network");
      }),
      [reply("u1")],
    );
    expect(actor).toEqual({ kind: "auto", job: "guest_messages_outbox" });
  });
});
