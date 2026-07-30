import Link from "next/link";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  superadminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/calls", label: "Calls" },
  { href: "/voices", label: "Voices" },
  { href: "/credits", label: "Credits" },
  { href: "/settings", label: "Settings" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/dids", label: "DIDs" },
  { href: "/admin/credits", label: "Credits" },
];

interface Props {
  isSuperadmin: boolean;
  className?: string;
}

async function fetchBalance(): Promise<number | null> {
  try {
    const { balance } = await api.get<{ balance: number }>("/credits?limit=1");
    return balance;
  } catch (err) {
    // Superadmin without ?tenantId gets a 404 from /credits — that's fine.
    if (err instanceof ApiError) return null;
    return null;
  }
}

export async function Sidebar({ isSuperadmin, className }: Props) {
  const balance = isSuperadmin ? null : await fetchBalance();
  return (
    <nav
      className={cn(
        "w-56 shrink-0 border-r bg-zinc-50 dark:bg-zinc-950 px-3 py-4 flex flex-col",
        className,
      )}
    >
      <div className="px-2 py-1 text-base font-bold tracking-tight">
        RapidX<span className="text-blue-600"> AI</span>
      </div>
      <ul className="mt-4 space-y-1">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      {isSuperadmin && (
        <>
          <div className="mt-6 px-2 text-[11px] uppercase tracking-wide text-zinc-500">
            Superadmin
          </div>
          <ul className="mt-2 space-y-1">
            {ADMIN_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {balance !== null && (
        <div className="mt-auto pt-4 px-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Credits
          </div>
          <div
            className={cn(
              "text-lg font-semibold",
              balance < 0 && "text-red-600",
            )}
          >
            {balance.toLocaleString()}
          </div>
          <Link
            href="/credits"
            className="text-xs text-zinc-500 hover:underline"
          >
            View ledger
          </Link>
        </div>
      )}
    </nav>
  );
}
