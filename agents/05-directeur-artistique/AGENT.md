# Agent 5 — Directeur artistique

Découpe le script en plans et écrit les prompts visuels.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/05-directeur-artistique` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{SCRIPT}}` | `Video.scriptJson` |
| `{{OUTILS_VISUELS}}` | liste des providers `videoGen` et `imageGen` configurés |
| `{{BUDGET_SECONDES_VIDEO_IA}}` | `.env` |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique après une validation V2, **en parallèle** de l'agent 6.

## Après la sortie

Génère les médias plan par plan via les providers, puis passe à `EDIT` quand l'agent 6 a fini lui aussi.

## Page de l'agent : `/agents/05-directeur-artistique`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Grille de vignettes 9:16, une par plan : type, durée, prompt, label IA.
- Bouton « Régénérer ce plan », avec un prompt modifiable avant la relance.
- Le total des secondes de vidéo IA comparé au budget.

## Critères d'acceptation

- [ ] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [ ] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [ ] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [ ] `secondes_video_ia` est recalculé en code. Au-delà du budget, on s'arrête et on alerte.
- [ ] Les plans couvrent toute la durée du script, sans trou ni chevauchement.
- [ ] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [ ] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
