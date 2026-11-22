# Agent 7 — Monteur

Produit la timeline de rendu.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/07-monteur` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{STORYBOARD}}` | `Video.storyboardJson` |
| `{{PLAN_SONORE}}` | `Video.audioJson` |
| `{{URL_VOIX}}` | Asset voix |
| `{{DUREE_VOIX_S}}` | durée mesurée |
| `{{MOTS_HORODATES}}` | horodatage mot à mot |
| `{{MEDIAS}}` | Assets par id de plan |
| `{{SCHEMA_MOTEUR}}` | inputProps attendus par la composition Remotion |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique quand les agents 5 et 6 ont fini et que tous les médias existent.

## Après la sortie

Rendu Remotion, puis `QA`.

## Page de l'agent : `/agents/07-monteur`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Lecteur de prévisualisation (Remotion Player) avec la timeline.
- Les pistes vidéo, texte, sous-titres et audio sur une frise.
- Les alertes, comme un média manquant, et le bouton « Lancer le rendu ».

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX` (`definition.test.ts`).
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût) (`definition.test.ts`).
- [x] Les sous-titres sont recalés **en code** à partir de l'horodatage (`subtitles.ts`). L'agent ne choisit que le rythme et les transitions : durée, format, sous-titres, pistes audio et fichiers des plans sont imposés par `normalize` (`rules.ts`).
- [x] Le rendu fait 1080×1920 à 30 images/s et finit au plus 0,5 s après le dernier mot. *Couvert côté timeline* : `normalize` impose l'export et la durée (sur une image entière, entre la fin du dernier mot et 0,5 s après), `controls` le vérifie. Le rendu Remotion lui-même n'est pas branché (étape 6) : la composition doit reprendre ces valeurs telles quelles (`NEEDS.md` § 1).
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus (`*.test.ts`, `ui/timelines.test.ts`).
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action). Le Remotion Player est remplacé par une prévisualisation statique (image à l'instant choisi) tant que Remotion n'est pas installé (`NEEDS.md` § 2) ; « Lancer le rendu » est désactivé avec une note.
