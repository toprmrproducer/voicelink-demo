import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/session";

/**
 * /admin — entry point for the admin panel. Reached from the
 * "Admin Panel" button on /login, or by typing the URL directly.
 *
 *   - not logged in → /login
 *   - logged in but not superadmin → / (which then sends them to /dashboard)
 *   - logged in superadmin → /admin/tenants
 */
export default async function AdminEntryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isSuperadmin) redirect("/");
  redirect("/admin/tenants");
}
