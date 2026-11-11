import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { INVITE_ERROR_KEYS, resolveInviteRpcError } from "../invite-errors";

const KNOWN_INVITE_KEYS = ["missing_invite", "invalid_invite", "membership_blocked"] as const;

describe("resolveInviteRpcError — RPC error key mapping", () => {
  it.each(KNOWN_INVITE_KEYS)("passes known key %s through unchanged", (key) => {
    expect(resolveInviteRpcError(key)).toBe(key);
  });

  // 2026-11-11: 만료 · 꺼짐 · 다 씀을 따로 보여 주면 「이 코드는 있다」를 맞혀 볼 수 있다 — 미리보기와 같은 한 오류로.
  it.each(["invite_expired", "invite_inactive", "invite_maxed"])("hides why code %s failed → invalid_invite", (key) => {
    expect(resolveInviteRpcError(key)).toBe("invalid_invite");
  });

  it.each(["forbidden", "missing_user", "internal_error", "unknown", ""])(
    "maps unknown key %s → invite_join_failed",
    (key) => {
      expect(resolveInviteRpcError(key)).toBe("invite_join_failed");
    },
  );

  it("forbidden is not a passthrough key (must not expose DB internals)", () => {
    expect(INVITE_ERROR_KEYS.has("forbidden")).toBe(false);
  });
});

describe("onboarding/actions.ts — static structure regression", () => {
  const actionsContent = readFileSync(
    resolve(process.cwd(), "src/app/onboarding/actions.ts"),
    "utf-8",
  );

  it("uses the atomic RPC for invite join", () => {
    expect(actionsContent).toContain("join_organization_with_invite_code");
  });

  it("does not manually increment invite used_count", () => {
    expect(actionsContent).not.toMatch(/used_count.*\+.*1/);
    expect(actionsContent).not.toMatch(/\.update\(\s*\{[^}]*used_count/);
  });

  it("does not directly upsert memberships in the invite join flow", () => {
    expect(actionsContent).not.toMatch(/from\("memberships"\)\.upsert/);
  });

  it("delegates error key resolution to resolveInviteRpcError", () => {
    expect(actionsContent).toContain("resolveInviteRpcError");
  });
});
