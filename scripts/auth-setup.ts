// Crée ou remplace le compte de connexion : `npm run auth:setup`.
// Écrit OWNER_EMAIL, OWNER_PASSWORD_HASH, OWNER_TOTP_SECRET (et AUTH_SECRET s'il manque) dans .env.local.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/auth/totp";
import { upsertEnvValues } from "@/lib/envFile";

const MIN_PASSWORD_LENGTH = 12;
const ENV_FILE = path.join(process.cwd(), ".env.local");

type Prompter = {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  close(): void;
};

function createPrompter(): Prompter {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve));
  return {
    ask: (text) => question(text),
    async askHidden(text) {
      process.stdout.write(text);
      muted = true;
      const answer = await question("");
      muted = false;
      process.stdout.write("\n");
      return answer;
    },
    close: () => rl.close(),
  };
}

async function askEmail(io: Prompter, current: string | undefined): Promise<string> {
  for (;;) {
    const answer = (await io.ask(`E-mail du compte${current ? ` [${current}]` : ""} : `)).trim() || current || "";
    if (z.email().safeParse(answer).success) return answer;
    console.log("Adresse invalide.");
  }
}

async function askPassword(io: Prompter): Promise<string> {
  for (;;) {
    const password = await io.askHidden(`Mot de passe (${MIN_PASSWORD_LENGTH} caractères minimum) : `);
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.log("Trop court.");
      continue;
    }
    if ((await io.askHidden("Confirme le mot de passe : ")) === password) return password;
    console.log("Les deux saisies diffèrent.");
  }
}

async function confirmTotp(io: Prompter, secret: string, email: string): Promise<void> {
  console.log("\nAjoute ce compte dans ton application d'authentification (saisie manuelle de la clé) :");
  console.log(`  Clé  : ${secret.match(/.{1,4}/g)?.join(" ") ?? secret}`);
  console.log(`  Lien : ${totpUri({ secret, account: email, issuer: "Studio" })}\n`);
  for (;;) {
    const code = (await io.ask("Code à 6 chiffres affiché par l'application : ")).trim();
    if (verifyTotp(secret, code, Date.now()) !== null) return;
    console.log("Code refusé. Vérifie l'heure de ton téléphone et réessaie.");
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const io = createPrompter();
  try {
    const email = await askEmail(io, process.env.OWNER_EMAIL);
    const passwordHash = await hashPassword(await askPassword(io));
    const totpSecret = generateTotpSecret();
    await confirmTotp(io, totpSecret, email);

    const values: Record<string, string> = { OWNER_EMAIL: email, OWNER_PASSWORD_HASH: passwordHash, OWNER_TOTP_SECRET: totpSecret };
    const authSecret = process.env.AUTH_SECRET ?? "";
    if (authSecret.length < 32) values.AUTH_SECRET = randomBytes(48).toString("base64url");

    const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
    writeFileSync(ENV_FILE, upsertEnvValues(current, values), { mode: 0o600 });
    console.log("\nCompte enregistré dans .env.local. Redémarre « npm run dev » pour qu'il soit pris en compte.");
  } finally {
    io.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
