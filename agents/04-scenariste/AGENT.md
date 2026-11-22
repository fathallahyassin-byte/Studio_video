# Agent 4 — Scénariste

Écrit le script minuté et trois accroches.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork |
| `rules.ts`, `variables.ts`, `ports.ts` | contrôles et recalculs en code, variables du prompt, accès base et pipeline | ce fork |
| `ui/Panel.tsx` (+ `ui/*`) | contenu de la page `/agents/04-scenariste` | ce fork |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{IDEE}}` | `Video.ideaJson` |
| `{{DOSSIER}}` | `Video.dossierJson` |
| `{{APPRENTISSAGES}}` | dernier rapport de l'agent 10 |
| `{{DERNIERS_SCRIPTS}}` | les 5 derniers scripts publiés |
| `{{DUREE_S}}` | milieu de `duree_cible_s` de la bible |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique après un dossier `ok` ou `ok_avec_reserves`.

## Après la sortie

`AWAITING_V2` et notification.

## Page de l'agent : `/agents/04-scenariste`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Les scripts récents avec leur statut V2.
- Pour un script : les 3 accroches côte à côte, les beats sur une frise minutée, les ids de faits cliquables qui ouvrent le fait dans le dossier.
- Les compteurs : mots, durée estimée, écart avec la cible.

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] Un script qui cite un fait inconnu ou « faible » est rejeté **en code** et renvoyé à l'agent (compte comme une tentative).
- [x] Le nombre de mots est recompté en code et comparé à durée × débit (tolérance de 5 %).
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
