# Agent 8 — Contrôle qualité

Applique la check-list et rend GO ou NO-GO avec preuves.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/08-controle-qualite` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{DOSSIER}}` | dossierJson |
| `{{SCRIPT}}` | scriptJson |
| `{{STORYBOARD}}` | storyboardJson |
| `{{PLAN_SONORE}}` | audioJson |
| `{{TIMELINE}}` | timelineJson |
| `{{TRANSCRIPTION}}` | Whisper sur le rendu final |
| `{{CAPTURES}}` | descriptions de 5 images clés |
| `{{PARTENARIAT}}` | champ de la vidéo, « aucun » par défaut |
| `{{HISTORIQUE}}` | les 10 dernières vidéos publiées |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique après le rendu.

## Après la sortie

GO ou GO_AVEC_CORRECTIONS → `AWAITING_V3` et notification. NO_GO → `NEEDS_FIX`, renvoyé à `agent_responsable`.

## Page de l'agent : `/agents/08-controle-qualite`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Les rapports récents avec leur décision.
- Pour un rapport : la check-list A à F avec ok, ko ou na et la preuve, les étiquettes par plateforme, les mentions à incruster.
- Un lien vers la vidéo rendue.

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] La règle de décision est **recalculée en code** à partir des contrôles. En cas de désaccord avec le modèle, la version la plus stricte l'emporte.
- [x] Les étiquettes sont copiées dans les Publications. Côté agent 8 : enregistrées dans `qaJson` et converties par `labels.ts` (`readPublicationLabels`) dans la forme de `Publication.aiLabel` / `brandedContent`. Le branchement à la création des `Publication` revient à l'agent 9 (`NEEDS.md`, point 2).
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).

## Fichiers du fork

| Fichier | Rôle |
| --- | --- |
| `checklist.ts` | les 16 points, la règle de décision, les sources dont chaque point a besoin, l'agent responsable |
| `rules.ts` | `normalizeReport` (recalculs) et `checkReport` (refus renvoyés au modèle), fonctions pures |
| `variables.ts` | lecture des sources et texte des 10 variables ; « NON DISPONIBLE » pour une source absente |
| `ports.ts` | accès à la base et au pipeline, injectables (faux dans les tests) |
| `labels.ts` | étiquettes du rapport dans la forme des colonnes de `Publication` |
| `ui/` | `Panel.tsx` (serveur), `loadReports.ts`, modèle de vue `reports.ts`, `ReportBrowser.tsx` (client) |
