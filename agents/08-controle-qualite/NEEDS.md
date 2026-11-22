# Besoins de l'agent 8 hors de son dossier

Par ordre de priorité. Les points 1 à 3 sont à faire avant le premier vrai contrôle qualité (étapes 5 à 7 de la feuille de route).

## 1. Transcription et captures du rendu : `{{TRANSCRIPTION}}` et `{{CAPTURES}}` (bloquant)

- **Besoin** : après chaque rendu, enregistrer (a) la transcription Whisper du MP4 final (texte, idéalement avec les mots horodatés) et (b) les descriptions de 5 images clés (première image, une par tiers, dernière image).
  - Stockage proposé : deux champs sur l'`Asset` de type `RENDER` (`transcript String?`, `frameDescriptions String[]`), ou sur `Video`. Une nouvelle transcription ou de nouvelles captures pour chaque nouveau rendu.
  - Les descriptions demandent un modèle capable de lire des images (appel payant) : interface dans `lib/providers/`, à noter dans `docs/decisions.md`.
  - Ensuite, `loadRenderEvidence` dans `agents/08-controle-qualite/ports.ts` lit ces champs (seule fonction à changer ; je peux le faire après le rebase).
- **Pourquoi** : sans elles, le contrôle ne peut pas vérifier les faits sur ce qui est vraiment dit (A1, A2), les sous-titres (E2), la bible (F1), les contenus protégés (C2) ni la première image et la boucle (E4).
- **En attendant (décision du fork)** : la variable contient « NON DISPONIBLE : … », qui dit au modèle de ne rien présumer et quels points seront marqués « ko ». En code, `normalize` force ces points en `ko` avec la preuve « NON VÉRIFIÉ : … », une correction et `agent_responsable` = `08-controle-qualite`. A1 et A2 étant bloquants, **chaque vidéo sort en NO_GO tant que la transcription n'existe pas**. C'est voulu : un GO sans vérification des faits sur la vidéo rendue n'aurait aucune valeur.
- **Pourquoi pas une précondition** : le worker relancerait la tâche toutes les heures sans jamais produire de rapport. Avec le rapport, l'humain voit exactement ce qui manque.

## 2. Copier les étiquettes dans les `Publication` (agent 9 ou module de publication)

- **Besoin** : à la création des `Publication`, lire les étiquettes avec `readPublicationLabels(video.qaJson)` (`agents/08-controle-qualite/labels.ts`), qui renvoie pour `TIKTOK`, `INSTAGRAM` et `YOUTUBE` : `{ aiLabel, brandedContent }`, déjà dans la forme des colonnes `Publication.aiLabel` et `Publication.brandedContent`.
  - Rapport absent ou illisible (`null`) : refuser la création de la publication.
  - YouTube : `status.containsSyntheticMedia` = `YOUTUBE.aiLabel` (CLAUDE.md §7).
  - Ne jamais recalculer ni baisser une étiquette dans le module de publication : le rapport, vu par l'humain en V3, fait foi.
- **Pourquoi** : critère « Les étiquettes sont copiées dans les Publications » d'AGENT.md. Les `Publication` n'existent pas encore ; les étiquettes sont gardées dans `Video.qaJson` (`etiquettes`), dans le format du schéma.

## 3. Reprendre un NO-GO chez l'agent responsable

- **Besoin** : un NO_GO appelle `blockVideo` (raison : « Contrôle qualité : NO-GO, renvoyé à 04-scenariste. Points ko : … »), donc `NEEDS_FIX` avec `blockedAt = QA`. Or « Relancer l'étape » ne sait que revenir en `QA`, ce qui relance le contrôle sur la même vidéo et redonne le même NO_GO. Il faut, pour une vidéo bloquée en `QA`, proposer dans le détail « À corriger » l'étape où la renvoyer (les `V3_RETURN_STAGES`), présélectionnée avec `suggestReturnStage(parseQaReport(qaJson))`, et accepter `returnTo` sur `RESUMED` dans `lib/pipeline/machine.ts`.
- **Pourquoi** : AGENT.md, « NO_GO → NEEDS_FIX, renvoyé à agent_responsable ».

## 4. Saisir le partenariat d'une vidéo

- **Besoin** : un champ « Partenariat commercial (marque et contrepartie, ou aucun) » sur la vidéo, qui écrit `Video.partnership`. Aucun écran ne permet de le modifier aujourd'hui.
- **Pourquoi** : `{{PARTENARIAT}}` en dépend. Avec un partenariat, le code impose `contenu_de_marque: true`, la mention « Collaboration commerciale » (ou « Publicité ») et « Images virtuelles » s'il y a des images IA ; sans partenariat, il refuse `contenu_de_marque: true`.

## 5. Lien vers la vidéo rendue

- **Besoin** : le panneau affiche « Voir la vidéo rendue » avec l'url du dernier `Asset` `RENDER`, seulement si c'est une url http(s). Si le stockage S3/R2 enregistre une clé plutôt qu'une url publique, il faudra une fonction d'url signée (`lib/storage`) que le panneau appellera.

## 6. Petites améliorations (facultatives)

- `suggestReturnStage` (`lib/dashboard/queries.ts`) : un « ko » attribué à `03-recherchiste` (un fait faux) mérite plutôt `SCRIPT` que `EDIT` par défaut. Les agents responsables du rapport sont toujours écrits sous la forme du catalogue (`04-scenariste`…), recalculée en code, donc `startsWith("04")` fonctionne.
- `lib/demo/demoData.ts` : le rapport de démonstration n'a que 7 points sur 16. Il reste lisible ; le panneau signale les « points absents du rapport ».
- `prompt.md` (avec ton accord seulement) : préciser que `agent_responsable` s'écrit comme dans le catalogue (`04-scenariste`) et que les 16 points sont attendus. Le code accepte déjà « Scénariste », « agent 4 »… et refuse le reste avec la liste des valeurs valides.

## À savoir (rien à faire)

- **Contrôles en code** (chaque refus est renvoyé au modèle) : exactement les 16 points A1 à F1, une fois chacun ; une preuve pour chaque point, même ok ou na ; un « ko » a une correction et un `agent_responsable` parmi les agents 1 à 9 ; un NO_GO ou un GO_AVEC_CORRECTIONS s'appuie sur au moins un « ko » ; `idee_id` identique à celui de l'idée ; résumé de 1 à 5 lignes ; étiquettes cohérentes avec les médias (voix de synthèse → TikTok et Instagram ; plan `label_ia_requis` → TikTok, Instagram et YouTube ; partenariat ↔ contenu de marque) ; mentions imposées (« Images générées par IA » pour un plan réaliste, « Collaboration commerciale » et « Images virtuelles » pour un partenariat).
- **Recalculs dans `normalize`** : décision recalculée d'après les points (la plus stricte l'emporte) ; points dépendant d'une source absente forcés en « ko » non vérifié (D3 et D4 restent sans objet sans partenariat) ; E1 forcé en « ko » si la durée de la timeline sort de `duree_cible_s` (tolérance 0,5 s) ; agent responsable mis sous la forme du catalogue ; mentions dédoublonnées.
- **Sources absentes ou illisibles** (storyboard, plan sonore, timeline) : même traitement que la transcription (point 1). Elles ne peuvent manquer que si une étape a été sautée : `MEDIA_DONE` exige le storyboard et le plan sonore.
- **Voix de synthèse** : le code considère que la voix off vient toujours de la synthèse vocale dès qu'il y a un plan sonore (CLAUDE.md §2). Si une voix humaine est un jour possible, il faudra un indicateur (fournisseur de l'`Asset` `VOICE`, par exemple).
- **Schémas des agents 5, 6 et 7** : le contrôle lit `plans[].type`, `plans[].label_ia_requis`, `texte_tts` et `duree_totale_s` avec les schémas actuels de leurs dossiers. Si leurs forks changent ces champs, `variables.ts` de l'agent 8 doit suivre.
- **Note de l'humain** (renvoi en contrôle depuis V3, reprise) : ajoutée à la fin de `{{HISTORIQUE}}`, dernière entrée avant la check-list, sous l'intitulé « NOTE DE L'HUMAIN (renvoi depuis la validation V3 ou reprise) : à vérifier en priorité », suivie des points ko du rapport précédent. Aucune variable de prompt n'est inventée.
- **Fichiers enregistrés** : les `Asset` image et vidéo (fournisseur, plan) sont ajoutés à `{{STORYBOARD}}`, les `Asset` voix et musique (fournisseur, licence) à `{{PLAN_SONORE}}`, pour vérifier C1 et D1 sur les fichiers réels.
