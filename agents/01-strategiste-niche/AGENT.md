# Agent 1 — Stratège de niche

Note une douzaine de niches, en recommande une et rédige la bible.

Ce dossier est le seul que ton fork modifie (voir `docs/FORKS.md`).

## Fichiers

| Fichier | Rôle | Qui le modifie |
| --- | --- | --- |
| `prompt.md` | prompt système de l'agent | personne sans ma demande |
| `schema.ts` | schéma Zod de la sortie | ce fork, si le prompt l'exige |
| `definition.ts` | `AgentDefinition` : variables, schéma, contrôles en code | ce fork (à créer) |
| `ui/Panel.tsx` | contenu de la page `/agents/01-strategiste-niche` | ce fork (à créer) |
| `NEEDS.md` | besoins hors de ce dossier, pour la session principale | ce fork |

## Entrées (variables du prompt)

| Variable | Source |
| --- | --- |
| `{{PISTES_NICHES}}` | formulaire de sa page |
| `{{CONTRAINTES}}` | formulaire de sa page |
| `{{OBJECTIF_MONETISATION}}` | formulaire de sa page |
| `{{MODELE_BIBLE}}` | `docs/bible.template.yaml` |

Une variable non remplacée = erreur, l'appel n'est pas lancé.

## Déclenchement

Manuel, depuis sa page : au lancement, puis une fois par mois.

## Après la sortie

Crée une BibleVersion **en brouillon**. Elle ne devient active que quand je clique sur « Adopter cette bible ».

## Page de l'agent : `/agents/01-strategiste-niche`

La page générique (en-tête, modèle, éditeur de prompt, historique des AgentRun) est fournie par la session principale. Ce fork écrit uniquement `ui/Panel.tsx`, qui s'affiche sous l'en-tête :

- Formulaire : pistes (une par ligne), heures par semaine, budget mensuel, objectif de revenus, ce que je refuse de faire.
- Tableau des niches candidates, trié par score pondéré, avec les 7 notes et leur justification au survol.
- Le top 3 avec les 10 titres d'exemple, la recommandation et ses risques, le plan de test.
- Aperçu de la bible proposée, comparée à la bible active, et un bouton « Adopter cette bible ».

## Critères d'acceptation

- [x] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [x] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [x] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [x] Le score pondéré est **recalculé en code** à partir des notes : on n'utilise pas celui du modèle.
- [x] L'adoption crée une nouvelle BibleVersion sans modifier les anciennes.
- [x] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [x] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).

## Implémentation

| Fichier | Rôle |
| --- | --- |
| `payload.ts` | schéma Zod du formulaire (`AgentJob.payload`) ; payload invalide → `AgentPreconditionError`, aucun appel |
| `variables.ts` | `{{PISTES_NICHES}}` (phrase explicite si vide), `{{CONTRAINTES}}`, `{{OBJECTIF_MONETISATION}}` ; `{{MODELE_BIBLE}}` lu par le port `readBibleTemplate` |
| `scoring.ts` | pondérations du prompt, score recalculé (le score du modèle est remplacé), tri du meilleur au moins bon |
| `rules.ts` | contrôles en code (liste dans `NEEDS.md`, « À savoir ») |
| `draft.ts` | `onSuccess` : **une** BibleVersion brouillon par tâche (auteur `AGENT_1`, non active), retrouvée par sa note à la reprise |
| `adoption.ts` | « Adopter cette bible » : déplace `Channel.activeBibleVersionId`, ne modifie ni ne crée aucune version ; idempotent |
| `launch.ts` | mise en file d'une tâche `AGENT` de l'agent 1 avec le formulaire en payload ; une seule analyse en file à la fois |
| `ports.ts` | accès Prisma, modèle de bible, notifications ; remplacés par des faux (`testing.ts`) dans les tests |
| `ui/` | `Panel.tsx` (serveur), `StrategyForm.tsx` (formulaire et bouton d'adoption, client), `CandidateTable.tsx`, `BiblePreview.tsx`, `actions.ts` (Server Actions : `requireOwner` + Zod), `view.ts` et `diff.ts` (modèle de vue pur, testé), `loadStrategy.ts` (lecture en base) |

Sans vidéo, l'échec au 3ᵉ essai ne bloque aucune vidéo : `runAgent` renvoie `needs_fix` et alerte l'humain avec un lien vers cette page, qui affiche « Sans résultat ».
« L'adoption crée une nouvelle BibleVersion » : la version est créée en brouillon par `onSuccess` ; l'adoption la rend active (voir `docs/decisions.md` : un brouillon est une version non active).
