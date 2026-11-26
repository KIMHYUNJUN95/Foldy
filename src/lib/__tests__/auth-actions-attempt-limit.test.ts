import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// 로그인 · 가입 · 다시 보내기 · 재설정 액션이 Supabase Auth 를 부르기 전에 시도 제한을 거치는지(2026-11-26).
const takeAuthAttempt = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/lib/auth-attempt-limit", async (importOriginal) => ({
  clientIpFromHeaders: (await importOriginal<typeof import("@/lib/auth-attempt-limit")>()).clientIpFromHeaders,
  takeAuthAttempt: (...args: unknown[]) => takeAuthAttempt(...args),
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));

const auth = {
  signInWithPassword: vi.fn(async () => ({ error: { message: "Invalid login credentials" } })),
  signUp: vi.fn(async () => ({ data: { user: null }, error: null })),
  resend: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
};
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => ({ auth }) }));

const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", host: "app.example" });
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/mobile-device", () => ({ getDeviceSurfaceFromHeaders: () => "desktop" }));
vi.mock("@/lib/onboarding", () => ({ getOnboardingState: vi.fn() }));
vi.mock("@/lib/attendance-trusted-device", () => ({ forgetTrustedDevice: vi.fn() }));

import {
  requestPasswordReset,
  resendSignupConfirmation,
  signInWithEmailPassword,
  signUpWithEmail,
} from "@/app/auth/actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return (error as Error).message.replace(/^redirect:/, "");
  }
  throw new Error("expected a redirect");
}

const cases = [
  {
    name: "sign-in",
    action: "sign_in",
    run: () => signInWithEmailPassword(form({ email: "Staff@Example.com", password: "x" })),
    called: () => auth.signInWithPassword,
  },
  {
    name: "sign-up",
    action: "sign_up",
    run: () => signUpWithEmail(form({ email: "Staff@Example.com", password: "Harbor-river-2741" })),
    called: () => auth.signUp,
  },
  {
    name: "resend",
    action: "resend_signup",
    run: () => resendSignupConfirmation(form({ email: "Staff@Example.com" })),
    called: () => auth.resend,
  },
  {
    name: "reset",
    action: "password_reset",
    run: () => requestPasswordReset(form({ email: "Staff@Example.com" })),
    called: () => auth.resetPasswordForEmail,
  },
] as const;

beforeEach(() => {
  takeAuthAttempt.mockReset();
  takeAuthAttempt.mockResolvedValue(true);
  Object.values(auth).forEach((fn) => fn.mockClear());
});

describe.each(cases)("$name", ({ action, run, called }) => {
  it("records the attempt with the normalised email and the first forwarded IP", async () => {
    await redirectOf(run);
    expect(takeAuthAttempt).toHaveBeenCalledWith(action, { email: "staff@example.com", ip: "203.0.113.7" });
    expect(called()).toHaveBeenCalledTimes(1);
  });

  it("stops before Supabase and shows too_many_attempts when the limit is reached", async () => {
    takeAuthAttempt.mockResolvedValue(false);
    const to = await redirectOf(run);
    expect(to).toContain("error=too_many_attempts");
    expect(called()).not.toHaveBeenCalled();
  });
});

describe("same response for reset and resend", () => {
  it("reset still lands on the sent screen when allowed (no account-exists signal)", async () => {
    const to = await redirectOf(() => requestPasswordReset(form({ email: "nobody@example.com" })));
    expect(to).toContain("sent=reset");
  });

  it("resend still lands on the resent state when allowed", async () => {
    const to = await redirectOf(() => resendSignupConfirmation(form({ email: "nobody@example.com" })));
    expect(to).toContain("resent=1");
  });
});

describe("too_many_attempts copy", () => {
  it("resolves to its own message in ko · ja · en", async () => {
    const { getDictionary } = await import("@/lib/i18n");
    const { resolveAuthErrorMessage } = await import("@/lib/auth-errors");
    const seen = new Set<string>();
    for (const locale of ["ko", "ja", "en"] as const) {
      const dictionary = getDictionary(locale);
      const message = resolveAuthErrorMessage("too_many_attempts", dictionary);
      expect(message).toBe(dictionary.auth.errors.too_many_attempts);
      expect(message).not.toBe(dictionary.auth.errors.generic);
      seen.add(message!);
    }
    expect(seen.size).toBe(3);
  });
});
