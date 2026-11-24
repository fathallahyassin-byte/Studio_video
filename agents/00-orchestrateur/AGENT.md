# Agent 0 — Orchestrateur

Distribue le travail, contrôle chaque livrable et s'arrête aux validations.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/00-orchestrateur` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{ETAT_PROJET}}` | la Video et ses AgentRun |
| `{{BUDGET_PAR_VIDEO}}` | `.env` |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Facultatif et **désactivé par défaut** : la machine à états de `lib/pipeline/` fait déjà ce travail. À activer seulement si je le demande.

## Après la sortie

Aucune transition d'étape : il propose la prochaine action, la machine à états décide.

## Page de l'agent : `/agents/00-orchestrateur`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Interrupteur Activé / Désactivé (désactivé par défaut).
- Journal de production des 50 dernières actions (date, vidéo, agent, action).
- Pour chaque vidéo bloquée : la question posée à l'humain et un champ de réponse.

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts` (ports en lecture seule, `onSuccess` sans transition).
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX` (voir NEEDS.md, point 3).
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] Désactivé, il n'est jamais appelé (refusé par `runAgent` et par la définition ; le déclenchement reste à brancher, voir NEEDS.md).
- [x] Activé, sa sortie ne peut pas faire sauter une validation V1, V2 ou V3 (vérifié par un test : `rules.test.ts`, `definition.test.ts`).
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
