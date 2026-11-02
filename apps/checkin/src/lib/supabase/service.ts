import "server-only";

import { createClient } from "@supabase/supabase-js";

// 손님 · 태블릿 쓰기는 전부 서버 라우트에서 service_role 로(16 §3). 브라우저로 내보내지 않는다.
// `checkin` 스키마는 Supabase 대시보드 API 설정의 노출 스키마에 넣어야 PostgREST 로 읽힌다(적용 때).
export function createCheckinServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.");
  }
  return createClient(url, key, {
    db: { schema: "checkin" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type CheckinServiceClient = ReturnType<typeof createCheckinServiceClient>;
