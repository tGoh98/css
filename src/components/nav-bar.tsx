import Link from "next/link";
import { SearchCommand } from "@/components/search-command";

const TABS = [
  { label: "Feed", href: "/feed" },
  { label: "Digests", href: "/digests" },
  { label: "Official", href: "/official" },
  { label: "Competitors", href: "/competitors" },
  { label: "Analyst", href: "/analyst" },
  { label: "About", href: "/about" },
] as const;

export function NavBar() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Link href="/feed" className="text-sm font-semibold tracking-tight">
          Claudy Simple Server
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {TABS.map((tab) => (
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
