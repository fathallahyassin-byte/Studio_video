# Agent 10 — Analyste

Tire les enseignements de la semaine et met à jour la bible et le backlog.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork |
| `ui/Panel.tsx` | contenu de la page `/agents/10-analyste` | ce fork |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{STATS}}` | Stats des 4 dernières semaines |
| `{{METADONNEES}}` | pilier, format, accroche, durée, créneau et version des prompts de chaque vidéo |
| `{{EXPERIENCES}}` | expériences en cours |
| `{{CRITERE_NICHE}}` | `objectifs.critere_validation_niche` de la bible |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Cron le lundi à 6 h, après l'import des statistiques, plus un bouton sur sa page.

## Après la sortie

Crée un rapport. « Appliquer à la bible » crée une BibleVersion avec les apprentissages ajoutés.

## Page de l'agent : `/agents/10-analyste`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Le dernier rapport : résumé, top 3 et flop 3, enseignements avec leur niveau de confiance.
- Les expériences proposées et un bouton « Lancer » pour chacune.
- Le verdict sur la niche et sa justification.
- Le bouton « Appliquer à la bible ».

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] Les médianes par plateforme sont calculées en code et passées au modèle : il ne calcule rien lui-même.
- [x] Les vidéos de moins de 72 h sont exclues des comparaisons.
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
