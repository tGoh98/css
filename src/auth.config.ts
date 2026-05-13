import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth config (no DB adapter, no Node-only providers).
 * Used by middleware to derive session presence; the full config in
 * `src/lib/auth.ts` is used by API routes / server components.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/unauthorized",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      // Public routes; cron is gated by CRON_SECRET inside the handlers.
      if (
        pathname === "/login" ||
        pathname === "/unauthorized" ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/cron")
      ) {
        return true;
      }
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
