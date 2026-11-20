"use client";

import { useState, type ReactNode } from "react";
import { Building2, ShieldCheck, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccountTabKey = "profile" | "organization" | "security";

/**
 * 계정 화면의 설정 허브 셸 (2026-07-31, B안).
 *
 * 예전에는 프로필 폼 · 조직 카드 · 로그아웃 · 계정 삭제가 한 페이지에 세로로 쌓여 있어, 성격이 전혀
 * 다른 것들(자주 안 바꾸는 신원 / 읽기 전용 소속 / 되돌릴 수 없는 파괴적 동작)이 같은 무게로 보였다.
 * 좌측 서브내비로 갈라 **파괴적 동작이 실수로 눈에 띄지 않게** 하고, 앞으로 비밀번호·기기 같은 항목이
 * 붙을 자리를 만든다.
 *
 * 패널 내용은 **서버에서 만들어 children 으로 받는다** — 이 컴포넌트는 탭 전환만 담당한다.
 * 그래야 폼이 서버 액션을 그대로 쓰고, 세션 데이터를 클라이언트로 내려보내지 않는다.
 *
 * 탭 상태를 URL 이 아니라 로컬 state 로 두는 이유: 전환마다 서버 왕복이 생기면 입력 중이던 폼이
 * 날아간다. 대신 저장 후 서버가 `?saved=` 로 돌아오므로 그때는 프로필 탭이 기본으로 열린다.
 */
export function AccountSettings({
  labels,
  panels,
  /** 알림 배너 등 탭과 무관하게 항상 위에 떠야 하는 것(저장 완료·오류·프로필 미완성). */
  banners,
}: {
  labels: Record<AccountTabKey, string>;
  panels: Record<AccountTabKey, ReactNode>;
  banners?: ReactNode;
}) {
  const [tab, setTab] = useState<AccountTabKey>("profile");

  const items: { key: AccountTabKey; icon: typeof UserRound }[] = [
    { key: "profile", icon: UserRound },
    { key: "organization", icon: Building2 },
    { key: "security", icon: ShieldCheck },
  ];

  return (
    /* `@container` 필수 — 브레이크포인트를 뷰포트가 아니라 **이 블록의 실제 폭**에 건다.
       콘솔의 "모바일 보기"는 넓은 데스크톱 뷰포트 안에 430px 모바일 셸을 그리므로, 뷰포트
       기준(`sm:`)으로 판단하면 좁은 셸 안에서 좌측 레일 2열이 되어 카드가 잘린다(2026-07-31). */
    <div className="@container space-y-5">
      {banners}

      {/* 좁은 화면(모바일 셸)에서는 서브내비가 위로 올라가 가로 스크롤 칩이 된다. */}
      <div className="grid gap-4 @2xl:grid-cols-[168px_minmax(0,1fr)] @2xl:gap-5">
        <nav
          aria-label={labels.profile}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 @2xl:mx-0 @2xl:flex-col @2xl:overflow-visible @2xl:px-0 @2xl:pb-0"
        >
          {items.map(({ key, icon: Icon }) => (
            <button
              aria-current={tab === key ? "page" : undefined}
              /* 좁은 화면 = 모바일 셸. 이때는 앱의 알약형 탭 규격을 그대로 쓴다(테두리 있는
                 rounded-full, 활성은 네이비 채움 — `tasks-workspace` 탭 스트립과 동일).
                 sm 이상 = 관리 콘솔의 좌측 레일이라 사각 항목 + 연한 네이비 배경으로 바뀐다. */
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors",
                "@2xl:w-full @2xl:justify-start @2xl:gap-2 @2xl:rounded-xl @2xl:border-transparent @2xl:px-3 @2xl:py-2.5",
                tab === key
                  ? "border-primary bg-primary text-primary-foreground @2xl:bg-primary/[0.08] @2xl:text-primary"
                  : "border-border bg-surface text-slate-600 @2xl:bg-transparent @2xl:text-muted-foreground @2xl:hover:bg-muted/60",
              )}
              key={key}
              onClick={() => setTab(key)}
              type="button"
            >
              <Icon className="size-[15px] shrink-0" aria-hidden="true" />
              {labels[key]}
            </button>
          ))}
        </nav>

        <div className="min-w-0">{panels[tab]}</div>
      </div>
    </div>
  );
}
