"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type SubmitButtonProps = {
  children: ReactNode;
  /** 둘러싼 폼 액션이 진행 중일 때 보인다. 기본은 스피너 + 라벨. */
  pendingChildren?: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "glass" | "destructive";
  autoFocus?: boolean;
  disabled?: boolean;
};

/**
 * 제출 버튼: 둘러싼 `<form action={...}>`
 * 서버 액션이 진행 중인 동안 스스로 비활성화되고 스피너를 보인다 (`useFormStatus`). 이중 제출과 왕복 중
 * 여전히 눌릴 것 같은 버튼의 "죽은" 느낌을 막는다. 반드시 `<form>` 안쪽에서 렌더해야 한다.
 */
export function SubmitButton({
  children,
  pendingChildren,
  className,
  variant = "primary",
  autoFocus,
  disabled,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      aria-busy={pending}
      autoFocus={autoFocus}
      className={className}
      disabled={pending || disabled}
      type="submit"
      variant={variant}
    >
      {pending
        ? (pendingChildren ?? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {children}
            </span>
          ))
        : children}
    </Button>
  );
}
