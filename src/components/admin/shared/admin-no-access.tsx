import { AlertTriangle, LockKeyhole } from "lucide-react";

/**
 * 대시보드 안 한 화면의 「권한 없음」 — 관리자 웹은 들어왔지만 이 메뉴의 권한 키가 없을 때(2026-10-21).
 * 예전엔 화면마다 「데이터 없음」 문구를 빌려 써서 권한 문제인지 데이터가 없는 건지 헷갈렸다.
 * 모양(2026-10-22 Apple 스타일 시안 승인): 카드 · 그림자 없이 본문 가운데에 아이콘 · 제목 · 설명만 — 「콘텐츠 없음」 화면과 같은 방식.
 * 문구는 `dictionary.admin.shared.noAccessTitle` · `noAccessBody`.
 */
export function AdminNoAccess({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 pb-16 pt-12 text-center">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-[#f2f2f7] text-[#8e8e93]">
        <LockKeyhole aria-hidden="true" size={24} strokeWidth={1.8} />
      </span>
      <p className="mt-[18px] text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-[#1d1d1f]">{title}</p>
      <p className="mt-1.5 text-[13px] leading-[18px] text-[#6e6e73]">{body}</p>
    </div>
  );
}

/**
 * 대시보드 안 한 화면의 「불러오지 못함」(2026-11-11) — 읽기 실패를 빈 목록 · 「데이터 없음」으로 숨기지 않을 때. 모양은 `AdminNoAccess` 와 같다.
 * 문구는 `dictionary.admin.shared.loadErrorTitle` · `loadErrorBody`.
 */
export function AdminLoadError({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="flex min-h-[420px] flex-col items-center justify-center px-6 pb-16 pt-12 text-center">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-[#f2f2f7] text-[#8e8e93]">
        <AlertTriangle aria-hidden="true" size={24} strokeWidth={1.8} />
      </span>
      <p className="mt-[18px] text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-[#1d1d1f]">{title}</p>
      <p className="mt-1.5 text-[13px] leading-[18px] text-[#6e6e73]">{body}</p>
    </div>
  );
}
