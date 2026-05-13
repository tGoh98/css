import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-24 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Claudy Simple Server is invite-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/feed" });
            }}
          >
            <Button type="submit" className="w-full">
              Continue with GitHub
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
