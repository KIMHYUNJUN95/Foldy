import { AdminShell } from "@/components/shell/admin-shell";
import { OrdersConsole } from "@/components/admin/orders/orders-console";
import { getAdminOrders } from "@/lib/admin-orders";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { getNavigationLabel, adminNavigation } from "@/config/navigation";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { requestLiveSources } from "@/lib/live-sources";

export default async function AdminOrdersPage() {
  const session = await requireAdminPageSession({ nextPath: "/admin/orders" });
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const { orders, loadError, todayKey } = await getAdminOrders(session, dictionary.cleaning.buildingLabels);
  const navItem = adminNavigation.find((i) => i.id === "orders");
  const title = navItem ? getNavigationLabel(navItem, locale) : dictionary.mobile.quickActions.order;
  return (
    <AdminShell activeItem="orders" title={title}>
      <LiveRefresh sources={requestLiveSources(session.organization.id)} />
      <OrdersConsole locale={locale} orders={orders} loadError={loadError} todayKey={todayKey} />
    </AdminShell>
  );
}
