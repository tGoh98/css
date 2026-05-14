import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { getAllowlist } from "@/lib/env";

export const authConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  // JWT strategy — cookie is self-contained, so the Edge middleware in
  // src/proxy.ts can validate sessions without a DB call. The DrizzleAdapter
  // is still used to persist user + account rows; we just skip session rows.
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/unauthorized",
  },
  callbacks: {
    async signIn({ account, profile }) {
      // Only enforce the allowlist for GitHub sign-ins.
      if (account?.provider !== "github") return true;
      const allowlist = getAllowlist();
      if (allowlist.length === 0) return false;
      const login = (profile as { login?: string } | undefined)?.login;
      if (!login) return false;
      return allowlist.includes(login.toLowerCase());
    },
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
