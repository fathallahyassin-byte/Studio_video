# Studio

Outil personnel pour piloter une équipe de 11 agents IA qui produisent des vidéos courtes (TikTok, Reels, Shorts).

## Installer

Il faut Node 22.12 ou plus et Docker Desktop.

```bash
npm install                 # installe et génère le client Prisma
cp .env.example .env.local  # puis complète .env.local au besoin
npm run db:up               # PostgreSQL + Redis (docker-compose.yml)
npm run db:migrate          # applique les migrations
npm run db:seed             # chaîne par défaut, 11 agents, prompts
npm run db:seed:demo        # facultatif : vidéos, bible et stats d'exemple (base vide uniquement)
npm run auth:setup          # crée ton compte : e-mail, mot de passe, application d'authentification
npm run dev                 # http://localhost:3000
```

Sans Docker, `npx prisma dev` lance un PostgreSQL local temporaire : copie l'URL `postgres://…` qu'il affiche dans `DATABASE_URL`. Redis manquera, mais il ne sert qu'à partir de l'étape 3.

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
