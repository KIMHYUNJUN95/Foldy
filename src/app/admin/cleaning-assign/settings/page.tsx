import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { AssignSettingsView } from "@/components/admin/cleaning-assign/assign-settings";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { loadCleaningRoomOptions } from "@/lib/automation/data";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { loadSettingsView } from "@/lib/cleaning-assign/data";
import { getDictionary } from "@/lib/i18n";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 청소 배정 설정 — 제안 규칙(켜기 · 끄기 · 순서) · 건물별 고정 인력(1 · 2 · 3순위 …) · 사람별 · 큰 방 보통 인원. `cleaning.assign` 만.
 * docs/product/37-cleaning-shift-assignment.md 「4-5」
 */
export default async function AdminCleaningAssignSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [session, params] = await Promise.all([requireAdminPageSession({ nextPath: "/admin/cleaning-assign/settings" }), searchParams]);
  if (!session.capabilities.includes("cleaning.assign")) redirect("/admin");
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const supabase = getSupabaseServiceClient();
  const today = getCleaningOperatingDateKey();
  const roomOptions = await loadCleaningRoomOptions(supabase, session.organization.id);
  const view = await loadSettingsView(
    supabase,
    session.organization.id,
    today,
    roomOptions.map((option) => ({ propertyName: option.propertyName, roomKey: option.roomKey, roomLabel: option.roomLabel })),
  );
  const propertyLabels = Object.fromEntries(view.properties.map((name) => [name, localizePropertyName(name, dictionary.cleaning.buildingLabels)]));
  const tab = params.tab === "fixed" || params.tab === "people" || params.tab === "rooms" ? params.tab : "rules";
  const copy = getCleaningAssignCopy(locale);
  return (
    <AdminShell activeItem="cleaning-assign" title={copy.settingsTitle}>
      <AssignSettingsView view={view} copy={copy} propertyLabels={propertyLabels} initialTab={tab} />
    </AdminShell>
  );
}
