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

- [ ] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [ ] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [ ] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [ ] La règle de décision est **recalculée en code** à partir des contrôles. En cas de désaccord avec le modèle, la version la plus stricte l'emporte.
- [ ] Les étiquettes sont copiées dans les Publications.
- [ ] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [ ] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
