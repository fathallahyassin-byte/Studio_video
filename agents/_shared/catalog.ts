import type { AgentId } from "./types";

export type AgentMeta = {
  id: AgentId;
  slug: string;
  name: string;
  role: string;
  /** état au premier seed ; ensuite, c'est la base qui fait foi */
  activeByDefault: boolean;
};

/** Les 11 agents. Source unique pour le seed, le registre et l'interface. */
export const agentCatalog = [
  { id: 0, slug: "00-orchestrateur", name: "Orchestrateur", role: "Distribue le travail, contrôle chaque livrable et s'arrête aux validations.", activeByDefault: false },
  { id: 1, slug: "01-strategiste-niche", name: "Stratège de niche", role: "Note une douzaine de niches, en recommande une et rédige la bible.", activeByDefault: true },
  { id: 2, slug: "02-veilleur", name: "Veilleur", role: "Propose 20 idées notées chaque semaine.", activeByDefault: true },
  { id: 3, slug: "03-recherchiste", name: "Recherchiste & fact-checker", role: "Constitue le dossier factuel sourcé de chaque idée validée.", activeByDefault: true },
  { id: 4, slug: "04-scenariste", name: "Scénariste", role: "Écrit le script minuté et trois accroches.", activeByDefault: true },
  { id: 5, slug: "05-directeur-artistique", name: "Directeur artistique", role: "Découpe le script en plans et écrit les prompts visuels.", activeByDefault: true },
  { id: 6, slug: "06-voix-son", name: "Voix et son", role: "Prépare le texte de la voix, la musique et les effets.", activeByDefault: true },
  { id: 7, slug: "07-monteur", name: "Monteur", role: "Produit la timeline de rendu.", activeByDefault: true },
  { id: 8, slug: "08-controle-qualite", name: "Contrôle qualité", role: "Applique la check-list et rend GO ou NO-GO avec preuves.", activeByDefault: true },
  { id: 9, slug: "09-publication", name: "Publication", role: "Rédige les textes et réglages par plateforme et planifie la publication.", activeByDefault: true },
  { id: 10, slug: "10-analyste", name: "Analyste", role: "Tire les enseignements de la semaine et met à jour la bible et le backlog.", activeByDefault: true },
] as const satisfies readonly AgentMeta[];

export function getAgentMeta(id: AgentId): AgentMeta {
  const meta = agentCatalog.find((entry) => entry.id === id);
  if (!meta) throw new Error(`Agent ${id} absent du catalogue`);
  return meta;
}

/** Convertit un id lu en base en AgentId, ou lève une erreur s'il n'existe pas. */
export function parseAgentId(value: number): AgentId {
  const meta = agentCatalog.find((entry) => entry.id === value);
  if (!meta) throw new Error(`Id d'agent inconnu : ${value}`);
  return meta.id;
}

export function findAgentMetaBySlug(slug: string): AgentMeta | undefined {
  return agentCatalog.find((entry) => entry.slug === slug);
}
