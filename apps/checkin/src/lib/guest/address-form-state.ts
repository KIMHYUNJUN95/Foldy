// 주소 화면 입력 상태(순수 — 화면 테스트 도구 없이 테스트한다).

/** 한 칸이 빨갛게 남아 있을 때만 그 칸 오류를 새 글로 다시 판정한다(`next` = 새 글의 오류, 없으면 null). 안 빨간 칸은 입력 중 건드리지 않는다. */
export function recomputeFieldError(errors: Record<string, string>, id: string, next: string | null): Record<string, string> {
  if (!(id in errors)) return errors;
  if (next) return { ...errors, [id]: next };
  const { [id]: removed, ...rest } = errors;
  void removed;
  return rest;
}

/** 빨간 칸이 하나도 안 남았으면 아래의 「빨간 칸을 확인해 주세요」도 지운다. */
export function messageAfterEdit(errors: Record<string, string>, message: string | null): string | null {
  return Object.keys(errors).length === 0 ? null : message;
}

const KO_NATIVE = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열", "열한", "열두", "열세", "열네", "열다섯", "열여섯", "열일곱", "열여덟", "열아홉", "스무"];

/** 「모두 이 주소에 사세요?」 앞의 인원. 한국어는 「세 분」 처럼 고유어(스무 분까지, 그 위는 「21분」), 나머지 언어는 숫자 그대로. */
export function guestCountText(locale: string, n: number): string {
  if (locale !== "ko") return String(n);
  return n >= 1 && n <= 20 ? `${KO_NATIVE[n]} 분` : `${n}분`;
}
