# Décisions d'architecture

Une entrée par décision, la plus récente en haut.

## 2026-11-23 — Besoins du son (agent 6) : voix enregistrées, interfaces TTS, Whisper et musique
- Contexte : `agents/06-voix-son/NEEDS.md`. Aucun fournisseur de synthèse vocale, de transcription ni de musique n'est choisi (fournisseurs payants : CLAUDE.md §13).
- Décision :
  - `Asset.wordTimings` (JSON `[{ word, startS, endS }]`) et `Asset.timingSource` (`tts` ou `stt`), migration `20261123150000_voice_word_timings`. `createPrismaVoiceStore(db)` enregistre chaque voix une seule fois par `generationKey`, avec son coût sur la vidéo dans la même transaction ; l'horodatage Whisper est écrit une seule fois (une reprise ne le repaie pas).
  - `TtsProvider.providesWordTimings` : sans horodatage du moteur ni Whisper, la voix est refusée avant d'être payée (avant : payée puis vidéo bloquée). `SttProvider.estimateCost(durationS)` : le coût de Whisper, estimé sur la durée maximale de la cible, entre dans l'estimation faite avant de payer la voix.
  - Fabriques `getTtsProvider()`, `getSttProvider()` et `getMusicLibrary()` dans `lib/providers/`, lues par `configuredAudioTools()` ; elles renvoient `null` tant qu'aucun fournisseur n'est choisi. L'interface `MusicLibrary` passe de l'agent 6 à `lib/providers/music.ts`.
- Alternatives écartées : stocker l'horodatage dans `audioJson` seulement (une voix réutilisée après reprise n'aurait plus ses mots) ; une table à part pour les voix (l'`Asset` VOICE existe déjà et porte la clé d'idempotence).
- Restent ouverts : choix des fournisseurs (TTS, Whisper, musique), phrase du prompt sur les coupes (accord du propriétaire), plafond mensuel `BUDGET_MENSUEL`, lexique de prononciation (`TtsRequest.pronunciations`), `Asset.title`.

## 2026-11-23 — Fichier d'un plan ajouté à la main (besoin du monteur, point 3)
- Contexte : `agents/07-monteur/NEEDS.md` § 3. Tant qu'aucun générateur ni banque n'est branché, tout plan `stock`, `image_ia_animee` ou `video_ia` bloque la vidéo au montage (« Média manquant »).
- Décision :
  - Dans le panneau du directeur artistique, chaque plan sauf le texte animé a « Ajouter le fichier du plan » : image (JPEG, PNG, WebP) ou vidéo (MP4, MOV, WebM), 50 Mo au plus, **licence obligatoire**. Possible avant le rendu (visuels, montage, ou vidéo bloquée à ces étapes), comme « Régénérer ce plan ».
  - Le fichier part dans le stockage S3 (`videos/<vidéo>/plans/<plan>-<empreinte>.<ext>`) et devient un `Asset` IMAGE ou VIDEO du plan (`provider` = « ajout manuel », `generationKey` = `vidéo:plan:manuel:sha256`) : un double envoi du même fichier ne crée rien. Le monteur prend déjà le dernier `Asset` du plan, généré ou ajouté. Aucun coût ajouté à la vidéo.
  - `next.config.ts` : `serverActions.bodySizeLimit` et `proxyClientMaxBodySize` à 52 Mo (sinon `proxy.ts` coupe le corps à 10 Mo).
  - Le message de blocage du monteur dit où ajouter le fichier, puis de relancer l'étape.
- Alternatives écartées : envoi direct du navigateur vers S3 par URL présignée (une dépendance de plus et une règle CORS sur le bucket, pour des fichiers de quelques Mo) ; une banque de séquences (choix d'un fournisseur, toujours ouvert : `agents/05-directeur-artistique/NEEDS.md` § 4).
- Reste ouvert : les effets sonores (pas de type d'`Asset` ni de banque, `agents/07-monteur/NEEDS.md` § 3).

## 2026-11-23 — Rendu Remotion sur le worker, stockage S3, besoins du monteur (agent 7)
- Contexte : `agents/07-monteur/NEEDS.md` et étape 6 de la feuille de route. Choix du propriétaire : rendu sur la machine du worker (pas Remotion Lambda), stockage S3 branché tout de suite.
- Décision :
  - Dépendances (versions exactes, publiées il y a au moins deux semaines) : `remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/player` 4.0.542, `@aws-sdk/client-s3` 3.1164.0. Remotion est gratuit pour un particulier ; une entreprise de plus de 3 personnes doit prendre une licence (`REMOTION_LICENSE_KEY`). Au premier rendu, Remotion télécharge son Chromium (Chrome Headless Shell) sur la machine du worker.
  - Composition `Montage` (`remotion/`) : 1080×1920, 30 i/s, `inputProps` = `Video.timelineJson` tel quel, durée = `duree_totale_s`. Plans (image, vidéo, texte animé, aplat si manquant) avec mouvement et transition d'entrée ; textes animés 0,3 s au plus ; sous-titres un groupe à la fois, mot actif en jaune, dans la zone sûre ; voix ; musique au niveau du plan sonore, remontée de 10 dB entre les phrases quand le ducking est actif. Imports relatifs seulement (le bundler Remotion ne connaît pas `@/`).
  - `lib/render/localRenderer.ts` (worker uniquement) : bundle une fois par processus, `renderMedia` en H.264 + AAC 48 kHz dans un dossier temporaire, puis envoi au stockage. Coût 0 (pas de fournisseur payant) : pas d'estimation avant rendu ; à ajouter si on passe un jour à Lambda (CLAUDE.md §5.7). `RENDER_CONCURRENCY` facultatif.
  - Stockage : interface `lib/providers/storage.ts`, implémentation S3/R2 `lib/providers/s3.ts`. Configuré quand `S3_BUCKET`, les deux clés et `S3_PUBLIC_BASE_URL` sont remplis (`S3_ENDPOINT` pour R2, `S3_REGION` par défaut `auto`). Les URL enregistrées sont publiques et durables (`S3_PUBLIC_BASE_URL/clé`) : le bucket (ou son domaine public) doit être lisible.
  - Tâche `RENDER` (`jobs/render.ts`) : refuse et bloque la vidéo si la timeline est illisible, si un plan est `manquant` ou si la musique n'a pas d'`Asset` MUSIC avec licence (CLAUDE.md §8) ; sans stockage, elle attend (relance toutes les heures, alerte à la première prise). Clé de rendu `vidéo:render:transition` dans `Asset.generationKey` : un rendu réussi n'est jamais refait (reprise, relance manuelle). `Asset` RENDER + coût dans une transaction, puis `RENDER_DONE` → contrôle qualité.
  - « Lancer le rendu » (panneau du monteur) : `requestRender` (`lib/pipeline/service.ts`) remet une tâche RENDER en file pour une vidéo à l'étape du rendu, une seule active à la fois, rattachée au dernier passage au rendu (même clé de rendu).
  - Son modifié au montage (« Régénérer la voix », piste choisie, panneau de l'agent 6) : `restartEdit` efface la timeline et relance le monteur (tâche `transition:agent-7:relance-N`, l'ancienne tâche en file est annulée) ; vidéo bloquée au montage : timeline effacée, la reprise refait le montage. Le monteur n'enregistre pas une timeline dont la voix ou la musique ne sont plus celles de la vidéo.
  - Le monteur lit le livrable audio avec `parseStoredAudioPlan` de l'agent 6 (format `production`), les Asset VOICE / MUSIC en secours.
  - Le panneau du monteur affiche le Remotion Player (même composition que le rendu) à la place de la prévisualisation statique, et un lien vers le MP4 rendu.
- Alternatives écartées : Remotion Lambda (rapide mais AWS payant, à reconsidérer si le worker est trop lent) ; dossier local servi par une route protégée (refusé par le propriétaire : S3 tout de suite) ; URL S3 présignées (elles expirent).
- Restent ouverts (voir `agents/07-monteur/NEEDS.md`) : ajout à la main du fichier d'un plan (upload) et fichiers d'effets sonores.

## 2026-11-22 — Besoins du fork de l'agent 5 (directeur artistique)
- Contexte : `agents/05-directeur-artistique/NEEDS.md`. Médias générés sans clé d'idempotence en base ; storyboard et plan sonore du passage précédent encore présents quand la vidéo revient en `VISUALS_AND_AUDIO` ; labels IA des plans invisibles avant le GO.
- Décision :
  - `Asset.generationKey` (texte, unique ; migration `20261122180000_asset_generation_key`). Clé = `vidéo:plan:tentative:empreinte SHA-256 de la requête`. `createPrismaMediaPorts` (agent 5) enregistre l'`Asset` et ajoute le coût à `Video.totalCost` dans une même transaction ; une clé déjà prise (reprise, deux workers) n'ajoute ni Asset ni coût.
  - En entrant dans `VISUALS_AND_AUDIO` (V2 approuvée, reprise, renvoi V3), `applyEvent` remet `storyboardJson` et `audioJson` à `null` dans la transaction du changement d'étape : `MEDIA_DONE` attend les livrables de ce passage. L'ancien storyboard reste dans les `AgentRun` : l'agent 5 y lit le dernier accepté pour corriger d'après la note de l'humain.
  - Détail V3 de « À valider » : résumé des plans de l'agent 5 (type, temps, état du média, label IA), sous le rapport du contrôle qualité.
  - Pas encore faits, en attente du propriétaire : fournisseurs d'images et de vidéo IA (payants), stockage S3 des médias, source des séquences « stock ».
- Alternatives écartées : comparer dans `completeStage` la date d'écriture des JSON à celle de la transition (deux colonnes de plus, à tenir à jour par chaque agent) ; vider seulement au renvoi V3 (une reprise après blocage garde aussi un livrable périmé).

## 2026-11-22 — Besoins du fork de l'agent 4 (scénariste)
- Contexte : `agents/04-scenariste/NEEDS.md`. Le scénariste recompte les mots avec le débit de la bible, mais `normalize` ne recevait pas la bible.
- Décision :
  - Contrat `AgentDefinition` : `normalize(sortie, input, ctx)` et `controls(sortie, input, ctx)` reçoivent le contexte de l'appel (même bible que celle du prompt), et `normalize` peut être asynchrone. Les définitions existantes restent compatibles (paramètre en plus).
  - `checkBible` renvoie `debitVoix` (`format_video.debit_voix_mots_par_s`), modifiable dans le formulaire de la bible (pas de 0,1).
  - Détail V2 de « À valider » : mêmes briques que le panneau du scénariste (`agents/04-scenariste/ui/ScriptParts.tsx`) : compteurs recalculés et écart avec la cible de la bible active, 3 accroches, frise minutée, beats avec ids de faits cliquables qui affichent le fait du dossier et sa source.
- Alternatives écartées : garder l'état entre `buildVariables` et `normalize` dans la définition (le veilleur le fait encore ; il pourra passer à `ctx`) ; une seconde lecture du YAML dans l'agent pour le débit.

## 2026-11-22 — Fournisseur LLM : Claude (Anthropic)
- Contexte : choix du propriétaire. Les agents passent par l'interface `LlmProvider` (CLAUDE.md §2).
- Décision : `lib/providers/anthropic.ts`, SDK officiel `@anthropic-ai/sdk` (1.12). Activé par `LLM_PROVIDER="anthropic"`, clé `ANTHROPIC_API_KEY` (ou un profil `ant auth login`). Modèle par agent, en base ; `LLM_DEFAULT_MODEL="claude-opus-5-5"` remplit les agents sans modèle au seed.
  - Réponses en streaming (jusqu'à 64 000 tokens de sortie, pas de coupure HTTP), pensée adaptative (toujours active sur Claude Opus 5.5), profondeur réglée par `LLM_EFFORT` (`high` par défaut ; le défaut du modèle est `medium`).
  - Mise en cache du prompt (`cache_control`) : le prompt de l'agent et la bible sont identiques d'une relance à l'autre.
  - Secours côté serveur en cas de refus de sécurité (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) : le serveur relance sur un autre modèle dans le même appel. Un refus qui persiste, ou une réponse coupée, compte comme une panne du fournisseur.
  - Coût calculé d'après les tokens et le tarif de chaque modèle (table dans le code, relevée en novembre 2026 ; modèle inconnu = tarif le plus cher), converti par `USD_EXCHANGE_RATE`.
  - Clé absente ou refusée, modèle inconnu, requête invalide : `LlmConfigurationError`, aucune tentative comptée (rien n'est facturé), le worker garde la tâche et alerte une fois.
- Alternatives écartées : appels HTTP directs (le SDK gère relances, streaming et types) ; un modèle moins cher par défaut (choix à faire agent par agent, depuis sa page).

## 2026-11-22 — Machine à états et file de tâches (étape 3)
- Contexte : transitions de `Stage`, validations V1/V2/V3, notifications, et « reprise sans doublon » (CLAUDE.md §5, §8, §8 bis).
- Décision :
  - Règles pures dans `lib/pipeline/machine.ts`, appliquées par `lib/pipeline/service.ts`. Chaque changement d'étape écrit dans une seule transaction : la nouvelle étape (seulement si la vidéo n'a pas bougé entre-temps), une ligne `StageTransition`, la `Validation` éventuelle et les `AgentJob` de l'étape suivante. Deux décisions simultanées : une seule passe.
  - Une décision V1, V2 ou V3 ne peut venir que d'un acteur humain : l'orchestrateur (agent 0) ne peut pas en sauter une.
  - V1 : « Valider la sélection » ou « Écarter la sélection » sur les idées cochées (nouvelle décision `REJECTED`) ; les autres restent en attente. V2 « Demander une correction » renvoie au scénariste. V3 « Demander une correction » renvoie à l'étape choisie (script, visuels et son, montage ou contrôle), proposée d'après l'agent responsable du premier point « ko ». Une note est obligatoire pour une correction.
  - Les vidéos `NEEDS_FIX` rejoignent la file « À valider » : « Relancer l'étape » ou « Abandonner la vidéo ».
  - « Nouvelle vidéo » crée une idée humaine validée d'office en V1, qui part en recherche. « Lancer la veille » crée une tâche pour l'agent 2, une seule par semaine ISO.
  - `AgentJob` sert de file durable : clé unique `transitionId:agent-N`, donc une reprise après correction relance vraiment l'agent, et un redémarrage ne crée pas de doublon. Les tâches encore en file d'une étape quittée sont annulées.
  - Publication : interdite sans V3 approuvée, en code (`PUBLISHED`) et en base (trigger sur `Publication`).
  - Notifications : Telegram si `NOTIFY_CHANNEL=telegram` et ses deux variables sont remplies, sinon la console. L'e-mail n'est pas encore branché. Un échec d'envoi est journalisé sans bloquer la décision.
  - Test e2e Playwright du parcours V1 → V2 → V3 sur les données de démo (`npm run test:e2e`, base jetable `E2E_DATABASE_URL`), avec le navigateur Edge déjà installé.
- Alternatives écartées : envoyer la tâche à la file depuis le code après la transaction (une panne entre les deux perd la tâche).

## 2026-11-22 — File de tâches dans PostgreSQL (remplace BullMQ + Redis)
- Contexte : les tâches (`AgentJob`) sont déjà écrites dans la même transaction que le changement d'étape. Choix validé par le propriétaire.
- Décision : le worker (`jobs/worker.ts`, `npm run worker`) prend les tâches directement dans PostgreSQL avec `FOR UPDATE SKIP LOCKED` : plusieurs workers ne prennent jamais la même tâche. Une tâche restée « en cours » après un crash est remise en file ; `runAgent` ne rappelle jamais un modèle déjà payé pour la même clé. Relances avec délai croissant, puis échec définitif et alerte. Les tâches planifiées (veille du lundi 7 h, analyse du lundi 6 h) sont créées par le worker avec une clé par semaine. Plus de Redis dans `docker-compose.yml`.
- Alternatives écartées : BullMQ + Redis (un service de plus et un relais à maintenir entre Postgres et Redis), Inngest.

## 2026-11-22 — Interface (étape 2)
- Contexte : les 5 écrans de la maquette et `/agents/[slug]`, branchés sur la base, avant la machine à états (étape 3).
- Décision :
  - Les commandes qui font avancer le pipeline (« Lancer la veille », « Nouvelle vidéo », « Valider », « Demander une correction », « Tester sur la dernière vidéo ») sont affichées mais désactivées, avec une note. Elles seront branchées à l'étape 3 (ou 4 pour le test d'un agent).
  - Déjà actifs, parce qu'ils ne touchent pas au pipeline : enregistrer une version de prompt et le modèle d'un agent, remettre une ancienne version en production, enregistrer une version de la bible (formulaire ou YAML complet), remettre une ancienne version en service, partir du modèle de bible.
  - La bible s'édite champ par champ avec la bibliothèque `yaml` (2.9, sans dépendance) : elle réécrit les champs sans perdre les commentaires ni les autres clés. Un enregistrement de prompt refuse une `{{VARIABLE}}` que le code de l'agent ne connaît pas.
  - La file V1 regroupe toutes les idées en attente en une seule entrée ; V2 et V3 ont une entrée par vidéo. Une vidéo en `NEEDS_FIX` reste dans la colonne de l'étape à reprendre, en jaune « À corriger ».
  - Le 4ᵉ indicateur de Production est « Coût ce mois » (somme des AgentRun du mois, comparée à `BUDGET_MENSUEL`) au lieu du « coût moyen par vidéo » de la maquette, pour suivre le plafond mensuel de CLAUDE.md §8 bis.
  - Le jaune sert à l'élément de menu actif comme dans la maquette, et sinon seulement à ce qui attend une action.
  - Les formulaires d'édition gardent la saisie après une erreur (`components/useKeptForm.ts`) : React 19 vide sinon le formulaire à chaque envoi.
  - Données de démonstration séparées : `npm run db:seed:demo`, refusé si la base contient déjà des vidéos.
- Alternatives écartées : éditer la bible uniquement en YAML brut (moins lisible) ; brancher les validations avant d'avoir la machine à états (le contrôle V3 doit vivre dans `lib/pipeline`).

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
- Décision : `docker-compose.yml` avec PostgreSQL 17 (Redis retiré depuis : voir « File de tâches dans PostgreSQL »), port limité à 127.0.0.1. Dépanne sans Docker : `npx prisma dev` lance un Postgres local temporaire (sans Redis).
- Alternatives écartées : Postgres et Redis hébergés dès le dev.

## 2026-11-22 — File de tâches : BullMQ + Redis (remplacée)
- **Remplacée** le même jour par « File de tâches dans PostgreSQL ».
- Contexte : appels d'agents, générations et rendus de plusieurs minutes, dans un worker actif en continu (CLAUDE.md §8 bis).
- Décision : BullMQ sur Redis. Worker Node séparé dans `jobs/`, `jobId` = clé d'idempotence, tâches planifiées (cron) avec les jobs répétables de BullMQ. Installé à l'étape 3, avec la machine à états.
- Alternatives écartées : Inngest (fonctions appelées par HTTP, moins naturel pour un worker permanent et des rendus longs).
