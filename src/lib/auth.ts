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
  session: { strategy: "database" },
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
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
