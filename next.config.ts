import type { NextConfig } from "next";

// Envoi du fichier d'un plan (agents/05-directeur-artistique, « Ajouter le fichier du plan ») : jusqu'à 50 Mo.
// Garder en phase avec PLAN_FILE_MAX_BYTES (agents/05-directeur-artistique/ui/limits.ts), avec une marge pour le reste du formulaire.
const UPLOAD_BODY_LIMIT = "52mb";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dossier de build séparé pour l'e2e : il tourne à côté du `npm run dev` habituel.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: { bodySizeLimit: UPLOAD_BODY_LIMIT },
    // proxy.ts lit chaque requête : sans ce réglage, le corps est coupé à 10 Mo.
    proxyClientMaxBodySize: UPLOAD_BODY_LIMIT,
  },
};

export default nextConfig;
