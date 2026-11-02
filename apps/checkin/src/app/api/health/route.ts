import { CONTRACT_VERSION } from "@/lib/contract/schema";

// 배포 확인용. 개인 정보 · 환경 값은 돌려주지 않는다.
export function GET() {
  return Response.json({ ok: true, contract_version: CONTRACT_VERSION });
}
