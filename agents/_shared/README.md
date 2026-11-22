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

- `definition.ts` : exporte `definition`, de type `AgentDefinition<AgentJobInput, typeof outputSchema>`.
  - Le worker lance chaque agent depuis une ligne `AgentJob` : l'entrée contient `videoId` (lis le reste en base : idée, dossier, script…), `channelId`, la `note` de l'humain et un `payload` (formulaire de l'agent 1, à valider avec Zod).
  - `buildVariables` : une valeur texte par `{{VARIABLE}}` du prompt (JSON sérialisé si besoin).
  - `normalize` : les recalculs que ton AGENT.md demande « en code » (scores, confiances forcées…). Il reçoit `(sortie, input, ctx)` et peut être asynchrone ; `ctx.bible` est la bible injectée dans le prompt.
  - `controls` : les refus en code ; chaque `{ ok: false, reason }` est renvoyé au modèle. Il reçoit aussi `ctx` : relis la bible ou la base ici plutôt que de garder un état entre `buildVariables` et `controls`.
  - `onSuccess` : enregistrement et transition. **Il doit être idempotent** : après un crash, il peut être rappelé avec la même sortie.
- `ui/Panel.tsx` : exporte `Panel(props: AgentPanelProps)`, affiché sous l'en-tête générique de `/agents/[slug]`.

Pas besoin de toucher aux registres : ils importent déjà `definition` et `Panel` depuis ton dossier.

## Faire avancer la vidéo depuis `onSuccess`

Ne change jamais `Video.stage` toi-même : passe par `lib/pipeline/service.ts`, qui journalise, crée les tâches suivantes et prévient l'humain.

| Agent | Après sa sortie |
| --- | --- |
| 2 veilleur | `proposeIdeas(deps, channelId, idees, acteur)` : une Video par idée en `AWAITING_V1`, une seule notification |
| 3 recherchiste | `completeStage(..., "RESEARCH_DONE")`, ou `blockVideo(...)` avec l'angle de remplacement si `angle_a_changer` |
| 4 scénariste | `completeStage(..., "SCRIPT_DONE")` → `AWAITING_V2` |
| 5 et 6 | enregistrer `storyboardJson` / `audioJson`, puis `completeStage(..., "MEDIA_DONE")` : la vidéo n'avance qu'avec les deux |
| 7 monteur | `completeStage(..., "EDIT_DONE")` → rendu |
| 8 contrôle qualité | `QA_PASSED` si GO ou GO_AVEC_CORRECTIONS, sinon `blockVideo(...)` |
| 9 publication | crée les `Publication` (refusées en base sans V3 approuvée) |

L'acteur d'un agent est `{ kind: "agent", agentId: N }`. Une décision V1, V2 ou V3 avec un acteur agent est refusée. La note de l'humain (correction V2 ou V3, reprise) est dans `AgentJob.note`.

## Tester

Utilise `createMemoryRunStore()` (`lib/agents/memoryStore.ts`) et un faux `LlmProvider` : voir `lib/agents/runAgent.test.ts`.
