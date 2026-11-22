import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readAuthEnv } from "@/lib/env";
import { createRateLimiter } from "./rateLimit";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS, verifySessionToken } from "./session";
import type { TotpReplayGuard } from "./credentials";

// État de connexion du processus : un seul compte, une seule instance de l'appli.
export const loginRateLimiter = createRateLimiter({ maxFailures: 10, windowMs: 15 * 60 * 1000 });
export const totpReplayGuard: TotpReplayGuard = { lastCounter: null };

export async function isOwnerSession(): Promise<boolean> {
  // Lire le cookie en premier rend la page dynamique : sinon Next.js prérendrait une redirection au build.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const env = readAuthEnv();
  if (!env.ok || token === undefined) return false;
  return verifySessionToken(token, env.value.AUTH_SECRET, Date.now());
}

/** À appeler dans chaque layout protégé, Server Action et route handler, en plus de proxy.ts. */
export async function requireOwner(): Promise<void> {
  if (!(await isOwnerSession())) redirect("/login");
}

export async function startOwnerSession(secret: string): Promise<void> {
  const token = await createSessionToken(secret, Date.now());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endOwnerSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
