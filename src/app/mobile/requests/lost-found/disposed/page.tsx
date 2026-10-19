import { redirect } from "next/navigation";
import { LostFoundArchiveList, type ArchiveItemVM } from "@/components/requests/lost-found-archive-list";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getDictionary } from "@/lib/i18n";
import { getDisposedLostItems } from "@/lib/lost-found";
import { getOnboardingState } from "@/lib/onboarding";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

// Tokyo 운영일 기준 YYYY-MM-DD (서버/러너 타임존과 무관하게 일 경계 고정).
function tokyoDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayDiff(todayKey: string, key: string): number {
  const [ay, am, ad] = todayKey.split("-").map(Number);
  const [by, bm, bd] = key.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

export default async function DisposedLostFoundPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/requests/lost-found/disposed");
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.lostFound.disposed;

  const [items, roomCatalog, navBadges] = await Promise.all([
    getDisposedLostItems(session),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
    navBadgesPromise,
  ]);

  const todayKey = tokyoDateKey(new Date().toISOString());
  const currentMonthKey = todayKey.slice(0, 7);
  const [cy, cm] = currentMonthKey.split("-").map(Number);
  const lm = new Date(Date.UTC(cy, cm - 1, 1));
  lm.setUTCMonth(lm.getUTCMonth() - 1);
  const lastMonthKey = `${lm.getUTCFullYear()}-${String(lm.getUTCMonth() + 1).padStart(2, "0")}`;

  const vms: ArchiveItemVM[] = items.map((item) => {
    const location = resolveRequestLocation(
      item.room_label,
      roomCatalog,
      dictionary.cleaning.buildingLabels,
      item.property_name,
    );
    const disposedAtIso = item.handled_at ?? item.updated_at;
    const disposedDateKey = disposedAtIso ? tokyoDateKey(disposedAtIso) : null;
    const monthKey = disposedDateKey ? disposedDateKey.slice(0, 7) : currentMonthKey;
    const relativeGroup =
      monthKey === currentMonthKey ? "thisMonth" : monthKey === lastMonthKey ? "lastMonth" : null;
    return {
      id: item.id,
      itemName: item.item_name,
      buildingLabel: location.buildingLabel ?? "-",
      roomLabel: location.roomLabel,
      reporterName: item.reporter_name || "-",
      handlerLabel: item.handled_by ? (item.handled_by_name ?? "-") : copy.metaAuto,
      atIso: disposedAtIso,
      dateKey: disposedDateKey,
      extra: null,
      monthKey,
      relativeGroup,
    };
  });

  const monthCount = vms.filter((v) => v.monthKey === currentMonthKey).length;
  const weekCount = vms.filter(
    (v) => v.dateKey && dayDiff(todayKey, v.dateKey) >= 0 && dayDiff(todayKey, v.dateKey) <= 6,
  ).length;

  const buildingOptions = Array.from(new Set(vms.map((v) => v.buildingLabel).filter((b) => b && b !== "-")))
    .sort((a, b) => a.localeCompare(b, locale));

  return (
    <MobileShell activeItem="requests" badges={navBadges} title={copy.title} split>
      <SplitList detail="requests">
        <LostFoundArchiveList
          filterLabel={dictionary.mobile.filterButton}
          buildingOptions={buildingOptions}
          copy={copy}
          items={vms}
          locale={locale}
          stats={{ total: vms.length, month: monthCount, week: weekCount }}
          todayKey={todayKey}
        />
      </SplitList>
    </MobileShell>
  );
}
