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
      <div className="mx-auto flex max-w-6xl items-center gap-3 sm:gap-8 px-3 sm:px-6 py-3 sm:py-4">
        <Link
          href="/"
          className="shrink-0 text-sm font-semibold tracking-tight"
          aria-label="Claudy Simple Server"
        >
          <span className="hidden sm:inline">Claudy Simple Server</span>
          <span className="sm:hidden">CSS</span>
        </Link>
        {/* Horizontal-scrollable tab row on narrow viewports so the 6–7
            tabs never wrap or push the SearchCommand off-screen. */}
        <nav className="-mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1 text-sm scrollbar-none sm:gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="shrink-0 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-3"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {/* SearchCommand is keyboard-driven (⌘K); hide on touch viewports
            where it's not usable and just takes up width. */}
        <div className="hidden sm:block">
          <SearchCommand />
        </div>
      </div>
    </header>
  );
}
