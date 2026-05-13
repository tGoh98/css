import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto mt-24 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Not authorized</CardTitle>
          <CardDescription>
            Your GitHub account isn&apos;t on the allowlist for this instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          If you should have access, ask the owner to add your GitHub username to
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">AUTH_ALLOWLIST</code>.
          <div className="mt-4">
            <Link href="/login" className="underline">
              Try again
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
