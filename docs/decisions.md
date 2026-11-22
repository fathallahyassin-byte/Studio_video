# Décisions d'architecture

Une entrée par décision, la plus récente en haut.

## 2026-11-22 — Versions des outils
- Contexte : au 22 novembre 2026, `npm` donne TypeScript 7 (compilateur natif) et Prisma 8 en RC sur le tag `latest`.
- Décision : TypeScript 5.9 (typescript-eslint exige < 6.1), Prisma 7.10 (dernière stable), ESLint 9 (eslint-plugin-react ne gère pas encore ESLint 10), Next.js 16.4, Zod 4, Tailwind 4, Vitest 5.
- Alternatives écartées : TypeScript 7 et ESLint 10, incompatibles avec la config Next ; Prisma 8 RC.

## 2026-11-22 — Exécution des agents (`runAgent`)
- Contexte : CLAUDE.md §5 (relances, AgentRun) et §8 bis (reprise sans doublon).
- Décision :
  - `runAgent` reçoit ses dépendances (store, LLM, notifier) : testable sans base ni fournisseur, réutilisable par les evals (`createMemoryRunStore`).
  - Chaque exécution a une `jobKey` (ex. `videoId:SCRIPT:4`). `AgentRun` est unique sur (`jobKey`, `attempt`). Une exécution déjà réussie n'est jamais rappelée ; `successHandledAt` permet de rejouer seulement `onSuccess` après un crash.
  - Statut supplémentaire `CONTROL_FAILED` (en plus de `OK`, `INVALID_JSON`, `ERROR`) pour distinguer un contrôle en code refusé d'un JSON invalide.
  - Une erreur du fournisseur consomme une tentative puis remonte pour que la file réessaie plus tard ; à la 3ᵉ, la vidéo passe en `NEEDS_FIX`.
  - Le contrat `AgentDefinition` gagne `normalize` (recalculs en code avant les contrôles) ; `controls` peut être asynchrone ; la bible est `null` tant qu'aucune n'est adoptée (agent 1).
  - Le registre est scindé : `agents/registry.ts` (définitions, importable par le worker) et `agents/panels.ts` (React).
- Alternatives écartées : relancer immédiatement sur erreur réseau (inutile sans délai) ; stocker le prompt rendu en entier (reconstructible par `promptVersionId` + `bibleVersionId` + `input`).

## 2026-11-22 — Modèle de données : écarts avec CLAUDE.md §4
- Contexte : le modèle de §4 est un point de départ ; quelques besoins n'y tenaient pas.
- Décision :
  - **Bible active** : pointeur `Channel.activeBibleVersionId`. Les versions restent immuables ; un brouillon (agent 1) est simplement une version non active. `{{BIBLE}}` = version active.
  - **Prompt en production** : pointeur `Agent.activePromptVersionId`, champ `PromptVersion.source` (`FILE` ou `UI`). Le seed n'active pas une version issue du fichier si la version en production vient de l'interface.
  - **NEEDS_FIX** : reste une valeur de `Stage`, avec `Video.blockedAt` (étape à reprendre) et `blockedReason`.
  - Ajouts : `Video.partnership` (lu par l'agent 8), `Video.number` (V-031), `Agent.settings` (réglages conservés par agent), `AnalystReport`, `Experiment`, `Publication.mode` (`MANUAL` ou `API`), `BibleAuthor.AGENT_1`.
  - Garde-fous en SQL (migration initiale) : triggers qui interdisent de modifier ou supprimer une `BibleVersion` ou une `PromptVersion`, CHECK sur la licence des `Asset` musicaux et sur `attempt` (1 à 3).
  - Noms de champs en anglais dans le code ; le contenu produit par les agents reste en français.

## 2026-11-22 — Connexion : mot de passe + TOTP
- Contexte : un seul compte, l'outil détient les clés API et peut publier (CLAUDE.md §8 bis).
- Décision : e-mail + mot de passe (scrypt) + code TOTP (RFC 6238), sans dépendance. Les trois valeurs sont dans `.env.local`, écrites par `npm run auth:setup`. Session : cookie `httpOnly` signé en HMAC-SHA256 (Web Crypto) avec `AUTH_SECRET`, 7 jours. `proxy.ts` protège toutes les pages et routes d'API ; `requireOwner()` / `isOwnerSession()` doublent le contrôle dans les layouts, Server Actions et route handlers. Limite globale de 10 échecs par 15 min, code TOTP non réutilisable.
- Alternatives écartées : lien magique par e-mail (demande un service d'envoi payant) ; Auth.js (lourd pour un seul compte).

## 2026-11-22 — Développement local : Docker Compose
- Contexte : ni PostgreSQL ni Redis sur la machine de dev.
- Décision : `docker-compose.yml` avec PostgreSQL 17 et Redis 7 (`noeviction`, exigé par BullMQ), ports limités à 127.0.0.1. Dépanne sans Docker : `npx prisma dev` lance un Postgres local temporaire (sans Redis).
- Alternatives écartées : Postgres et Redis hébergés dès le dev.

## 2026-11-22 — File de tâches : BullMQ + Redis
- Contexte : appels d'agents, générations et rendus de plusieurs minutes, dans un worker actif en continu (CLAUDE.md §8 bis).
- Décision : BullMQ sur Redis. Worker Node séparé dans `jobs/`, `jobId` = clé d'idempotence, tâches planifiées (cron) avec les jobs répétables de BullMQ. Installé à l'étape 3, avec la machine à états.
- Alternatives écartées : Inngest (fonctions appelées par HTTP, moins naturel pour un worker permanent et des rendus longs).
