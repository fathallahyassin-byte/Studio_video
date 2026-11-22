import { verifyPassword } from "./password";
import { verifyTotp } from "./totp";

export type OwnerCredentials = {
  email: string;
  passwordHash: string;
  totpSecret: string;
};

export type LoginAttempt = {
  email: string;
  password: string;
  code: string;
};

/** Mémorise le dernier pas TOTP accepté : un code déjà utilisé est refusé. */
export type TotpReplayGuard = {
  lastCounter: number | null;
};

export async function checkCredentials(
  attempt: LoginAttempt,
  owner: OwnerCredentials,
  nowMs: number,
  guard: TotpReplayGuard,
): Promise<boolean> {
  const emailMatches = attempt.email.trim().toLowerCase() === owner.email.trim().toLowerCase();
  // Le mot de passe est toujours vérifié, pour ne pas révéler par le temps de réponse si l'e-mail est le bon.
  const passwordMatches = await verifyPassword(attempt.password, owner.passwordHash);
  const counter = verifyTotp(owner.totpSecret, attempt.code.trim(), nowMs);
  const codeIsFresh = counter !== null && (guard.lastCounter === null || counter > guard.lastCounter);
  if (!emailMatches || !passwordMatches || !codeIsFresh) return false;
  guard.lastCounter = counter;
  return true;
}
