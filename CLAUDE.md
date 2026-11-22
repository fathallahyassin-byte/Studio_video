# CLAUDE.md — Studio : interface de pilotage de l'équipe d'agents vidéo

Ce fichier explique le projet à Claude Code. Lis-le en entier avant toute tâche, et respecte-le.

## 1. Le projet en bref

Studio est une application web qui pilote une équipe de **11 agents IA**. Ensemble, ils produisent des vidéos courtes verticales (TikTok, Instagram Reels, YouTube Shorts) sur une niche donnée.

**C'est un outil personnel** : un seul utilisateur (moi), une ou plusieurs chaînes à moi. Pas de comptes clients, pas d'espace client, pas de facturation. Garde l'interface et le code aussi simples que possible.

Chaque vidéo passe d'un agent à l'autre. Un humain intervient à **trois validations obligatoires** :

| Validation | Moment | Ce que l'humain fait |
| --- | --- | --- |
| **V1** | après le veilleur (agent 2) | il choisit les idées à produire |
| **V2** | après le scénariste (agent 4) | il valide le script avant toute génération payante |
| **V3** | après le contrôle qualité (agent 8) | il donne le GO final avant publication |

Les références à ouvrir :
- Maquette de l'interface (5 écrans) : https://claude.ai/artifact/T64FwSZPpWMUMGMZegsCQw
- Prompts des agents : déjà en place dans `agents/NN-nom/prompt.md`. Modèle de bible : `docs/bible.template.yaml`.
- Fonctionnement avec un fork par agent : `docs/FORKS.md`.

## 2. Stack

- **Next.js** (App Router) en **TypeScript strict**, avec Tailwind pour le style.
- **PostgreSQL**, accédé par **Prisma**.
- Une **file de tâches** pour les appels aux agents et les rendus : BullMQ avec Redis, ou Inngest. Choisis-en une au début et note ton choix dans `docs/decisions.md`.
- Les **agents** passent par l'API d'un LLM, via le SDK officiel. Le modèle se configure par agent, dans la base, jamais en dur dans le code.
- La **validation des sorties JSON** se fait avec Zod : un schéma par agent.
- Le **rendu vidéo** passe par Remotion. La timeline JSON de l'agent 7 devient les `inputProps` de la composition.
- Le **stockage des médias** utilise un service compatible S3 (Cloudflare R2, S3…).
- Les **sous-titres mot à mot** viennent de l'horodatage du moteur de synthèse vocale, ou de Whisper à défaut.

Règle générale : tout fournisseur externe (LLM, synthèse vocale, vidéo IA, publication) passe par une interface dans `lib/providers/`, pour pouvoir en changer sans toucher au reste du code. Un fournisseur peut fermer du jour au lendemain : l'API Sora 2 a été arrêtée en septembre 2026.

## 3. Structure du repo

```
app/
  (dashboard)/
    production/      # tableau en colonnes par étape
    validations/     # file V1 / V2 / V3 + détail
    agents/          # liste des agents
      [slug]/        # page générique d'un agent, qui affiche son ui/Panel.tsx
    bible/           # formulaire de la bible + historique des versions
    stats/           # statistiques par vidéo et par plateforme
  api/               # route handlers (webhooks, déclenchements)
agents/
  _shared/           # contrat commun (types.ts) — session principale uniquement
  registry.ts        # importe les 11 definition.ts — session principale uniquement
  panels.ts          # importe les 11 ui/Panel.tsx — session principale uniquement
  00-orchestrateur/  # AGENT.md, prompt.md, schema.ts, definition.ts, ui/Panel.tsx, NEEDS.md
  …
  10-analyste/
components/          # UI réutilisable (Button, Chip, Card, Kanban…)
lib/
  agents/runAgent.ts # exécution commune : variables, appel LLM, Zod, relances, AgentRun
  pipeline/          # machine à états des vidéos
  providers/         # llm, tts, imageGen, videoGen, render, publish, notify
  db.ts
prisma/schema.prisma
jobs/                # workers de la file + cron
evals/               # idées de référence pour tester les prompts
docs/                # FORKS.md, decisions.md, maquette.md, bible.template.yaml
```

**Tout ce qui est propre à un agent vit dans son dossier `agents/NN-nom/`.** Le code partagé vit dans `lib/`, `components/` et `agents/_shared/`.

## 4. Modèle de données (point de départ)

La référence est `prisma/schema.prisma` ; ses écarts avec la liste ci-dessous sont expliqués dans `docs/decisions.md`.

- **Channel** : id, nom, niche, plateformes.
- **BibleVersion** : id, channelId, version (int), contenu (YAML ou JSON), auteur (`humain` ou `agent-10`), createdAt. On ne modifie jamais une version : chaque enregistrement en crée une nouvelle.
- **Agent** : id (0 à 10), nom, rôle, modèle, actif.
- **PromptVersion** : id, agentId, version, contenu, createdAt, notes.
- **Video** : id, channelId, titre, stage (enum ci-dessous), ideaJson, dossierJson, scriptJson, storyboardJson, audioJson, timelineJson, qaJson, publishJson, coûtTotal.
- **AgentRun** : id, videoId, agentId, promptVersionId, bibleVersionId, entrée, sortie, statut (`ok`, `invalid_json`, `error`), tokens, coût, durée, tentative (1 à 3).
- **Validation** : id, videoId, gate (`V1`, `V2`, `V3`), décision (`approved` ou `changes_requested`), note, décidéPar, createdAt.
- **Asset** : id, videoId, type (`image`, `video`, `voice`, `music`, `render`), url, fournisseur, licence.
- **Publication** : id, videoId, plateforme, idExterne, statut, programméePour, labelIA (bool).
- **Stat** : id, publicationId, date, vues, duréeMoyenne, pctComplet, partages, enregistrements, abonnésGagnés.

Les étapes (`Stage`), dans l'ordre :

`IDEA → AWAITING_V1 → RESEARCH → SCRIPT → AWAITING_V2 → VISUALS_AND_AUDIO → EDIT → RENDER → QA → AWAITING_V3 → SCHEDULED → PUBLISHED`

À cela s'ajoute `REJECTED`. L'état en cours est `NEEDS_FIX` tant qu'un agent corrige.

## 5. Les agents : règles d'implémentation

1. **Le prompt de chaque agent est dans `agents/NN-nom/prompt.md`.** Au démarrage (seed), on le charge dans `PromptVersion`. Une modification depuis l'interface crée une nouvelle version en base. Une modification du fichier passe par un commit git. Chaque agent décrit ses entrées, sa page et ses critères dans son `AGENT.md`.
2. **L'injection des variables** : `{{BIBLE}}` est remplacé par la dernière `BibleVersion`, et les autres `{{VARIABLES}}` par les sorties JSON des agents précédents. Une variable non remplacée = erreur, pas d'appel.
3. **Chaque sortie est validée par Zod.** Si le JSON est invalide ou ne respecte pas le schéma, on relance avec le message d'erreur, **2 fois maximum**. Au 3ᵉ échec, la vidéo passe en `NEEDS_FIX` et l'humain est alerté.
4. **Chaque appel est enregistré** dans `AgentRun` : prompt, bible, entrée, sortie, coût. L'analyste (agent 10) doit pouvoir savoir quelle version de prompt a produit quelle vidéo.
5. **Les agents 5 et 6 tournent en parallèle**, et le monteur (agent 7) attend leurs deux sorties.
6. **Le recalage des sous-titres se fait en code** (déterministe), pas par un LLM. L'agent 7 ne choisit que le rythme et les transitions.
7. **Il y a un budget par vidéo** (`BUDGET_PAR_VIDEO` dans `.env`). Avant une génération payante, on estime le coût. Si le budget est dépassé, la tâche se bloque et attend l'humain.
8. **L'agent 0 (orchestrateur)** est facultatif : la machine à états de `lib/pipeline/` fait déjà ce travail. Ne l'implémente qu'en cas de demande explicite.

## 6. Interface (suivre la maquette)

- **Production** : six colonnes (Idées, Recherche, Script, Production, Contrôle, Publication), avec le compte de vidéos par colonne. Les cartes en attente de l'humain sont en jaune. Deux boutons : « Lancer la veille de la semaine » et « Nouvelle vidéo ».
- **Validations** : la file V1/V2/V3 à gauche et le détail à droite. Le détail affiche la liste d'idées à cocher (V1), les beats minutés du script (V2) ou la check-list qualité (V3). Il propose une note pour l'agent et deux boutons, « Valider » et « Demander une correction ». Le menu affiche un badge avec le nombre d'éléments en attente.
- **Agents** : une carte par agent avec son état. L'éditeur montre le modèle, le prompt, un bouton « Enregistrer une nouvelle version » et un bouton « Tester sur la dernière vidéo ».
- **Bible** : le formulaire de la bible et l'historique des versions.
- **Stats** : un tableau par vidéo et par plateforme, plus les enseignements de l'agent 10.
- **Style** : police Archivo (titres en largeur condensée, graisse 850), noir #000, fond #F6F7F4, jaune #FFD60A réservé à ce qui attend une action. Le menu latéral est noir.
- **Accessibilité** : de vrais `<button>` et `<label>`, un focus visible, un contraste de 4,5:1 au minimum et le respect de `prefers-reduced-motion`.

## 7. Intégrations de publication (règles vérifiées en novembre 2026)

- **YouTube** (Data API v3, `videos.insert`) : l'upload utilise un quota dédié de 100 vidéos par jour. Il faut renseigner `status.containsSyntheticMedia` quand le rapport qualité l'exige.
- **TikTok** (Content Posting API) : tant que l'app n'a pas passé l'audit, tout ce qu'elle publie reste privé, avec 5 comptes maximum par 24 h. Prévois donc d'abord un mode « publication manuelle » : export du fichier et des textes, avec un bouton « Marquer comme publié ».
- **Instagram** : la publication de Reels par API demande un compte professionnel.
- **Revérifie ces règles avant d'implémenter** : elles changent souvent.

## 8. Conformité, à coder et pas seulement à documenter

- **La publication** n'est jamais possible sans une `Validation` V3 `approved` liée à la vidéo. Bloque-la au niveau de la machine à états **et** de l'API.
- **Les étiquettes IA** : le rapport de l'agent 8 fixe les booléens par plateforme. Le module de publication les applique automatiquement, et l'humain les voit avant le GO.
- **La licence** de chaque `Asset` musical est obligatoire, sinon le rendu est refusé.
- **Les faits** : un script qui cite un fait de confiance « faible » est rejeté avant V2.

## 8 bis. Pour que l'outil tourne tout seul

- **Connexion** : un seul compte, connexion par lien envoyé par e-mail ou par mot de passe avec 2FA. Toutes les pages et toutes les routes d'API sont protégées : l'outil détient les clés API et peut publier.
- **Worker séparé** : les appels aux agents, la génération des médias et le rendu durent plusieurs minutes. Ils tournent dans un worker qui reste actif en continu, pas dans des fonctions serverless qui coupent au bout d'un délai. Le rendu Remotion passe par Remotion Lambda ou par une machine dédiée : note le choix dans `docs/decisions.md`.
- **Tâches planifiées (cron)** : la veille du lundi matin, l'import quotidien des statistiques, l'analyse hebdomadaire et les publications aux heures prévues.
- **Notifications** : une alerte (Telegram ou e-mail, choix dans `.env`) dès qu'une V1, V2 ou V3 attend, qu'un agent échoue trois fois ou que le budget est atteint. Le message contient un lien direct vers l'élément à valider.
- **Reprise sans doublon** : chaque tâche est idempotente, avec une clé unique par vidéo, étape et tentative. Un worker qui redémarre ne relance jamais une génération payante déjà réussie.
- **Coûts** : un total par vidéo et par mois visible sur le tableau de bord, et un plafond mensuel (`BUDGET_MENSUEL`) qui met la production en pause.
- **Tests de prompts** : `evals/` contient 10 idées de référence. La commande `npm run eval -- --agent 4` repasse ces idées sur une version de prompt et affiche les différences avec la version en production.
- **Sauvegardes** : export automatique et quotidien de la base, conservé 30 jours.
- **Nettoyage** : les médias intermédiaires (plans, voix, brouillons) sont supprimés 30 jours après la publication. On garde le rendu final et les textes.
- **Erreurs** : un outil de suivi des erreurs (Sentry ou équivalent) branché sur l'appli et sur le worker.

## 9. Conventions de code

- TypeScript strict, sans `any`. Exports nommés. Fonctions courtes.
- Server Components par défaut, et `"use client"` seulement là où c'est utile.
- Les mutations passent par des Server Actions ou des route handlers, validées par Zod.
- Les secrets restent dans `.env.local`, jamais dans le code ni dans les prompts. Maintiens un `.env.example` à jour.
- Tests : Vitest pour `lib/pipeline` et `lib/agents` (schémas, transitions d'états), et un test e2e Playwright pour le parcours V1 → V2 → V3.
- Messages de commit en français, à l'impératif (« Ajoute la file de validation »).

## 10. Commandes

```bash
npm run dev          # serveur de dev
npm run build        # build de prod
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test         # Vitest (tests d'intégration en plus si TEST_DATABASE_URL est défini)
npm run test:e2e     # Playwright, parcours V1 → V2 → V3 (E2E_DATABASE_URL : base jetable, vidée à chaque lancement)
npm run db:up        # PostgreSQL via Docker Compose (db:down pour arrêter)
npm run db:migrate   # prisma migrate dev
npm run db:seed      # chaîne, 11 agents, import des prompt.md (idempotent)
npm run db:seed:demo # données d'exemple pour voir les écrans (base sans vidéo uniquement)
npm run auth:setup   # crée le compte de connexion dans .env.local
npm run worker       # worker : tâches des agents (file dans PostgreSQL) et planning du lundi
npx prisma studio
```

(Mets cette liste à jour si tu changes les scripts.)

## 11. Feuille de route, dans l'ordre

1. **Socle** : Next.js, Prisma, schéma de données, seed avec les 11 agents et leurs `prompt.md`, connexion à mon compte, `agents/_shared/`, `agents/registry.ts` avec les 11 entrées provisoires, `lib/agents/runAgent.ts`.
2. **Interface statique** : les 5 écrans d'après la maquette et la page générique `/agents/[slug]`, branchés sur la base (données de seed).
3. **Machine à états** : les transitions de `Stage`, les validations V1/V2/V3, les notifications de validation, les tests.
4. **Agents** : un fork par agent, dans l'ordre de `docs/FORKS.md`. Les étapes 5 à 7 (providers médias, rendu, publication) sont faites par la session principale avant les forks qui en dépendent.
5. **Médias** : synthèse vocale, images et vidéo IA, Whisper, derrière les interfaces `providers/`.
6. **Rendu Remotion** : la timeline de l'agent 7 devient un MP4 1080×1920.
7. **Publication** : d'abord manuelle (export), puis par API, plateforme par plateforme.
8. **Statistiques et boucle** : import des stats, agent 10, mise à jour de la bible et du backlog.
9. **Mise en ligne** : hébergement de l'appli et du worker, cron, sauvegardes, nettoyage des médias, suivi des erreurs, plafond de coûts, `evals/`.

Ne passe à l'étape suivante que si les tests de l'étape en cours passent.

## 12. Forks : un agent par session

Lis `docs/FORKS.md`. En résumé : un fork ne modifie que `agents/NN-nom/**`. Tout besoin hors de ce dossier s'écrit dans son `NEEDS.md`, et la session principale l'intègre.

## 13. Ce que tu ne dois pas faire

- Publier, ou appeler une API de publication, sans V3 validée.
- Supprimer ou réécrire une `BibleVersion` ou une `PromptVersion` existante.
- Modifier un `prompt.md` sans que je le demande.
- Dans un fork : modifier un fichier hors du dossier de ton agent.
- Ajouter un fournisseur payant ou une dépendance lourde sans le noter dans `docs/decisions.md` et me demander.
- Committer des secrets, des fichiers médias ou des données de clients.
