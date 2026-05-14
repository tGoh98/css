"use client";

import * as React from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BookmarkButton({
  itemId,
  initial,
  size = "icon-xs",
  className,
}: {
  itemId: number;
  initial: boolean;
  size?: "icon-xs" | "icon-sm" | "icon";
  className?: string;
}) {
  const [bookmarked, setBookmarked] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    try {
      const res = await fetch("/api/bookmarks", {
        method: next ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!res.ok) throw new Error(`bookmark failed: ${res.status}`);
    } catch {
      // revert on failure
      setBookmarked(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant="ghost"
      onClick={toggle}
      disabled={pending}
      aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
      aria-pressed={bookmarked}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        bookmarked && "text-foreground",
        className,
      )}
    >
      {bookmarked ? <BookmarkCheck /> : <Bookmark />}
    </Button>
  );
}
