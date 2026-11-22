import { z } from "zod";

const authEnvSchema = z.object({
  AUTH_SECRET: z.string().min(32),
  OWNER_EMAIL: z.email(),
  OWNER_PASSWORD_HASH: z.string().startsWith("scrypt:"),
  OWNER_TOTP_SECRET: z.string().regex(/^[A-Z2-7]{16,}$/),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export type EnvResult<T> = { ok: true; value: T } | { ok: false; invalid: string[] };

/** Variables de connexion, renseignées par `npm run auth:setup`. */
export function readAuthEnv(env: Record<string, string | undefined> = process.env): EnvResult<AuthEnv> {
  const parsed = authEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, invalid: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))] };
}
