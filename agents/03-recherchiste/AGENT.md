# Agent 3 — Recherchiste & fact-checker

Constitue le dossier factuel sourcé de chaque idée validée.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/03-recherchiste` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{IDEE}}` | `Video.ideaJson` |
| `{{SOURCES}}` | facultatif : liens que j'ajoute sur la page de la vidéo |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique dès qu'une idée est validée en V1.

## Après la sortie

`ok` ou `ok_avec_reserves` → `SCRIPT`. `angle_a_changer` → `NEEDS_FIX` et notification, avec l'angle de remplacement proposé.

## Page de l'agent : `/agents/03-recherchiste`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Liste des dossiers récents avec leur verdict.
- Pour un dossier : les faits groupés par niveau de confiance, des sources cliquables, les points sensibles.
- Un filtre « faits faibles » pour repérer les dossiers à compléter.

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] Les URL vides ou marquées « source à trouver » forcent la confiance « faible » en code.
- [x] Aucun appel au scénariste si aucun fait n'est « eleve » ou « moyen ».
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
