// Compte et secrets de TEST, uniquement pour la base jetable de l'e2e (E2E_DATABASE_URL).
// Ils ne servent jamais ailleurs : le vrai compte vient de `npm run auth:setup` dans .env.local.

export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export const e2eOwner = {
  email: "e2e@studio.test",
  password: "e2e-mot-de-passe-jetable",
  passwordHash: "scrypt:32768:8:1:2uItTlFw3vRK4jHHkYLq4A:SP2f8acM4v0y9B5ig5lMhSj_rnfvWaGlNlevD1GdXEw",
  totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  authSecret: "e2e-secret-de-session-jetable-0123456789abcdef",
};

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL manquant : base jetable, VIDÉE à chaque lancement de npm run test:e2e.");
  return url;
}
