import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Format : scrypt:N:r:p:sel:hash (base64url). Pas de « $ » : Next.js développerait les variables dans .env.local.

const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const maxmem = 256 * params.N * params.r;
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...params, maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash, extra] = stored.split(":");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash || extra !== undefined) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Object.values(params).every((value) => Number.isInteger(value) && value > 0)) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(salt, "base64url"), params);
  return timingSafeEqual(actual, expected);
}
