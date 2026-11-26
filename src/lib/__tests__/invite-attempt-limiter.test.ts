import { beforeEach, describe, expect, it } from "vitest";
import { INVITE_CODE_MIN_LENGTH, generateInviteCode } from "@/lib/invite-code-gen";
import {
  INVITE_ATTEMPT_LIMIT,
  INVITE_ATTEMPT_WINDOW_MS,
  resetInviteAttempts,
  takeInviteAttempt,
} from "@/lib/invite-attempt-limiter";

beforeEach(() => resetInviteAttempts());

describe("초대 코드 시도 제한", () => {
  it("10분 10번까지, 그 뒤는 막는다", () => {
    for (let i = 0; i < INVITE_ATTEMPT_LIMIT; i += 1) expect(takeInviteAttempt("u1", 1000)).toBe(true);
    expect(takeInviteAttempt("u1", 2000)).toBe(false);
  });
  it("사용자마다 따로 센다", () => {
    for (let i = 0; i < INVITE_ATTEMPT_LIMIT; i += 1) takeInviteAttempt("u1", 1000);
    expect(takeInviteAttempt("u2", 1000)).toBe(true);
  });
  it("창이 지나면 다시 열린다", () => {
    for (let i = 0; i < INVITE_ATTEMPT_LIMIT; i += 1) takeInviteAttempt("u1", 1000);
    expect(takeInviteAttempt("u1", 1000 + INVITE_ATTEMPT_WINDOW_MS)).toBe(true);
  });
});

describe("초대 코드 최소 길이", () => {
  it("만들 수 있는 코드는 모두 최소 길이 이상", () => {
    for (const source of ["", "a", "haru", "arakicho-long-name"]) {
      expect(generateInviteCode(source).length).toBeGreaterThanOrEqual(INVITE_CODE_MIN_LENGTH);
    }
  });
});
