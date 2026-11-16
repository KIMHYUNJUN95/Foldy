import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPrivateTopicHub } from "@/lib/live-private-topic";
import {
  LIVE_BROADCAST_EVENT,
  guestInboxLiveSources,
  guestLiveTopic,
  guestThreadLiveSources,
  liveChangeFromBroadcast,
  liveChangeMatches,
  taskLiveSources,
  type LiveChange,
  type LiveSource,
} from "@/lib/live-sources";

/** 손님 메시지 실시간 — private broadcast (2026-11-16, 47 §5-9). 트리거가 id 칸만 보내고 브라우저가 거른다. */
const ORG = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C2 = "aaaaaaaa-0000-4000-8000-000000000002";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/202611160001_guest_messages_realtime_private.sql"), "utf8");

const change = (table: string, eventType: "INSERT" | "UPDATE", record: Record<string, string>): LiveChange => ({ table, eventType, record });
const matchesAny = (sources: LiveSource[], c: LiveChange) => sources.some((s) => liveChangeMatches(s, c));

describe("broadcast 신호 → LiveChange", () => {
  it("id 칸만 남긴다 — 무엇이 실려 와도 본문 · 이름은 버린다", () => {
    expect(
      liveChangeFromBroadcast({ table: "guest_messages", eventType: "INSERT", id: C2, conversation_id: C1, organization_id: ORG, body: "door 1234", guest_name: "Kim" }),
    ).toEqual({ table: "guest_messages", eventType: "INSERT", record: { id: C2, conversation_id: C1, organization_id: ORG } });
  });

  it("모르는 모양은 버린다", () => {
    expect(liveChangeFromBroadcast(null)).toBeNull();
    expect(liveChangeFromBroadcast("x")).toBeNull();
    expect(liveChangeFromBroadcast({ table: "guest_messages", eventType: "DELETE", id: C1 })).toBeNull();
    expect(liveChangeFromBroadcast({ eventType: "INSERT", id: C1 })).toBeNull();
  });
});

describe("브라우저 거르기 — 예전 postgres_changes 필터와 같게", () => {
  const inbox = guestInboxLiveSources(ORG);
  const thread = guestThreadLiveSources(ORG, C1);

  it("목록은 메시지 INSERT 만 받는다(사진 사본 UPDATE 홍수는 거른다)", () => {
    const base = { id: C2, conversation_id: C1, organization_id: ORG };
    expect(matchesAny(inbox, change("guest_messages", "INSERT", base))).toBe(true);
    expect(matchesAny(inbox, change("guest_messages", "UPDATE", base))).toBe(false);
    expect(matchesAny(inbox, change("guest_conversations", "UPDATE", { id: C1, organization_id: ORG }))).toBe(true);
    expect(matchesAny(inbox, change("auto_message_runs", "UPDATE", { id: C2, organization_id: ORG }))).toBe(false);
  });

  it("대화는 그 대화 것만 — 다른 대화 메시지 · 대화 줄은 거른다, 실행 줄은 조직 전체", () => {
    expect(matchesAny(thread, change("guest_messages", "UPDATE", { id: C2, conversation_id: C1, organization_id: ORG }))).toBe(true);
    expect(matchesAny(thread, change("guest_messages", "INSERT", { id: C2, conversation_id: C2, organization_id: ORG }))).toBe(false);
    expect(matchesAny(thread, change("guest_conversations", "UPDATE", { id: C2, organization_id: ORG }))).toBe(false);
    expect(matchesAny(thread, change("guest_conversations", "UPDATE", { id: C1, organization_id: ORG }))).toBe(true);
    expect(matchesAny(thread, change("auto_message_runs", "INSERT", { id: C2, organization_id: ORG, provider_booking_id: "70001" }))).toBe(true);
  });

  it("다른 조직 · 칸 없음 · 모르는 필터는 받지 않는다, uuid 대소문자는 가리지 않는다", () => {
    expect(matchesAny(inbox, change("guest_conversations", "UPDATE", { id: C1, organization_id: OTHER }))).toBe(false);
    expect(matchesAny(inbox, change("guest_conversations", "UPDATE", { id: C1 }))).toBe(false);
    expect(liveChangeMatches({ table: "guest_messages", filter: "conversation_id=in.(x)" }, change("guest_messages", "INSERT", { conversation_id: "x" }))).toBe(false);
    expect(matchesAny(inbox, change("guest_conversations", "UPDATE", { id: C1, organization_id: ORG.toUpperCase() }))).toBe(true);
  });

  it("다른 기능 구독은 그대로 postgres_changes(토픽 없음)", () => {
    expect(taskLiveSources(ORG, C1).every((s) => s.topic === undefined)).toBe(true);
  });
});

describe("토픽 · SQL 계약", () => {
  it("토픽 · 이벤트 이름이 트리거 · 정책과 같다", () => {
    expect(guestLiveTopic(ORG)).toBe(`guest-messages:${ORG}`);
    expect(sql).toContain(`'${LIVE_BROADCAST_EVENT}',`);
    expect(sql).toContain("'guest-messages:' || new.organization_id::text");
    expect(sql).toContain("'guest-messages:' || m.organization_id::text = (select realtime.topic())");
    expect(sql).toContain("like 'guest-messages:%'");
  });

  it("받기만 연다 — 브라우저 보내기 정책 없음, 권한은 guest_messages.view", () => {
    expect(sql).toMatch(/for select\s+to authenticated/);
    expect(sql).not.toMatch(/for (insert|all|update|delete)\b/i);
    expect(sql).toContain("public.has_capability(m.organization_id, (select auth.uid()), 'guest_messages.view')");
  });

  it("네 표를 publication 에서 빼고, 트리거는 본문 · 이름 칸을 싣지 않는다", () => {
    expect(sql).toContain("alter publication supabase_realtime drop table");
    for (const t of ["guest_conversations", "guest_messages", "guest_message_outbox", "auto_message_runs"]) expect(sql).toContain(`'${t}'`);
    const fn = sql.slice(sql.indexOf("create or replace function public.guest_messages_live_signal"), sql.indexOf("comment on function"));
    expect(fn).not.toMatch(/new\.(body|guest_name|attachments|last_error|body_translated)/);
    expect(fn).toContain("exception when others");
    expect(sql).toContain("revoke execute on function public.guest_messages_live_signal() from public, anon, authenticated");
  });

  it("UPDATE 신호는 updated_at 말고 바뀐 칸이 있을 때만, 칸 읽기도 예외 처리 안", () => {
    // set_updated_at() 이 매번 updated_at 을 바꾸므로 old.* 통째 비교로는 같은 값 다시 쓰기를 못 거른다.
    expect(sql).toContain("when ((to_jsonb(old) - ''updated_at'') is distinct from (to_jsonb(new) - ''updated_at''))");
    expect(sql).not.toContain("old.* is distinct from new.*");
    const fn = sql.slice(sql.indexOf("create or replace function public.guest_messages_live_signal"), sql.indexOf("comment on function"));
    const guarded = fn.slice(fn.indexOf("  begin\n"));
    expect(guarded.indexOf("jsonb_build_object(")).toBeGreaterThan(-1);
    expect(guarded.indexOf("jsonb_build_object(")).toBeLessThan(guarded.indexOf("exception when others"));
  });
});

describe("private 토픽 허브 — 같은 토픽은 채널 하나", () => {
  function fakeTransport() {
    const opened: Array<{ topic: string; send: (p: unknown) => void; status: (s: string) => void; closed: boolean }> = [];
    let resolveClose: (() => void) | null = null;
    const transport = {
      open: vi.fn((topic: string, onMessage: (p: unknown) => void, onStatus: (s: string) => void) => {
        const ch = { topic, send: onMessage, status: onStatus, closed: false };
        opened.push(ch);
        return ch;
      }),
      close: vi.fn((ch: (typeof opened)[number]) => {
        ch.closed = true;
        return new Promise<void>((resolve) => (resolveClose = resolve));
      }),
    };
    return { transport, opened, finishClose: () => resolveClose?.() };
  }

  it("두 곳이 들으면 한 번 열고 둘 다 받는다, 마지막이 떠날 때만 닫는다", () => {
    const { transport, opened } = fakeTransport();
    const hub = createPrivateTopicHub(transport);
    const a = vi.fn();
    const b = vi.fn();
    const leaveA = hub.join("guest-messages:x", { onMessage: a });
    const leaveB = hub.join("guest-messages:x", { onMessage: b });
    expect(transport.open).toHaveBeenCalledTimes(1);
    opened[0].send({ n: 1 });
    expect(a).toHaveBeenCalledWith({ n: 1 });
    expect(b).toHaveBeenCalledWith({ n: 1 });
    leaveA();
    expect(transport.close).not.toHaveBeenCalled();
    opened[0].send({ n: 2 });
    expect(a).toHaveBeenCalledTimes(1);
    leaveB();
    leaveB();
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(hub.size()).toBe(0);
  });

  it("늦게 들어온 곳에 지금 상태를 다시 알려 준다", () => {
    const { transport, opened } = fakeTransport();
    const hub = createPrivateTopicHub(transport);
    hub.join("t", { onMessage: () => undefined });
    opened[0].status("SUBSCRIBED");
    const status = vi.fn();
    hub.join("t", { onMessage: () => undefined, onStatus: status });
    expect(status).toHaveBeenCalledWith("SUBSCRIBED");
  });

  it("닫히는 중에 다시 들어오면 닫힘이 끝난 뒤 새로 연다", async () => {
    const { transport, opened, finishClose } = fakeTransport();
    const hub = createPrivateTopicHub(transport);
    hub.join("t", { onMessage: () => undefined })();
    const got = vi.fn();
    hub.join("t", { onMessage: got });
    expect(transport.open).toHaveBeenCalledTimes(1);
    finishClose();
    await new Promise((r) => setTimeout(r, 0));
    expect(transport.open).toHaveBeenCalledTimes(2);
    opened[1].send("hi");
    expect(got).toHaveBeenCalledWith("hi");
  });

  it("닫힘을 기다리는 사이 떠나면 열지 않는다", async () => {
    const { transport, finishClose } = fakeTransport();
    const hub = createPrivateTopicHub(transport);
    hub.join("t", { onMessage: () => undefined })();
    const leave = hub.join("t", { onMessage: () => undefined });
    leave();
    finishClose();
    await new Promise((r) => setTimeout(r, 0));
    expect(transport.open).toHaveBeenCalledTimes(1);
  });
});
