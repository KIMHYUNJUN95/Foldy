export type AvatarColor = "default" | "red" | "blue" | "green";

export type FileAttachment = {
  name: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
};

export type BoardReaction = {
  emoji: string;
  count: number;
  isMine: boolean;
};

export type BoardPost = {
  id: string;
  title: string | null;
  content: string;
  tags: string[];
  imageUrls: string[];
  fileAttachments: FileAttachment[];
  isPinned: boolean;
  pinnedAt: string | null;
  allowComments: boolean;
  createdAt: string;
  authorName: string;
  authorId: string;
  authorRole: string;
  avatarColor: AvatarColor;
  commentCount: number;
  reactions: BoardReaction[];
  isUnread: boolean;
  category: string | null;
};

export type BoardComment = {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  avatarColor: AvatarColor;
  timeLabel: string;
  imageUrls: string[];
  isOwn: boolean;
  reactions: { emoji: string; count: number }[];
};

// ── 페이지 3(상세) — getBoardPost() 가 돌려주는 직렬화 가능한 형태 ──
export type BoardReactionFace = {
  initial: string;
  color: AvatarColor;
};

export type BoardCommentDetail = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  avatarColor: AvatarColor;
  content: string;
  imageUrls: string[];
  createdAt: string;
  isOwn: boolean;
};

export type BoardPostDetail = {
  id: string;
  title: string | null;
  content: string;
  tags: string[];
  imageUrls: string[];
  fileAttachments: FileAttachment[];
  isPinned: boolean;
  allowComments: boolean;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  avatarColor: AvatarColor;
  // 고정 순서의 게시판 이모지 5개 전부, 각각 보는 사람의 isMine 플래그 포함(개수는 0일 수 있음).
  reactions: BoardReaction[];
  // 가장 많이 쓰인 이모지에 반응한 서로 다른 사람 최대 3명(겹친 아바타용).
  reactionFaces: BoardReactionFace[];
  // 모든 이모지를 통틀어 반응한 서로 다른 사람의 총 수(요약 줄용).
  reactionTotal: number;
  // 첫 번째 반응자의 표시 이름(요약 줄용); 없으면 null.
  firstReactorName: string | null;
  comments: BoardCommentDetail[];
};

/** 게시판 반응 이모지 — 서버(`ALLOWED_EMOJIS` · `REACTION_EMOJIS`)와 같은 순서 · 같은 다섯 개. */
export const BOARD_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"] as const;
