"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCredentials } from "@/lib/auth/credentials";
import { loginRateLimiter, startOwnerSession, totpReplayGuard } from "@/lib/auth/owner";
import { safeNextPath } from "@/lib/auth/redirect";
import { readAuthEnv } from "@/lib/env";

/** L'e-mail est renvoyé pour que le formulaire le garde après une erreur (React le vide sinon). */
export type LoginState = { error: string | null; email: string };

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/),
  next: z.string().optional(),
});

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const submittedEmail = formData.get("email");
  const email = typeof submittedEmail === "string" ? submittedEmail.trim() : "";
  const env = readAuthEnv();
  if (!env.ok) return { email, error: "La connexion n'est pas configurée : lance « npm run auth:setup », puis redémarre l'appli." };

  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { email, error: "Renseigne l'e-mail, le mot de passe et le code à 6 chiffres." };

  const now = Date.now();
  const waitMs = loginRateLimiter.retryAfterMs(now);
  if (waitMs > 0) return { email, error: `Trop de tentatives. Réessaie dans ${Math.ceil(waitMs / 60_000)} min.` };

  const owner = { email: env.value.OWNER_EMAIL, passwordHash: env.value.OWNER_PASSWORD_HASH, totpSecret: env.value.OWNER_TOTP_SECRET };
  if (!(await checkCredentials(parsed.data, owner, now, totpReplayGuard))) {
    loginRateLimiter.recordFailure(now);
    return { email, error: "E-mail, mot de passe ou code incorrect." };
  }

  loginRateLimiter.reset();
  await startOwnerSession(env.value.AUTH_SECRET);
  redirect(safeNextPath(parsed.data.next));
}
