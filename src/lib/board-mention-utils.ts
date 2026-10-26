export type MentionUser = { id: string; name: string };

/**
 * @ALL 멘션을 위해 댓글 내용에 쓰는 내부 평문 토큰.
 * 로케일별 표시는 렌더 때 해석해서 저장 값이 안정적으로 유지된다.
 */
export const ALL_TOKEN = "@ALL";

/**
 * 댓글 내용을 평문과 멘션 조각의 순서열로 파싱한다.
 *
 * 방식:
 * - @ALL (대소문자 무시) → 단일 "all" 멘션 조각
 * - 나머지 @이름 패턴은 가장 긴 접두사부터 mentionedUsers 와 맞춘다
 *   더 긴 이름이 목록에 있으면 "김지수연" 이 "김지수" 와 부분 매칭되지 않는다
 */
export function renderMentionContent(
  content: string,
  mentionedUsers: MentionUser[],
  mentionAll: boolean,
  allLabel: string,
): Array<
  | { type: "text"; text: string }
  | { type: "mention"; label: string; userId: string | "ALL" }
> {
  if (!content) return [];

  // 긴 이름이 잘려 나가지 않도록 욕심 있는(greedy) 매칭을 위해 이름을 긴 것부터 정렬한다.
  const sortedUsers = [...mentionedUsers].sort((a, b) => b.name.length - a.name.length);

  const segments: Array<
    | { type: "text"; text: string }
    | { type: "mention"; label: string; userId: string | "ALL" }
  > = [];

  let i = 0;
  while (i < content.length) {
    if (content[i] !== "@") {
      // 다음 @ 까지 평문을 쌓는다
      const end = content.indexOf("@", i + 1);
      segments.push({ type: "text", text: content.slice(i, end === -1 ? undefined : end) });
      i = end === -1 ? content.length : end;
      continue;
    }

    // @ALL 을 먼저 시도한다(대소문자 무시)
    const allMatch = content.slice(i).match(/^@ALL\b/i);
    if (allMatch && mentionAll) {
      segments.push({ type: "mention", label: `@${allLabel}`, userId: "ALL" });
      i += allMatch[0].length;
      continue;
    }

    // 각 사용자 이름을 시도한다(긴 것부터)
    let matched = false;
    for (const user of sortedUsers) {
      if (content.slice(i + 1, i + 1 + user.name.length) === user.name) {
        const after = content[i + 1 + user.name.length];
        // 이름 뒤에 단어 경계를 요구한다(공백, 문장부호, 또는 문자열 끝)
        if (after === undefined || /[\s,.!?。、]/.test(after)) {
          segments.push({ type: "mention", label: `@${user.name}`, userId: user.id });
          i += 1 + user.name.length;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // 매칭 없음 — @ 를 평문으로 취급한다
      segments.push({ type: "text", text: "@" });
      i += 1;
    }
  }

  // 인접한 텍스트 조각을 합친다(@ 가 매칭되지 않았을 때 생긴다)
  const merged: typeof segments = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (seg.type === "text" && last?.type === "text") {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}
