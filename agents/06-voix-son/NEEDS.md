# Besoins de l'agent 6 hors de son dossier

État au 23 novembre 2026 (session principale, voir `docs/decisions.md`, « Besoins du son ») : points 4, 5 et 6 faits ; interfaces des points 1 à 3 prêtes. Restent ouverts : le choix des fournisseurs réels (points 1 à 3, payants), la phrase du prompt (point 7, ton accord) et le plafond mensuel (point 8).

## 1. Brancher un moteur de synthèse vocale : INTERFACE PRÊTE, fournisseur à choisir (payant)

- **Intégré** : `getTtsProvider()` (`lib/providers/tts.ts`, renvoie `null` tant qu'aucun moteur n'est choisi) est lu par `configuredAudioTools()`. `TtsProvider.providesWordTimings` est ajouté : sans horodatage du moteur ni Whisper, la voix est refusée **avant** d'être payée. Reste à écrire le fournisseur réel, avec ton accord. `TtsRequest.pronunciations` (facultatif) n'est pas fait.

- **Quoi** : un `TtsProvider` réel dans `lib/providers/` (clé `TTS_API_KEY`, déjà dans `.env.example`) et une fabrique `getTtsProvider(): TtsProvider | null`, puis remplacer `tts: null` dans `configuredAudioTools()` (`agents/06-voix-son/ports.ts`).
- **Pourquoi** : aucun moteur n'existe. Ajouter un fournisseur payant demande ton accord (CLAUDE.md §13). En attendant, voir « Sans TTS » plus bas.
- **Contrat attendu** :
  - `estimateCost(text)` estime **sans appel payant**, dans la monnaie des budgets ;
  - `synthesize` renvoie la **durée réelle mesurée** (`durationS`), l'horodatage mot à mot quand le moteur le donne, le coût réel, et une URL durable (copie dans le stockage S3 : les URL des fournisseurs expirent ; le panneau lit la voix avec `<audio>`) ;
  - `supportedTags` : les balises telles qu'elles s'écrivent dans le texte (`<break time="0.5s"/>`, `[pause]`…). Le code compare leur **nom** (`break`, `pause`) aux balises du texte et refuse les autres.
- **Facultatif, utile** :
  - `TtsProvider.providesWordTimings: boolean` : sans horodatage ni Whisper, la voix est payée puis inutilisable (la vidéo est bloquée). Avec ce booléen, le blocage aurait lieu avant de payer.
  - `TtsRequest.pronunciations?: { word: string; phonetic: string }[]` (lexique du moteur) : aujourd'hui `prononciations` n'atteint le moteur que si le modèle les écrit en balises ; la liste est affichée dans le panneau.
  - La vitesse de `direction_par_beat` est par beat, `TtsRequest.speed` est global : on envoie `speed: 1`.

## 2. Whisper (horodatage de secours) : INTERFACE PRÊTE, fournisseur à choisir (payant)

- **Intégré** : `SttProvider.estimateCost(durationS)` et `getSttProvider()` (`lib/providers/stt.ts`). Quand le moteur ne donne pas l'horodatage, le coût de Whisper (sur la durée maximale de la cible) entre dans l'estimation faite avant de payer la voix.

- **Quoi** : un `SttProvider` réel et sa fabrique, à mettre dans `stt` de `configuredAudioTools()`. Ajouter `estimateCost(durationS)` à `SttProvider`.
- **Pourquoi** : si le moteur TTS ne donne pas l'horodatage, Whisper le récupère (une seule fois par voix, même après une reprise). Son coût n'est pas annoncé à l'avance : il n'entre donc pas dans l'estimation faite avant de payer la voix (il est ajouté ensuite au coût de la vidéo).

## 3. Banque de musique libre de droits : INTERFACE DÉPLACÉE, fournisseur à choisir

- **Intégré** : `MusicLibrary`, `MusicTrack`, `MusicQuery` et `getMusicLibrary()` sont dans `lib/providers/music.ts` (réexportés par `music.ts`). Le choix manuel dans le panneau reste la solution en attendant.

- **Quoi** : déplacer `MusicLibrary`, `MusicTrack` et `MusicQuery` de `agents/06-voix-son/music.ts` vers `lib/providers/music.ts`, écrire un fournisseur réel et le mettre dans `music` de `configuredAudioTools()`.
- **Pourquoi** : `lib/providers/` n'a rien pour chercher une musique. Le fournisseur doit renvoyer la **licence** de chaque piste et dire si elle couvre l'usage commercial sur les 3 plateformes (`commercialUse`) : sans licence, une piste est écartée et n'est jamais enregistrée (CLAUDE.md §8).
- **En attendant** : l'humain choisit la piste dans le panneau (titre, URL, licence obligatoire). Elle est enregistrée en `Asset` MUSIC (`provider = "choix manuel · <titre>"`) et réutilisée à la relance de l'étape.

## 4. Enregistrer les voix générées : `Asset.generationKey` et horodatage : FAIT

- **Intégré** : colonnes `Asset.wordTimings` et `Asset.timingSource` (migration `20261123120000_voice_word_timings`) ; `createPrismaVoiceStore(db)` dans `ports.ts` remplace `createUnconfiguredVoiceStore()` (Asset VOICE unique par clé + coût sur la vidéo en une transaction ; horodatage Whisper écrit une seule fois, coût compris). Test d'intégration : `ports.integration.test.ts`. `Asset.title` (facultatif) n'est pas fait.

- **Quoi** : `generationKey String? @unique` sur `Asset` (même besoin que l'agent 5, point 2) et un champ pour l'horodatage, par exemple `wordTimings Json?` (+ migration). Puis une vraie implémentation de `VoiceStore` (`agents/06-voix-son/voice.ts`) à la place de `createUnconfiguredVoiceStore()` dans `ports.ts` :
  - `findVoice(key)` : l'`Asset` VOICE dont `generationKey = key`, avec `url`, `provider`, `durationS`, `wordTimings` (`timingSource` : `"tts"` ou `"stt"`, à stocker aussi, ou dans le même JSON) ;
  - `countVoices(videoId)` : déjà écrit ;
  - `recordVoice(record)` : dans une transaction, `Asset` VOICE (`url`, `provider`, `durationS`, `generationKey`, horodatage) **et** `Video.totalCost += record.cost`. Une violation d'unicité sur la clé = déjà fait, à ignorer ;
  - `recordTimings(key, words, cost)` : horodatage Whisper sur l'Asset de la clé, et `Video.totalCost += cost`.
- **Pourquoi** : CLAUDE.md §8 bis (« un worker qui redémarre ne relance jamais une génération payante déjà réussie »). La clé vaut `videoId:voix:tentative:empreinte` (empreinte = SHA-256 de `{ text, voiceId, speed }`) : une relance de l'étape qui produit le **même** texte réutilise la voix déjà payée ; un texte coupé ou modifié en fait une nouvelle ; « Régénérer la voix » est une nouvelle tentative. Sans colonne, `recordVoice` lève une erreur explicite ; il n'est jamais atteint tant qu'aucun TTS n'est branché.
- **Facultatif** : `Asset.title String?`, pour ne plus ranger le titre d'une piste choisie à la main dans `provider`.

## 5. Plan sonore périmé à la reprise de VISUALS_AND_AUDIO : FAIT (session principale, `staleDeliverables` dans `lib/pipeline/service.ts`)

- **Quoi** : le point 5 de `agents/05-directeur-artistique/NEEDS.md` (remettre `storyboardJson` **et** `audioJson` à `null` quand la vidéo entre dans `VISUALS_AND_AUDIO`, ou comparer leur date d'écriture à la dernière transition dans `completeStage`).
- **Pourquoi, côté son** : après un renvoi V3 ou une reprise, l'ancien `audioJson` reste en base. Si l'agent 5 finit avant moi, `completeStage` voit les deux JSON et passe au montage **avec l'ancienne voix** ; mon `onSuccess` voit alors la vidéo au montage et ne fait rien (idempotence). De mon côté, `audioJson` n'est écrit qu'une fois la voix et la musique réglées, et jamais quand je bloque la vidéo.

## 6. Pour le monteur (agent 7) et le contrôle qualité (agent 8) : FAIT (le monteur lit `parseStoredAudioPlan`)

- **`schema.ts` est inchangé** : la sortie du modèle garde son format. L'agent 8 lit `audioJson` avec `outputSchema` (`texte_tts`) ; Zod ignore le bloc ajouté, testé dans `definition.test.ts`.
- **`audioJson` = sortie normalisée + bloc `production`**, décrit par `audioPlanSchema` (`agents/06-voix-son/audioPlan.ts`, à importer par l'agent 7) :
  - `{{URL_VOIX}}` = `production.voix.url`, `{{DUREE_VOIX_S}}` = `production.voix.duree_s` (mesurée), `{{MOTS_HORODATES}}` = `production.voix.mots` (`{ word, startS, endS }`) ;
  - `production.musique` : `titre`, `url`, `fournisseur`, `licence` (jamais vide), `source` (`banque` ou `manuel`) ;
  - `texte_tts` est le texte **réellement prononcé** (coupes appliquées, listées dans `production.voix.coupes_appliquees`) ;
  - sans storyboard au moment de l'appel, `effets[].plan` vaut `B1`, `B2`… (numéro du beat) au lieu d'un id de plan : le monteur doit accepter les deux.
- Les Assets VOICE et MUSIC existent aussi (avec licence pour la musique), lus par l'agent 8 dans `formatAudioPlan`.

## 7. Suggestion de prompt (seulement avec ton accord) : EN ATTENTE de ta décision

- Le prompt dit « propose des coupes » sans en fixer la forme. Le code exige que chaque coupe **recopie exactement** un passage de `texte_tts` (refus renvoyé au modèle sinon), pour pouvoir l'appliquer en code. Une phrase dans `prompt.md` (« chaque coupe recopie mot pour mot le passage à supprimer ») éviterait des relances. Je n'ai pas modifié `prompt.md`.

## 8. Divers : régénération au montage FAIT (`restartEdit`) ; plafond mensuel EN ATTENTE

- **Plafond mensuel** (`BUDGET_MENSUEL`) : non vérifié ici, comme pour l'agent 5 (à faire dans le worker ou les providers, pour tous les agents).
- **Régénérer la voix au montage** : le panneau le permet (avant le rendu). Si l'agent 7 a déjà produit sa timeline, elle garde l'ancienne voix : relancer le montage après une régénération à l'étape `EDIT` (à décider côté pipeline).

## À savoir (rien à faire) : décisions du fork

- **Sans TTS, l'agent bloque la vidéo avec une alerte claire** (au lieu d'enregistrer un plan sans voix). Raison : le monteur a besoin de la voix, de sa durée réelle et de l'horodatage. Un `audioJson` sans voix laisserait l'agent 5 faire passer la vidéo au montage, où rien ne peut être recalé. Le modèle tourne quand même (`{{TTS}}` et `{{BALISES_TTS}}` lui disent qu'aucun moteur n'est branché : ponctuation seulement) ; sa sortie reste visible dans le panneau (dernier AgentRun) et dans le prompt de la relance si l'humain ajoute une note. Message : « Voix et son : aucun moteur de synthèse vocale n'est branché : le plan sonore est prêt (panneau Voix et son) mais la voix n'a pas été générée. Branche un TTS, puis relance l'étape. »
- **Tout ce qui manque est vérifié avant de payer** : moteur TTS, identité de la voix (`identite.voix` de la bible, « moteur / id »), musique (choix de l'humain d'abord, puis banque). Les raisons manquantes sont réunies dans un seul blocage.
- **Budget par vidéo (CLAUDE.md §5.7)** : avant chaque génération, `estimateCost` est comparé à `BUDGET_PAR_VIDEO − Video.totalCost − prix de la piste`. Au-delà, ou budget absent alors qu'il y a quelque chose à payer : blocage, rien n'est généré. La même règle vaut pour la seconde génération (voix coupée) et pour « Régénérer la voix ».
- **Durée réelle hors cible** (cible = `format_video.duree_cible_s` de la bible) :
  - trop longue : les `coupes_si_trop_long` sont appliquées **en code**, dans l'ordre proposé, jusqu'à passer sous le maximum, estimé au **débit mesuré** de la voix ; puis **une seule** nouvelle génération. Si les coupes ne suffisent pas d'après l'estimation, rien n'est régénéré. Encore trop longue après coupe : blocage. Pourquoi ce mécanisme : déterministe, sans nouvel appel au modèle, coût borné (au plus deux voix), et le prompt interdit d'accélérer au-delà de ×1,1 (on n'accélère pas du tout) ;
  - trop courte : blocage (rien à couper ; l'humain rallonge le texte ou relance l'étape avec une note).
- **Contrôles en code** (renvoyés au modèle) : `idee_id` du script ; une direction par beat ; pas de chiffres dans `texte_tts` (nombres en toutes lettres) ; balises du moteur seulement, aucune sans moteur ; au moins 85 % des mots de la voix du script (les coupes vont à part) ; prononciations complètes ; mots appuyés présents dans le texte ; 4 à 8 effets, chacun dans son plan (ou son beat) à 0,25 s près et avant la fin du script ; licence requise qui exige l'usage commercial ; mots-clés de recherche ; tempo de 40 à 220 BPM ; musique de 18 à 22 dB sous la voix ; coupes recopiées du texte ; si la voix estimée (mots ÷ débit de la bible) dépasse la cible, coupes obligatoires et suffisantes.
- **Recalculs en code** (`normalize`) : `cible_lufs` = `format_video.loudness_lufs` de la bible (−14 par défaut), `ducking` forcé à `true`, écart de la musique toujours négatif, effets triés dans le temps, listes nettoyées et dédoublonnées. La durée estimée de la voix est enregistrée dans `production.duree_estimee_s`.
- **Note de l'humain** (renvoi V3, reprise) : ajoutée à `{{SCRIPT}}` sous « CORRECTION DEMANDÉE PAR L'HUMAIN », suivie du plan sonore précédent (sans l'horodatage).
- **Idempotence** : `onSuccess` ne fait rien si la vidéo a quitté `VISUALS_AND_AUDIO`, relit l'étape avant chaque génération payante et retrouve la voix déjà payée par sa clé. Une piste de la banque n'est enregistrée qu'une fois par URL.
