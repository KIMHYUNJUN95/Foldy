/** 알림 DDL 이 아직 적용되지 않았을 때의 PostgREST / Supabase 오류. */
export function isNotificationsTableUnavailable(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table") ||
    normalized.includes("schema cache") ||
    normalized.includes("does not exist") ||
    (normalized.includes("relation") && normalized.includes("notifications"))
  );
}
