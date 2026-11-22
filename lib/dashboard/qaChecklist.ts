// Libellés courts de la check-list du contrôle qualité (agents/08-controle-qualite/prompt.md), pour l'écran V3.

const LABELS: Record<string, string> = {
  A1: "Faits conformes au dossier",
  A2: "Chiffres, dates et noms exacts",
  B1: "Apport original",
  B2: "Différente des 10 dernières",
  C1: "Musique et effets sous licence",
  C2: "Aucun contenu protégé",
  D1: "Étiquettes IA",
  D2: "Mention « Images générées par IA »",
  D3: "Mention de partenariat",
  D4: "Mention « Images virtuelles »",
  D5: "Pas de faux expert",
  E1: "Format et durée",
  E2: "Sous-titres",
  E3: "Son autour de −14 LUFS",
  E4: "Première image et boucle",
  F1: "Respect de la bible",
};

export function qaCheckLabel(id: string): string {
  return LABELS[id] ?? id;
}

export const qaStatusLabels = { ok: "OK", ko: "À corriger", na: "Sans objet" } as const;

export const qaDecisionLabels = {
  GO: "GO",
  GO_AVEC_CORRECTIONS: "GO avec corrections",
  NO_GO: "NO-GO",
} as const;
