# Studio

Outil personnel pour piloter une équipe de 11 agents IA qui produisent des vidéos courtes (TikTok, Reels, Shorts).

## Installer

Il faut Node 22.12 ou plus et Docker Desktop.

```bash
npm install                 # installe et génère le client Prisma
cp .env.example .env.local  # puis complète .env.local au besoin
npm run db:up               # PostgreSQL (docker-compose.yml)
npm run db:migrate          # applique les migrations
npm run db:seed             # chaîne par défaut, 11 agents, prompts
npm run db:seed:demo        # facultatif : vidéos, bible et stats d'exemple (base vide uniquement)
npm run auth:setup          # crée ton compte : e-mail, mot de passe, application d'authentification
npm run dev                 # http://localhost:3000
npm run worker              # dans un second terminal : exécute les tâches des agents
```

Le worker prend les tâches dans PostgreSQL (table `AgentJob`), relance celles qui échouent et planifie chaque lundi l'analyse (6 h) et la veille (7 h). Ctrl+C l'arrête proprement.

Les agents appellent Claude : mets ta clé dans `ANTHROPIC_API_KEY` (ou connecte-toi avec `ant auth login`). Le modèle se règle agent par agent dans sa page ; `LLM_DEFAULT_MODEL` le remplit pour ceux qui n'en ont pas au prochain `npm run db:seed`. Sans clé ni `LLM_PROVIDER`, le worker laisse les tâches d'agents en file.

Sans Docker, `npx prisma dev` lance un PostgreSQL local temporaire : copie l'URL `postgres://…` qu'il affiche dans `DATABASE_URL` et ajoute `DATABASE_POOL_MAX="1"` (il ne supporte qu'une connexion à la fois).

## Tester

```bash
npm run test       # tests unitaires ; + tests d'intégration si TEST_DATABASE_URL pointe vers une base migrée et seedée
npm run test:e2e   # parcours V1 → V2 → V3 dans Edge ; E2E_DATABASE_URL = base JETABLE, vidée à chaque lancement
```

Pour effacer la démo et repartir d'une base vide : `npx prisma migrate reset`, puis `npm run db:seed`.

Après une modification d'un `prompt.md`, relance `npm run db:seed` : il crée une nouvelle version, sans écraser une version faite depuis l'interface.

## Travailler avec Claude Code

1. Session principale : étapes 1 à 3 de la feuille de route de `CLAUDE.md`.
2. Ensuite, un fork par agent : suis `docs/FORKS.md`.

## Où trouver quoi

- `CLAUDE.md` : les règles du projet pour Claude Code.
- `agents/NN-nom/` : tout ce qui concerne un agent (prompt, schéma de sortie, fiche, page).
- `agents/_shared/README.md` : le contrat commun des agents.
- `docs/` : la maquette, le modèle de bible, les forks, les décisions.
- `evals/` : les idées de référence pour tester les prompts.
