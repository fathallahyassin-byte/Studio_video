import type { z } from "zod";

export type AgentId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type AgentContext = {
  channelId: string;
  videoId: string | null;
  /** contenu de la BibleVersion active ; null tant qu'aucune bible n'est adoptée (cas de l'agent 1) */
  bible: string | null;
  bibleVersionId: string | null;
};

export type ControlResult = { ok: true } | { ok: false; reason: string };

/**
 * Contrat d'un agent. Les méthodes (et non des propriétés fléchées) permettent de ranger
 * des définitions aux entrées différentes dans le même registre.
 */
export type AgentDefinition<TInput, TSchema extends z.ZodType> = {
  id: AgentId;
  slug: string;
  name: string;
  /** chemin relatif au dossier de l'agent, chargé dans PromptVersion par le seed */
  promptFile: "prompt.md";
  outputSchema: TSchema;
  /** construit la valeur de chaque {{VARIABLE}} du prompt, sauf BIBLE (injectée par runAgent) */
  buildVariables(input: TInput, ctx: AgentContext): Promise<Record<string, string>>;
  /** recalculs faits en code après Zod (scores, confiances forcées…) ; la sortie normalisée est celle enregistrée */
  normalize?(output: z.infer<TSchema>, input: TInput): z.infer<TSchema>;
  /** contrôles faits en code après normalize ; un échec compte comme une tentative */
  controls?(output: z.infer<TSchema>, input: TInput): ControlResult[] | Promise<ControlResult[]>;
  /**
   * appelé une fois la sortie acceptée : enregistrement, transition d'étape, notifications.
   * Doit être idempotent : après un redémarrage du worker, il peut être rappelé avec la même sortie.
   */
  onSuccess(output: z.infer<TSchema>, input: TInput, ctx: AgentContext): Promise<void>;
};

/** Type commun du registre. `never` oblige à importer la définition typée pour l'exécuter. */
export type AnyAgentDefinition = AgentDefinition<never, z.ZodType>;

export type AgentPanelProps = {
  agentId: AgentId;
  slug: string;
};
