"use client";

import { deleteOrganization } from "@/app/admin/settings/actions";
import { SettingsConfirm } from "./settings-confirm";

type OrgDeleteButtonProps = {
  organizationId: string;
  labels: { delete: string; title: string; confirm: string; keep: string; ok: string };
};

/**
 * 조직 삭제 컨트롤(개발자 전용 페이지). 제출 전에 확인 모달을 띄우고
 * `deleteOrganization` 서버 액션을 호출한다. 액션 자체는 비어 있는 조직(멤버 없음)만 삭제할 수 있다.
 * 조직 범위 테이블은 모두 삭제 시 연쇄되기 때문이며, 이 버튼은 파괴적인 제출을 막아 둘 뿐이다.
 */
export function OrgDeleteButton({ organizationId, labels }: OrgDeleteButtonProps) {
  return (
    <SettingsConfirm
      action={deleteOrganization}
      fields={{ organizationId }}
      trigger={labels.delete}
      triggerClassName="stw-btn is-text is-red"
      title={labels.title}
      body={labels.confirm}
      keep={labels.keep}
      ok={labels.ok}
      danger
    />
  );
}
