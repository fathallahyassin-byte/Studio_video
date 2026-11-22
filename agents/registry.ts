// Registre des définitions d'agents. Session principale uniquement : un fork remplace son
// definition.ts sans toucher à ce fichier. L'interface (ui/Panel.tsx) est dans agents/panels.ts,
// pour que le worker n'importe pas de React.
import { definition as agent00 } from "./00-orchestrateur/definition";
import { definition as agent01 } from "./01-strategiste-niche/definition";
import { definition as agent02 } from "./02-veilleur/definition";
import { definition as agent03 } from "./03-recherchiste/definition";
import { definition as agent04 } from "./04-scenariste/definition";
import { definition as agent05 } from "./05-directeur-artistique/definition";
import { definition as agent06 } from "./06-voix-son/definition";
import { definition as agent07 } from "./07-monteur/definition";
import { definition as agent08 } from "./08-controle-qualite/definition";
import { definition as agent09 } from "./09-publication/definition";
import { definition as agent10 } from "./10-analyste/definition";
import type { AgentId, AnyAgentDefinition } from "./_shared/types";

export const agentRegistry = {
  0: agent00,
  1: agent01,
  2: agent02,
  3: agent03,
  4: agent04,
  5: agent05,
  6: agent06,
  7: agent07,
  8: agent08,
  9: agent09,
  10: agent10,
} satisfies Record<AgentId, AnyAgentDefinition>;

export function listAgentDefinitions(): AnyAgentDefinition[] {
  return Object.values(agentRegistry);
}
