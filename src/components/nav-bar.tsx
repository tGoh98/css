import Link from "next/link";
import { SearchCommand } from "@/components/search-command";
import { auth } from "@/lib/auth";
import { isAdminUsername } from "@/lib/env";

const PUBLIC_TABS = [
  { label: "Feed", href: "/feed" },
  { label: "Digests", href: "/digests" },
  { label: "Official", href: "/official" },
  { label: "Analyst", href: "/analyst" },
  { label: "Competitors", href: "/competitors" },
  { label: "About", href: "/about" },
] as const;

const ADMIN_TABS = [
  { label: "Competitors", href: "/admin/competitors" },
  { label: "Upload", href: "/admin/upload" },
] as const;

export async function NavBar() {
  const session = await auth();
  const username = (session?.user as { username?: string } | undefined)?.username;
  const isAdmin = isAdminUsername(username);
  const tabs = isAdmin ? [...PUBLIC_TABS, ...ADMIN_TABS] : PUBLIC_TABS;

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Link href="/feed" className="text-sm font-semibold tracking-tight">
          Claudy Simple Server
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <SearchCommand />
      </div>
    </header>
  );
}
