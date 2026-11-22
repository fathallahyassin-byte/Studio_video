# Contrat commun des agents

Session principale uniquement : un fork ne modifie aucun fichier de ce dossier, ni `agents/registry.ts`, ni `agents/panels.ts`.

## Fichiers

- `types.ts` : `AgentDefinition`, `AgentContext`, `AgentPanelProps`.
- `catalog.ts` : les 11 agents (id, slug, nom, rôle). Source unique pour le seed, le registre et l'interface. Dans ta définition, reprends `id`, `slug` et `name` avec `getAgentMeta(N)`.
- `placeholder.ts` et `PlaceholderPanel.tsx` : la définition et le panneau provisoires, qui affichent « Agent à implémenter ».

## Ce que fait `lib/agents/runAgent.ts`

1. Si la `jobKey` a déjà une tentative réussie, il renvoie la sortie enregistrée sans rappeler le modèle (et rejoue `onSuccess` seulement s'il n'avait pas fini).
2. Il charge l'agent en base : actif, modèle réglé, PromptVersion active. Sinon : erreur, aucun appel.
3. Il charge la bible active de la chaîne (`null` s'il n'y en a pas encore : cas de l'agent 1).
4. Il appelle `buildVariables`, puis remplace `{{BIBLE}}` et les autres variables en une seule passe. Une variable non remplacée = erreur, aucun appel. Une clé `BIBLE` renvoyée par `buildVariables` est ignorée.
5. Il appelle le provider LLM, extrait le JSON (même entre balises de code), le valide avec `outputSchema`, applique `normalize`, puis `controls`.
6. En cas d'échec, il relance avec le message d'erreur (2 relances au maximum). Au 3ᵉ échec, la vidéo passe en `NEEDS_FIX` et l'humain est alerté.
7. Il enregistre un AgentRun à chaque tentative (`OK`, `INVALID_JSON`, `CONTROL_FAILED`, `ERROR`), avec tokens, coût et durée, et ajoute le coût à la vidéo.
8. Il appelle `onSuccess` avec la sortie normalisée.

## Ce que ton fork écrit

- `definition.ts` : exporte `definition`, de type `AgentDefinition<TonEntree, typeof outputSchema>`.
  - `buildVariables` : une valeur texte par `{{VARIABLE}}` du prompt (JSON sérialisé si besoin).
  - `normalize` : les recalculs que ton AGENT.md demande « en code » (scores, confiances forcées…).
  - `controls` : les refus en code ; chaque `{ ok: false, reason }` est renvoyé au modèle.
  - `onSuccess` : enregistrement et transition. **Il doit être idempotent** : après un crash, il peut être rappelé avec la même sortie.
- `ui/Panel.tsx` : exporte `Panel(props: AgentPanelProps)`, affiché sous l'en-tête générique de `/agents/[slug]`.

Pas besoin de toucher aux registres : ils importent déjà `definition` et `Panel` depuis ton dossier.

## Tester

Utilise `createMemoryRunStore()` (`lib/agents/memoryStore.ts`) et un faux `LlmProvider` : voir `lib/agents/runAgent.test.ts`.
