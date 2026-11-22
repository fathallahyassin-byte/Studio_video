import { z } from "zod";

// Jeton de session signé en HMAC-SHA256 avec AUTH_SECRET. Web Crypto uniquement :
// le même code tourne dans proxy.ts et dans les Server Components.

export const SESSION_COOKIE = "studio_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const payloadSchema = z.object({ v: z.literal(1), iat: z.number(), exp: z.number() });
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(secret: string, nowMs: number, ttlMs = SESSION_TTL_MS): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ v: 1, iat: nowMs, exp: nowMs + ttlMs })));
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, secret: string, nowMs: number): Promise<boolean> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return false;
  const signatureBytes = fromBase64Url(signature);
  const bodyBytes = fromBase64Url(body);
  if (!signatureBytes || !bodyBytes) return false;
  const authentic = await crypto.subtle.verify("HMAC", await importKey(secret), signatureBytes, encoder.encode(body));
  if (!authentic) return false;
  const payload = payloadSchema.safeParse(parseJson(decoder.decode(bodyBytes)));
  return payload.success && payload.data.exp > nowMs;
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}
