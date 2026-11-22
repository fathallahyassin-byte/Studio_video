# Agent 6 — Voix et son

Prépare le texte de la voix, la musique et les effets.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/06-voix-son` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{BIBLE}}` | dernière BibleVersion |
| `{{SCRIPT}}` | `Video.scriptJson` |
| `{{STORYBOARD}}` | `Video.storyboardJson` (s'il existe déjà, sinon les beats) |
| `{{TTS}}` | nom du provider TTS |
| `{{BALISES_TTS}}` | balises acceptées, déclarées par le provider |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Automatique après une validation V2, **en parallèle** de l'agent 5.

## Après la sortie

Génère la voix via le provider TTS, récupère l'horodatage mot à mot (ou lance Whisper) et choisit une musique sous licence.

## Page de l'agent : `/agents/06-voix-son`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Le texte TTS, modifiable, avec la liste des prononciations.
- Un lecteur audio pour la voix générée et un bouton « Régénérer la voix ».
- Le brief musique, la piste choisie et sa licence (champ obligatoire).

## Critères d'acceptation

- [ ] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [ ] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [ ] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [ ] La durée réelle de la voix est mesurée. Hors cible, on revient vers les coupes proposées.
- [ ] Pas d'Asset musique sans licence enregistrée.
- [ ] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [ ] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
