import { LockKeyhole } from "lucide-react";

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
