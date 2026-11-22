# Besoins de l'agent 2 hors de son dossier

Rien de bloquant : l'agent tourne tel quel. Ce qui suit améliorerait la boucle, à intégrer par la session principale (ou à valider par le propriétaire pour le prompt).

## 1. Afficher le signal « proche de » dans la file V1 (`lib/dashboard/queries.ts`, `app/(dashboard)/validations/`)

- **Quoi** : chaque vidéo créée par le veilleur porte dans `ideaJson` un champ `proche_de` (titre existant jugé trop proche, ou `null`) et `veille: { semaine, jobId }`. `getQueueDetail` (V1) ne lit aujourd'hui que score, accroche et hypothèse.
- **Pourquoi** : c'est en V1 que l'humain choisit ; il doit voir qu'une idée ressemble à une vidéo déjà produite (le score a déjà perdu 1 point, mais sans explication à l'écran). Le panneau `/agents/02-veilleur` l'affiche déjà.
- **Comment** : `parseIdea` garde le schéma de l'idée (les clés en plus sont ignorées) ; lire `proche_de` à part, par exemple avec `z.object({ proche_de: z.string().nullable().optional() })`, et l'afficher en puce grise « proche de « … » ».

## 2. Donner la semaine au modèle (`prompt.md`, avec ton accord)

- **Quoi** : le format de sortie demande `"semaine": "AAAA-Wnn"`, mais le prompt ne fournit pas la date.
- **Pourquoi** : le modèle devine la semaine. Le code la remplace par la semaine ISO de l'exécution (`normalize`), donc rien ne casse, mais une variable `{{SEMAINE}}` éviterait une donnée inventée dans la sortie brute.

## 3. Rendre le bonus +0,5 explicite (`prompt.md` + `schema.ts`, avec ton accord)

- **Quoi** : le prompt demande « +0,5 si l'idée exploite un enseignement positif de l'analyste », mais la sortie n'indique pas quel enseignement est exploité.
- **Pourquoi** : le code doit aujourd'hui déduire ce bonus de l'écart entre le score du modèle et la moyenne de ses notes (il ne l'accorde que si l'analyste a donné au moins un enseignement). Un champ `enseignement_exploite: string | null` par idée permettrait de le vérifier au lieu de le déduire.
- **Lié** : les `enseignements` de l'agent 10 n'ont pas de polarité (positif / négatif). Tous sont donc traités comme exploitables.

## 4. Pour information : ce que l'agent lit et écrit en base

- Lit `Agent.settings.signaux` (et `signauxMisAJour`) de l'agent 2, écrits par la Server Action du panneau ; les autres clés de `settings` sont conservées.
- Retrouve les vidéos d'une exécution par le filtre JSON `ideaJson.veille.jobId` (PostgreSQL). Pas d'index nécessaire à ce volume ; un index GIN sur `ideaJson` ne serait utile qu'avec des milliers de vidéos.
