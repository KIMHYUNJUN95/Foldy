"use client";

import { Trash2 } from "lucide-react";
import { deleteOrganization } from "@/app/admin/settings/actions";
import { SettingsConfirm } from "./settings-confirm";

type OrgDeleteButtonProps = {
  organizationId: string;
  /** 멤버가 남아 있으면 휴지통을 끈다 — 액션도 비어 있는 조직만 지운다. */
  disabled: boolean;
  labels: { delete: string; blocked: string; title: string; confirm: string; keep: string; ok: string };
};

/**
 * 조직 삭제 컨트롤(개발자 전용 페이지) — 패널 오른쪽 위 빨간 휴지통(2026-11-12).
 * 제출 전에 확인 모달을 띄우고 `deleteOrganization` 서버 액션을 호출한다. 액션 자체는 비어 있는 조직(멤버 없음)만 삭제할 수 있다.
 * 조직 범위 테이블은 모두 삭제 시 연쇄되기 때문이며, 이 버튼은 파괴적인 제출을 막아 둘 뿐이다.
 */
export function OrgDeleteButton({ organizationId, disabled, labels }: OrgDeleteButtonProps) {
  return (
    <SettingsConfirm
      action={deleteOrganization}
      fields={{ organizationId }}
      trigger={<Trash2 aria-hidden="true" />}
      triggerClassName="stw-icon is-red"
      triggerAriaLabel={disabled ? labels.blocked : labels.delete}
      triggerDisabled={disabled}
      title={labels.title}
      body={labels.confirm}
      keep={labels.keep}
      ok={labels.ok}
      danger
    />
  );
}
