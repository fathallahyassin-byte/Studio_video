# Agent 2 — Veilleur

Propose 20 idées notées chaque semaine.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/02-veilleur` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{SIGNAUX}}` | zone de texte de sa page (tendances, commentaires, questions…) |
| `{{APPRENTISSAGES}}` | enseignements du dernier rapport de l'agent 10 |
| `{{BACKLOG_EXISTANT}}` | titres des Videos des 90 derniers jours |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Cron le lundi à 7 h, plus un bouton « Lancer la veille » sur sa page et sur l'écran Production.

## Après la sortie

Crée une Video par idée, à l'étape `AWAITING_V1`, et envoie une notification.

## Page de l'agent : `/agents/02-veilleur`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Champ « Signaux de la semaine » conservé d'une semaine à l'autre.
- Les 20 idées de la dernière veille triées par score, avec le badge « hypothèse » quand il s'applique.
- Les séries proposées et les idées écartées, avec la raison.
- Le bouton « Lancer la veille ».

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] Le score est recalculé en code (moyenne des 5 notes, +0,5 / −1).
- [x] Une idée trop proche d'un titre existant est signalée (similarité simple sur les titres).
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).

## Implémentation (fork)

| Fichier | Contenu |
| --- | --- |
| `definition.ts` | `createScoutDefinition(store, horloge)` et `definition` (branchée sur PostgreSQL) |
| `variables.ts` | texte de `{{SIGNAUX}}`, `{{APPRENTISSAGES}}`, `{{BACKLOG_EXISTANT}}` (jamais vide : « aucun… ») |
| `rules.ts` | `normalize` et `controls`, en fonctions pures |
| `similarity.ts` | similarité des titres (mots significatifs communs, coefficient de Dice, seuil 0,6) |
| `proposals.ts` | `onSuccess` : une Video par idée via `proposeIdeas`, idempotent |
| `prismaStore.ts` | accès à la base du veilleur |
| `settings.ts` | signaux de la semaine dans `Agent.settings` |
| `ui/` | panneau, formulaires et Server Actions (`requireOwner()`) |

- **Score** : moyenne des 5 notes, arrondie au dixième. Le +0,5 n'est pas visible dans la sortie : il est déduit de l'écart entre le score du modèle et la moyenne, et accordé seulement si l'analyste a donné au moins un enseignement. Le −1 s'applique si le modèle l'a appliqué ou si le code trouve un titre proche parmi les vidéos des 90 derniers jours.
- **Autres recalculs** : `semaine` fixée par le code (le prompt ne donne pas la date) ; sans signaux, toutes les idées passent en `hypothese: true` ; tri par score décroissant.
- **Refus en code** : identifiants en double, pilier au-dessus de 40 %, pilier absent de la bible (quand elle en donne), autre chose que 3 séries, deux idées qui donneraient la même vidéo (similarité ≥ 0,75), sujet interdit de la bible cité mot pour mot.
- **Signal « trop proche »** : `ideaJson.proche_de` (titre existant ou `null`), affiché sur le panneau. `ideaJson.veille` (`semaine`, `jobId`) sert à rejouer `onSuccess` sans doublon.
- **Échec** : la veille n'a pas de vidéo ; après 3 échecs, `runAgent` alerte l'humain avec un lien vers cette page.
