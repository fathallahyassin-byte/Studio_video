// Registre des panneaux d'agents, affichés par app/(dashboard)/agents/[slug]. Session principale uniquement.
import type { ComponentType } from "react";
import { Panel as Panel00 } from "./00-orchestrateur/ui/Panel";
import { Panel as Panel01 } from "./01-strategiste-niche/ui/Panel";
import { Panel as Panel02 } from "./02-veilleur/ui/Panel";
import { Panel as Panel03 } from "./03-recherchiste/ui/Panel";
import { Panel as Panel04 } from "./04-scenariste/ui/Panel";
import { Panel as Panel05 } from "./05-directeur-artistique/ui/Panel";
import { Panel as Panel06 } from "./06-voix-son/ui/Panel";
import { Panel as Panel07 } from "./07-monteur/ui/Panel";
import { Panel as Panel08 } from "./08-controle-qualite/ui/Panel";
import { Panel as Panel09 } from "./09-publication/ui/Panel";
import { Panel as Panel10 } from "./10-analyste/ui/Panel";
import type { AgentId, AgentPanelProps } from "./_shared/types";

export const agentPanels: Record<AgentId, ComponentType<AgentPanelProps>> = {
  0: Panel00,
  1: Panel01,
  2: Panel02,
  3: Panel03,
  4: Panel04,
  5: Panel05,
  6: Panel06,
  7: Panel07,
  8: Panel08,
  9: Panel09,
  10: Panel10,
};
