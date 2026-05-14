/**
 * Light env accessor. Each value is read lazily so missing values only error
 * when actually needed (helps `next build` succeed without secrets).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get ANTHROPIC_API_KEY() {
    return required("ANTHROPIC_API_KEY");
  },
  get RESEND_API_KEY() {
    return required("RESEND_API_KEY");
  },
  get RESEND_FROM_EMAIL() {
    return process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  },
  get RESEND_TO_EMAIL() {
    return required("RESEND_TO_EMAIL");
  },
  get NEXTAUTH_SECRET() {
    return required("NEXTAUTH_SECRET");
  },
  get NEXTAUTH_URL() {
    return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  },
  get AUTH_GITHUB_ID() {
    return required("AUTH_GITHUB_ID");
  },
  get AUTH_GITHUB_SECRET() {
    return required("AUTH_GITHUB_SECRET");
  },
  get AUTH_ALLOWLIST() {
    return process.env.AUTH_ALLOWLIST ?? "";
  },
  get CRON_SECRET() {
    return required("CRON_SECRET");
  },
};

export function getAllowlist(): string[] {
  return (process.env.AUTH_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The GitHub username (lowercased) that's allowed to see admin-only UI
 * (e.g. /admin/competitors). Defaults to the first entry in AUTH_ALLOWLIST,
 * so the project owner is admin by default with no extra config.
 */
export function getAdminUsername(): string | null {
  const explicit = process.env.AUTH_ADMIN?.trim().toLowerCase();
  if (explicit) return explicit;
  return getAllowlist()[0] ?? null;
}

/** Whether the given (already-lowercased) username has admin access. */
export function isAdminUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  const admin = getAdminUsername();
  return admin !== null && admin === username.toLowerCase();
}
