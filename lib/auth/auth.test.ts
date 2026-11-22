import { describe, expect, it } from "vitest";
import { upsertEnvValues } from "@/lib/envFile";
import { readAuthEnv } from "@/lib/env";
import { checkCredentials, type TotpReplayGuard } from "./credentials";
import { hashPassword, verifyPassword } from "./password";
import { createRateLimiter } from "./rateLimit";
import { safeNextPath } from "./redirect";
import { createSessionToken, verifySessionToken } from "./session";
import { base32Decode, base32Encode, hotp, totpCounter, verifyTotp } from "./totp";

// Clé des vecteurs de test des RFC 4226 et 6238 : "12345678901234567890" en ASCII.
const RFC_SECRET = Buffer.from("12345678901234567890");
const RFC_SECRET_BASE32 = base32Encode(RFC_SECRET);

describe("TOTP", () => {
  it("encode et décode le base32 de la RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode(RFC_SECRET_BASE32)).toEqual(RFC_SECRET);
  });

  it("donne les codes HOTP de la RFC 4226", () => {
    expect([0, 1, 2, 3, 9].map((counter) => hotp(RFC_SECRET, counter))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("donne le code TOTP de la RFC 6238 à t=%i", (seconds, expected) => {
    expect(hotp(RFC_SECRET, totpCounter(seconds * 1000), 8)).toBe(expected);
  });

  it("accepte un pas d'écart d'horloge, pas deux", () => {
    const now = 1234567890 * 1000;
    const code = hotp(RFC_SECRET, totpCounter(now) - 1);
    expect(verifyTotp(RFC_SECRET_BASE32, code, now)).toBe(totpCounter(now) - 1);
    expect(verifyTotp(RFC_SECRET_BASE32, hotp(RFC_SECRET, totpCounter(now) - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET_BASE32, "12345", now)).toBeNull();
  });
});

describe("mot de passe", () => {
  it("vérifie le bon mot de passe et refuse les autres", async () => {
    const hash = await hashPassword("une phrase assez longue");
    expect(hash).toMatch(/^scrypt:32768:8:1:[\w-]+:[\w-]+$/);
    expect(hash).not.toContain("$");
    await expect(verifyPassword("une phrase assez longue", hash)).resolves.toBe(true);
    await expect(verifyPassword("une autre phrase", hash)).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt:abc")).resolves.toBe(false);
  });
});

describe("session", () => {
  const secret = "s".repeat(40);
  const now = 1_800_000_000_000;

  it("accepte un jeton valide jusqu'à son expiration", async () => {
    const token = await createSessionToken(secret, now, 1000);
    await expect(verifySessionToken(token, secret, now + 999)).resolves.toBe(true);
    await expect(verifySessionToken(token, secret, now + 1000)).resolves.toBe(false);
  });

  it("refuse un jeton signé avec un autre secret ou modifié", async () => {
    const token = await createSessionToken(secret, now);
    const [body, signature] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now * 2 })).toString("base64url");
    await expect(verifySessionToken(token, "t".repeat(40), now)).resolves.toBe(false);
    await expect(verifySessionToken(`${forgedBody}.${signature}`, secret, now)).resolves.toBe(false);
    await expect(verifySessionToken(`${body}.`, secret, now)).resolves.toBe(false);
    await expect(verifySessionToken("n'importe quoi", secret, now)).resolves.toBe(false);
  });
});

describe("checkCredentials", () => {
  const now = 1_800_000_000_000;

  async function owner() {
    return { email: "moi@example.test", passwordHash: await hashPassword("mot de passe test"), totpSecret: RFC_SECRET_BASE32 };
  }

  it("connecte avec les trois éléments, puis refuse le même code une seconde fois", async () => {
    const credentials = await owner();
    const guard: TotpReplayGuard = { lastCounter: null };
    const attempt = { email: " Moi@Example.test ", password: "mot de passe test", code: hotp(RFC_SECRET, totpCounter(now)) };

    await expect(checkCredentials(attempt, credentials, now, guard)).resolves.toBe(true);
    await expect(checkCredentials(attempt, credentials, now, guard)).resolves.toBe(false);
  });

  it.each([
    ["l'e-mail", { email: "autre@example.test" }],
    ["le mot de passe", { password: "faux" }],
    ["le code", { code: "000000" }],
  ])("refuse si %s est faux", async (_label, change) => {
    const credentials = await owner();
    const attempt = { email: "moi@example.test", password: "mot de passe test", code: hotp(RFC_SECRET, totpCounter(now)), ...change };
    await expect(checkCredentials(attempt, credentials, now, { lastCounter: null })).resolves.toBe(false);
  });
});

describe("limite des tentatives", () => {
  it("bloque après le nombre d'échecs puis libère à la fin de la fenêtre", () => {
    const limiter = createRateLimiter({ maxFailures: 3, windowMs: 1000 });
    [0, 10, 20].forEach((at) => limiter.recordFailure(at));
    expect(limiter.retryAfterMs(30)).toBe(970);
    expect(limiter.retryAfterMs(1000)).toBe(0);
    limiter.recordFailure(1001);
    limiter.reset();
    expect(limiter.retryAfterMs(1002)).toBe(0);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/agents/04-scenariste?onglet=prompt", "/agents/04-scenariste?onglet=prompt"],
    [undefined, "/production"],
    ["https://exemple.test", "/production"],
    ["//exemple.test", "/production"],
    ["/\\exemple.test", "/production"],
  ])("%s → %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});

describe("configuration", () => {
  it("liste les variables de connexion manquantes", () => {
    expect(readAuthEnv({ OWNER_EMAIL: "moi@example.test" })).toEqual({
      ok: false,
      invalid: ["AUTH_SECRET", "OWNER_PASSWORD_HASH", "OWNER_TOTP_SECRET"],
    });
  });

  it("met à jour .env.local sans toucher aux autres lignes", () => {
    const before = '# commentaire\r\nDATABASE_URL="postgresql://x"\r\nOWNER_EMAIL="ancien@example.test"\r\n';
    expect(upsertEnvValues(before, { OWNER_EMAIL: "moi@example.test", AUTH_SECRET: "abc" })).toBe(
      '# commentaire\nDATABASE_URL="postgresql://x"\nOWNER_EMAIL="moi@example.test"\nAUTH_SECRET="abc"\n',
    );
    expect(() => upsertEnvValues("", { A: "a$b" })).toThrow();
  });
});
