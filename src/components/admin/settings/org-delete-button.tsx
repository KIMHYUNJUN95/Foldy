"use client";

import { deleteOrganization } from "@/app/admin/settings/actions";
import { SettingsConfirm } from "./settings-confirm";

type OrgDeleteButtonProps = {
  organizationId: string;
  labels: { delete: string; title: string; confirm: string; keep: string; ok: string };
};

/**
 * Organization delete control (developer-only page). Confirm modal before submitting the
 * `deleteOrganization` server action. The action itself only allows deleting an EMPTY org (no members)
 * because every org-scoped table cascades on delete — this button just gates the destructive submit.
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
