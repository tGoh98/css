import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Cron routes (/api/cron/*) are intentionally NOT gated by the session check
// here; each handler must verify the CRON_SECRET Bearer token itself.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Match everything except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
