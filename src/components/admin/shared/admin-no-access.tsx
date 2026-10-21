import { LockKeyhole } from "lucide-react";

/**
 * 대시보드 안 한 화면의 「권한 없음」 — 관리자 웹은 들어왔지만 이 메뉴의 권한 키가 없을 때(2026-10-21).
 * 예전엔 화면마다 「데이터 없음」 문구를 빌려 써서 권한 문제인지 데이터가 없는 건지 헷갈렸다. 콘솔 공용 빈 상태(`.card .state`)와 같은 모양.
 * 문구는 `dictionary.admin.shared.noAccessTitle` · `noAccessBody`.
 */
export function AdminNoAccess({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <div className="state">
        <span className="state__ic empty">
          <span className="ic">
            <LockKeyhole />
          </span>
        </span>
        <div className="state__t">{title}</div>
        <div className="state__s">{body}</div>
      </div>
    </div>
  );
}
