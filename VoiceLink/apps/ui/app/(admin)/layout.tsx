import type { ReactNode } from "react";

import { requireSuperadmin } from "@/lib/session";
import { Sidebar } from "@/components/layout/sidebar";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperadmin();
  return (
    <div className="min-h-screen flex">
      <Sidebar isSuperadmin={true} />
      <main className="flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
