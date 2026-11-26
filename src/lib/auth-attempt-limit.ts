import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 로그인 · 가입 · 확인 메일 다시 보내기 · 비밀번호 재설정 시도 제한(2026-11-26, 202611260005).
 *
 * 서버에서 Supabase Auth 를 부르므로 Supabase 의 IP 제한은 Vercel 서버 IP 를 본다. 그래서 앱이 먼저
 * `public.auth_attempts` 에 이메일 · IP 별로 시도를 세어 막는다(인스턴스를 넘어 맞도록 DB 에서).
 *
 * - 로그인: 이메일당 15분 10번(사람이 비밀번호를 몇 번 틀려도 남는 폭, 무작위 대입은 하루 ~1000번으로 묶임) ·
 *   IP 당 15분 30번(사무실 한 공유기 뒤에서 직원 여럿이 출근 때 몰아 로그인해도 남는 폭).
 * - 메일을 보내는 동작(가입 · 다시 보내기 · 재설정): 이메일당 1시간 3번 · IP 당 1시간 10번. 프로젝트 메일 한도
 *   (시간당 몇 통)를 한 사람이 다 써 버리지 못하게 한다. 동작마다 따로 센다 — 가입 1번 + 다시 보내기 2번이 서로를 막지 않게.
 */
export type AuthAttemptAction = "sign_in" | "sign_up" | "resend_signup" | "password_reset";

type Limit = { windowSeconds: number; perEmail: number; perIp: number };

export const AUTH_ATTEMPT_LIMITS: Record<AuthAttemptAction, Limit> = {
  sign_in: { windowSeconds: 15 * 60, perEmail: 10, perIp: 30 },
  sign_up: { windowSeconds: 60 * 60, perEmail: 3, perIp: 10 },
  resend_signup: { windowSeconds: 60 * 60, perEmail: 3, perIp: 10 },
  password_reset: { windowSeconds: 60 * 60, perEmail: 3, perIp: 10 },
};

/** Vercel 이 넣는 x-forwarded-for 첫 값 → x-real-ip. 없으면 null(IP 한도는 건너뛰고 이메일 한도만). */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

function hashKey(kind: "email" | "ip", value: string) {
  return createHash("sha256").update(`${kind}|${value}`).digest("hex");
}

/**
 * true = 진행, false = 한도 초과. DB 오류면 로그를 남기고 진행한다(fail open) — 제한기 장애로 로그인이 막히면 안 된다.
 */
export async function takeAuthAttempt(
  action: AuthAttemptAction,
  subject: { email: string; ip: string | null },
): Promise<boolean> {
  const limit = AUTH_ATTEMPT_LIMITS[action];
  try {
    const { data, error } = await getSupabaseServiceClient().rpc("take_auth_attempt", {
      p_action: action,
      p_email_hash: subject.email ? hashKey("email", subject.email.trim().toLowerCase()) : null,
      p_ip_hash: subject.ip ? hashKey("ip", subject.ip) : null,
      p_window_seconds: limit.windowSeconds,
      p_email_limit: limit.perEmail,
      p_ip_limit: limit.perIp,
    });
    if (error) {
      console.error("[auth-attempt-limit]", action, error.message);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.error("[auth-attempt-limit]", action, error instanceof Error ? error.message : error);
    return true;
  }
}
