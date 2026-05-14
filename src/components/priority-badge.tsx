import { Badge } from "@/components/ui/badge";

type Priority = "routine" | "notable" | "breaking" | string | null | undefined;

const LABEL: Record<string, string> = {
  routine: "Routine",
  notable: "Notable",
  breaking: "Breaking",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (!priority) return null;
  const variant: "destructive" | "default" | "secondary" =
    priority === "breaking"
      ? "destructive"
      : priority === "notable"
        ? "default"
        : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] uppercase tracking-wide">
      {LABEL[priority] ?? priority}
    </Badge>
  );
}
