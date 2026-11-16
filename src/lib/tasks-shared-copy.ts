/**
 * 모바일(`dictionary.tasks`) 과 PC 콘솔(`admin-tasks-i18n.ts`)이 같은 말을 쓰는 단어 — 한 곳에서만 정한다(2026-11-16).
 * - share: 상세의 「공유하기」 버튼 (예전 PC 는 「멤버에게 공유 / 지시」 로 달랐다).
 * - updates: 상세의 업데이트(메모) 영역 제목 (예전엔 「업데이트 로그」).
 */
export const tasksSharedCopy: Record<"ko" | "ja" | "en", { share: string; updates: string }> = {
  ko: { share: "공유하기", updates: "업데이트" },
  ja: { share: "共有する", updates: "更新" },
  en: { share: "Share", updates: "Updates" },
};
