# Besoins de l'agent 5 hors de son dossier

Pour la session principale. État au 22 novembre 2026 : 2, 5 et 6 sont faits ; 1, 3 et 4 attendent une décision du propriétaire.

## 1. Brancher les générateurs d'images et de vidéo IA (étape 5 de la feuille de route) : EN ATTENTE (choix du fournisseur, payant)

- **Quoi** : un fournisseur `ImageGenProvider` et un `VideoGenProvider` réels dans `lib/providers/`, choisis par `.env` (`IMAGE_GEN_API_KEY`, `VIDEO_GEN_API_KEY` existent déjà dans `.env.example`), plus une fabrique du type `getImageGenProvider(): ImageGenProvider | null` / `getVideoGenProvider()`. Puis remplacer le corps de `configuredVisualTools()` dans `agents/05-directeur-artistique/ports.ts` par ces fabriques (une ligne).
- **Pourquoi** : aucun générateur n'existe encore. En attendant, `{{OUTILS_VISUELS}}` dit au modèle qu'aucun modèle image ni vidéo IA n'est configuré, les contrôles refusent les types `image_ia_animee` et `video_ia`, et le modèle ne produit que du `texte_anime` et du `stock` : la vidéo passe au montage sans génération payante. Ajouter un fournisseur payant demande ton accord (CLAUDE.md §13).
- **Contrat attendu** : `estimateCost(request)` doit renvoyer une estimation dans la monnaie des budgets **sans appel payant** ; `generate` renvoie `{ url, cost, license }` avec le coût réel ; `VideoGenRequest.durationS` est la durée exacte du plan (1,5 à 4 s).

## 2. Clé d'idempotence des médias générés : `Asset.generationKey` : FAIT

- **Intégré** : colonne `Asset.generationKey` (unique, migration `20261122180000_asset_generation_key`) et `createPrismaMediaPorts(db, outils)` dans `ports.ts` : Asset et coût de la vidéo dans une même transaction, clé déjà prise ignorée (testé sur base réelle, `ports.integration.test.ts`).

- **Quoi** : `generationKey String? @unique` sur `Asset` (+ migration), et une vraie implémentation de `MediaPorts` (`agents/05-directeur-artistique/generation.ts`) :
  - `findGeneration(key)` : `Asset` dont `generationKey = key` ;
  - `countGenerations(videoId, planId)` : déjà écrit (compte des `Asset` IMAGE/VIDEO du plan) ;
  - `recordGeneration(record)` : dans une transaction, `Asset` (`type` IMAGE ou VIDEO, `url`, `provider`, `license`, `planId`, `durationS`, `generationKey`) **et** `Video.totalCost += media.cost`. Une violation d'unicité sur la clé = déjà fait, à ignorer.
- **Pourquoi** : CLAUDE.md §8 bis (« un worker qui redémarre ne relance jamais une génération payante déjà réussie »). La clé vaut `videoId:planId:tentative:empreinte` (empreinte = SHA-256 de la requête) : un storyboard refait après un renvoi V3 (prompt différent) ne réutilise pas l'ancien média, une régénération demandée par l'humain est une nouvelle tentative.

## 3. Stockage S3 des médias : EN ATTENTE (choix du service et de la bibliothèque)

- **Quoi** : que `generate` (ou un adaptateur autour) copie le fichier du fournisseur dans le stockage S3 (`S3_*` de `.env.example`) et renvoie l'URL durable.
- **Pourquoi** : les URL des fournisseurs expirent souvent ; le monteur (agent 7), le rendu et le panneau lisent `Asset.url`. Le panneau affiche l'image avec `next/image` en `unoptimized` (pas de `remotePatterns` à configurer) et la vidéo avec `<video>`.

## 4. Séquences « stock » (banque libre de droits) : EN PARTIE FAIT (ajout à la main ; banque en attente de ta décision)

- **Quoi** : une interface de recherche de séquences libres de droits (ex. `lib/providers/stock.ts`), ou une décision : l'humain ou le monteur source ces plans à partir de `mots_cles_stock`.
- **Pourquoi** : le prompt prévoit le type `stock`, mais `lib/providers/` n'a rien pour le sourcer. Aujourd'hui ces plans sont enregistrés « À sourcer (mots-clés) » et ne génèrent rien. Il faudra aussi y enregistrer la licence de chaque séquence (CLAUDE.md §8).
- **Intégré** : « Ajouter le fichier du plan » (`upload.ts`, `ui/PlanFileForm.tsx`) : l'humain source la séquence à partir des mots-clés et l'envoie avec sa licence (obligatoire) ; elle devient l'`Asset` du plan, utilisé par le monteur. Une banque branchée automatiquement reste à décider.

## 5. Storyboard et plan sonore périmés à la reprise de VISUALS_AND_AUDIO : FAIT

- **Intégré** : `applyEvent` remet `storyboardJson` et `audioJson` à `null` en entrant dans `VISUALS_AND_AUDIO`, dans la transaction du changement d'étape. Le storyboard précédent (base d'une correction) est lu dans le dernier `AgentRun` accepté de l'agent 5 (`StoryboardVideo.previousStoryboard`).

- **Quoi** : quand une vidéo **entre** dans `VISUALS_AND_AUDIO` (V2 approuvée, `RESUMED` après un blocage, renvoi V3 vers « visuels et son »), remettre `storyboardJson` et `audioJson` à `null` dans la transaction de `applyEvent` — ou faire comparer à `completeStage(..., "MEDIA_DONE")` la date d'écriture des deux JSON avec celle de la dernière transition.
- **Pourquoi** : `completeStage` n'avance la vidéo que si les deux JSON sont non nuls. Après un renvoi V3 ou une reprise, ils contiennent encore ceux du passage précédent : le premier des agents 5 et 6 qui termine ferait passer la vidéo au montage avec l'ancien livrable de l'autre. De mon côté, `storyboardJson` n'est écrit qu'**après** la génération des médias, pour que l'agent 6 ne fasse pas avancer la vidéo pendant qu'elle génère.

## 6. Afficher le storyboard ailleurs (facultatif) : FAIT

- **Intégré** : le détail V3 de « À valider » affiche `ui/StoryboardSummary.tsx` (plans, état du média, label IA) sous le rapport du contrôle qualité.

- **Quoi** : réutiliser `ui/storyboards.ts` (`toStoryboardView`, modèle de vue pur et testé) dans le détail V3 de « À valider » ou dans la carte Production, si tu veux voir les plans et le label IA avant le GO.
- **Pourquoi** : CLAUDE.md §8 demande que l'humain voie les étiquettes IA avant le GO ; le rapport de l'agent 8 les fixe, mais les plans `label_ia_requis` de l'agent 5 en sont la source.

## À savoir (rien à faire)

- **`schema.ts` inchangé.** `storyboardJson` contient la sortie normalisée : plans triés par `debut_s`, `secondes_video_ia` recalculé (somme des plans `video_ia`, au dixième), `label_ia_requis` forcé à `false` pour `texte_anime` et `stock` (ni l'un ni l'autre n'est généré par IA). L'agent 7 (monteur) et l'agent 8 (contrôle qualité) liront ce format.
- **Budget de secondes de vidéo IA** : refus en code renvoyé au modèle (avec le total recalculé et les plans en cause), donc 2 relances ; au 3ᵉ échec, `runAgent` met la vidéo en `NEEDS_FIX` et alerte. Aucune génération n'a lieu avant une sortie acceptée. Garde-fou en plus dans `onSuccess` (budget baissé entre-temps, sortie rejouée) : `blockVideo` sans génération.
- **Budget par vidéo (CLAUDE.md §5.7)** : avant toute génération, `onSuccess` additionne `estimateCost` des plans **pas encore générés** et compare à `BUDGET_PAR_VIDEO − Video.totalCost`. Au-delà, ou si `BUDGET_PAR_VIDEO` est absent alors qu'il y a quelque chose à payer : `blockVideo` (NEEDS_FIX + alerte avec la raison), rien n'est généré, le storyboard est enregistré pour que l'humain le voie. La même vérification s'applique à « Régénérer ce plan ». Le plafond mensuel (`BUDGET_MENSUEL`) n'est pas vérifié ici : à faire dans le worker ou dans les providers, pour tous les agents.
- **Contrôles en code**, tous tirés du prompt et renvoyés au modèle d'un bloc : plans de 1,5 à 4 s ; couverture de 0 s à la fin du dernier beat du script, sans trou ni chevauchement (tolérance 0,05 s) ni plan au-delà ; chaque plan dans les bornes de son beat ; ids uniques ; `couverture.plan` existant ; `idee_id` identique à celui du script ; type généré interdit si l'outil n'est pas branché ; plan généré avec `prompt_en` contenant « vertical 9:16 composition » et le suffixe `identite.style_visuel_en` de la bible (s'il est rempli), et un `negative_prompt_en` ; `stock` avec des mots-clés ; `texte_anime` avec un texte écran.
- **Note de l'humain** (renvoi V3, reprise) : ajoutée à `{{SCRIPT}}` sous « CORRECTION DEMANDÉE PAR L'HUMAIN », suivie du storyboard précédent s'il existe.
- **Régénération d'un plan** : Server Action `ui/actions.ts` (`requireOwner`, Zod), possible tant que la vidéo n'est pas au rendu (visuels, montage, ou bloquée à ces étapes). Le prompt modifié remplace celui du plan dans `storyboardJson`. Sans générateur, le bouton est désactivé avec une note ; le prompt reste modifiable.
