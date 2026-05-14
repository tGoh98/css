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
      // The public site (Feed, Digests, Official, Competitors, About,
      // item detail, search API) is unauthenticated — content is
      // sourced from public news/SEC/HN/Reddit/etc. anyway.
      //
      // Only /admin/* requires a signed-in admin (additionally gated by
      // isAdminUsername inside the page + server actions).
      //
      // /api/cron/* and /api/webhooks/* enforce their own bearer-token
      // checks inside the handlers; they don't need a NextAuth session.
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/admin")) return !!auth?.user;
      return true;
    },
  },
} satisfies NextAuthConfig;
