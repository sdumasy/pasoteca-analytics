// Who may see the numbers: a signed-in Google account whose address is on
// the list in ALLOWED_EMAILS (comma separated), and verified.

export function allowedEmails(env: string | undefined): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function mayView(token: { email?: string; email_verified?: boolean } | null, allowed: Set<string>): boolean {
  if (!token?.email || token.email_verified !== true) return false;
  return allowed.has(token.email.toLowerCase());
}
