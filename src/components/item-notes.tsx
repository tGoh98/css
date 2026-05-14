"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 600;

export function ItemNotes({
  itemId,
  initial,
}: {
  itemId: number;
  initial: string;
}) {
  const [value, setValue] = React.useState(initial);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = React.useRef(initial);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    latestRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items/${itemId}/notes`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: latestRef.current }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, SAVE_DEBOUNCE_MS);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`notes-${itemId}`}>
          Notes
        </label>
        <span
          className={cn(
            "text-[10px] uppercase tracking-wide",
            status === "saved" && "text-muted-foreground",
            status === "saving" && "text-muted-foreground",
            status === "error" && "text-destructive",
          )}
        >
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
          {status === "error" && "Save failed"}
        </span>
      </div>
      <textarea
        id={`notes-${itemId}`}
        value={value}
        onChange={handleChange}
        placeholder="Add a note…"
        rows={4}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>
  );
}
