import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getPublicSupabaseEnv } from "@/lib/env";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const { anonKey, url } = getPublicSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 서버 컴포넌트는 쿠키를 설정할 수 없다. 미들웨어/라우트 핸들러는 가능하다.
        }
      },
    },
  });
}
