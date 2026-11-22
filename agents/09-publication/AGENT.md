# Agent 9 — Publication

Rédige les textes et réglages par plateforme et planifie la publication.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/09-publication` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{SCRIPT}}` | scriptJson |
| `{{RAPPORT_QA}}` | qaJson |
| `{{MOTS_CLES}}` | liste tenue sur sa page |
| `{{CRENEAUX}}` | créneaux recommandés par l'agent 10 |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique après une validation V3 approuvée.

## Après la sortie

Crée 3 Publications `SCHEDULED`. À l'heure prévue : publication par API si le provider est prêt, sinon notification « à publier à la main ».

## Page de l'agent : `/agents/09-publication`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Calendrier de la semaine, avec les vidéos programmées par plateforme.
- Pour une vidéo : les textes par plateforme modifiables, les hashtags, les étiquettes (en lecture seule, venues du rapport qualité).
- Mode manuel : télécharger le MP4, copier la légende, bouton « Marquer comme publié ».

## Critères d'acceptation

- [ ] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [ ] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [ ] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [ ] Aucune Publication ne peut être créée sans Validation V3 approuvée (testé).
- [ ] Les étiquettes IA du rapport qualité ne peuvent pas être décochées depuis cette page.
- [ ] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [ ] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
