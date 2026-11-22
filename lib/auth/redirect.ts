export const DEFAULT_AFTER_LOGIN = "/production";

/** N'accepte qu'un chemin interne, pour que /login?next=… ne serve pas de redirection ouverte. */
export function safeNextPath(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;
  return next;
}
