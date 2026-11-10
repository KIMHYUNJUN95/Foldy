// 요청 등록(수리 · 분실물 · 주문)을 같은 id 로 두 번 보냈을 때 — 첫 번째는 저장됐는데 응답을 못 받고 다시 누른 경우(2026-11-10).
// 폼은 화면을 열 때 만든 요청 id 를 그대로 다시 보내므로, 두 번째 insert 는 PK 중복(23505)으로 실패한다. 예전엔 그걸 「저장 실패」로
// 띄워서, 이미 저장된 신고를 사용자가 또 쓰게 만들었다. 이제 **같은 조직 · 같은 신고자 · 같은 id** 행이 이미 있으면 성공으로 본다
// (남의 행 id 를 맞혀도 신고자가 다르면 성공이 아니다).
type ResendCheckClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
        };
      };
    };
  };
};

export const UNIQUE_VIOLATION = "23505";

export async function isOwnResentRequest(
  // Supabase 클라이언트 — 정확한 타입으로 받으면 TS 가 제네릭을 끝없이 펼친다(TS2589). 안에서 필요한 모양으로만 본다.
  client: object,
  table: "lost_items" | "maintenance_reports" | "order_requests",
  args: { error: { code?: string } | null; id: string; organizationId: string; userId: string },
): Promise<boolean> {
  if (args.error?.code !== UNIQUE_VIOLATION) return false;
  const supabase = client as ResendCheckClient;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", args.id)
    .eq("organization_id", args.organizationId)
    .eq("reported_by_user_id", args.userId)
    .maybeSingle();
  return Boolean(data);
}
