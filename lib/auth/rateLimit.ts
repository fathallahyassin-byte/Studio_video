export type RateLimiter = {
  /** 0 si une tentative est permise, sinon le temps d'attente en ms */
  retryAfterMs(nowMs: number): number;
  recordFailure(nowMs: number): void;
  reset(): void;
};

/**
 * Limite globale des échecs de connexion. Un seul compte : une limite par IP se contournerait
 * en changeant d'en-tête X-Forwarded-For.
 */
export function createRateLimiter(options: { maxFailures: number; windowMs: number }): RateLimiter {
  let failures: number[] = [];
  const prune = (nowMs: number) => {
    failures = failures.filter((at) => nowMs - at < options.windowMs);
  };
  return {
    retryAfterMs(nowMs) {
      prune(nowMs);
      const oldest = failures[0];
      if (failures.length < options.maxFailures || oldest === undefined) return 0;
      return oldest + options.windowMs - nowMs;
    },
    recordFailure(nowMs) {
      prune(nowMs);
      failures.push(nowMs);
    },
    reset() {
      failures = [];
    },
  };
}
