// Définition provisoire, créée par la session principale. Le fork de cet agent remplace ce fichier.
import { getAgentMeta } from "@/agents/_shared/catalog";
import { createPlaceholderDefinition } from "@/agents/_shared/placeholder";
import { outputSchema } from "./schema";

export const definition = createPlaceholderDefinition(getAgentMeta(5), outputSchema);
