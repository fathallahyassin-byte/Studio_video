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

- [ ] `definition.ts` exporte une `AgentDefinition` conforme à `agents/_shared/types.ts`.
- [ ] La sortie est validée par `schema.ts`, avec 2 relances maximum, puis `NEEDS_FIX`.
- [ ] Chaque appel crée un AgentRun (prompt, bible, entrée, sortie, tokens, coût).
- [ ] Le score pondéré est **recalculé en code** à partir des notes : on n'utilise pas celui du modèle.
- [ ] L'adoption crée une nouvelle BibleVersion sans modifier les anciennes.
- [ ] Tests Vitest : un exemple de sortie valide, un invalide, et les contrôles en code ci-dessus.
- [ ] `ui/Panel.tsx` suit la maquette (police Archivo, noir, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action).
