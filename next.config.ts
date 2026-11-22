import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dossier de build séparé pour l'e2e : il tourne à côté du `npm run dev` habituel.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
