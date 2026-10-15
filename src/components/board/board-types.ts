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

// ── Page 3 (detail) — serializable shapes returned by getBoardPost() ──────────
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
  // All five board emojis in fixed order, each with the viewer's isMine flag (count may be 0).
  reactions: BoardReaction[];
  // Up to 3 distinct reactors for the most-used emoji (for the stacked avatars).
  reactionFaces: BoardReactionFace[];
  // Total number of distinct reactors across all emojis (for the summary line).
  reactionTotal: number;
  // Display name of the first reactor (for the summary line); null when none.
  firstReactorName: string | null;
  comments: BoardCommentDetail[];
};

/** 게시판 반응 이모지 — 서버(`ALLOWED_EMOJIS` · `REACTION_EMOJIS`)와 같은 순서 · 같은 다섯 개. */
export const BOARD_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"] as const;
