# Besoins de l'agent 9 hors de son dossier

Par ordre de priorité. Le point 1 est à faire avant la première vraie publication (étape 7 de la feuille de route).

## 1. Tâche planifiée « publier à l'heure prévue » (bloquant)

- **Besoin** : à l'heure de chaque `Publication` `SCHEDULED`, appeler `runPublication(createPrismaPublishingPorts(), publicationId, { slot })` (`agents/09-publication/publishing.ts` et `publishingPorts.ts`) et appliquer son résultat comme un `JobOutcome` (même forme : `done`, `retry`, `failed`).
  - Proposition : un `JobKind` `PUBLISH` (migration), une `AgentJob` par publication et par créneau, clé `publish:<publicationId>:<scheduledFor ISO>`, `runAfter = scheduledFor`, `payload = { publicationId, slot }`. Le planning du worker (`jobs/schedule.ts`) crée chaque minute les tâches manquantes des publications `SCHEDULED` dont le créneau est dû (`createMany` + `skipDuplicates` : jamais deux tâches pour le même créneau).
  - Créneau modifié sur la page de l'agent : la clé change, une nouvelle tâche est créée ; l'ancienne reçoit `slot` différent et ne fait rien (« Créneau modifié »), donc pas de double notification.
  - `handleJob` (`jobs/handlers.ts`) : brancher `kind === "PUBLISH"` vers `runPublication`. Un `failed` doit alerter l'humain (c'est déjà ce que fait `applyOutcome`).
- **Ce que fait déjà `runPublication`** : refuse sans V3 approuvée (le fournisseur n'est jamais appelé), sans rapport qualité lisible, sans textes lisibles, ou si la vidéo n'est plus `SCHEDULED`/`PUBLISHED` ; attend si l'heure n'est pas venue ; en mode `MANUAL` (ou fournisseur pas prêt), envoie la notification « À publier à la main : TikTok · V-031 » avec la légende et le lien `/agents/09-publication?video=…` ; en mode `API`, prend la publication (`SCHEDULED → PUBLISHING`, atomique), publie, passe en `PUBLISHED` puis la vidéo en `PUBLISHED` (événement `PUBLISHED` de `lib/pipeline`, acteur système). Une erreur du fournisseur met la publication en `FAILED` et n'est **jamais** relancée seule (risque de double publication) : l'humain vérifie et clique « Marquer comme publié ». Une publication restée `PUBLISHING` (crash pendant l'envoi) non plus.
- **Pourquoi** : AGENT.md, « À l'heure prévue : publication par API si le provider est prêt, sinon notification ». Le planning et la file sont dans `jobs/`, hors du dossier du fork.

## 2. Fournisseurs de publication, plateforme par plateforme

- **Besoin** : une fonction `getPublishProvider(platform): PublishProvider | null` dans `lib/providers/publish.ts` (null tant qu'une API n'est pas branchée), puis remplacer dans le dossier de l'agent (je peux le faire après rebase) :
  - `isProviderReady: () => false` dans `ports.ts` (mode `API` ou `MANUAL` à la création des `Publication`) ;
  - `providerFor: () => null` dans `publishingPorts.ts`.
- **Étendre `PublishRequest`** quand une API arrive : texte de couverture, commentaire épinglé (souvent impossible par API : il restera manuel), créneau (publication programmée côté plateforme ou par notre tâche), niveau de confidentialité TikTok. Aujourd'hui `buildPublishRequest` envoie légende (ou description), hashtags, titre YouTube et les étiquettes : `aiLabel` = étiquette du rapport qualité, jamais plus basse que celle enregistrée dans `Publication`.
- **À revérifier avant de brancher une API** (CLAUDE.md §7, règles relevées en novembre 2026 et non revérifiées par ce fork) :
  - YouTube Data API v3 `videos.insert` : quota dédié de 100 uploads par jour ; `status.containsSyntheticMedia` = `Publication.aiLabel` de YouTube ; titre ≤ 100 caractères, description ≤ 5 000 octets, sans `<` ni `>` (`HARD_LIMITS` dans `platforms.ts`).
  - TikTok Content Posting API : tant que l'app n'a pas passé l'audit, publications privées et 5 comptes au plus par 24 h ; légende ≤ 2 200 caractères ; envoi par URL (`PULL_FROM_URL`) qui demande de vérifier le domaine du stockage S3 ; étiquette « contenu généré par IA » et « contenu de marque » dans la requête.
  - Instagram Graph API (Reels) : compte professionnel obligatoire ; conteneur puis publication ; légende ≤ 2 200 caractères ; **5 hashtags au plus** (règle annoncée fin 2025, appliquée en code et à revérifier) ; partenariat rémunéré.
  - Le texte de `HARD_LIMITS` est à corriger si l'une de ces limites a changé ; les tests de `rules.test.ts` suivront.

## 3. Créneaux recommandés par l'analyste (`{{CRENEAUX}}`)

- **Besoin** : quand l'agent 10 existera, une fonction de lecture des créneaux recommandés (ex. depuis le dernier `AnalystReport.content`), par plateforme, au format `AAAA-MM-JJTHH:MM` ou jour + heure. Je l'injecterai dans `formatSlotsVariable` (`variables.ts`).
- **En attendant (décision du fork)** : la variable commence par « NON DISPONIBLE : l'analyste (agent 10) n'a encore produit aucun créneau recommandé… », suivie de la date et l'heure actuelles (le modèle ne les connaît pas), des contraintes vérifiées en code et des créneaux déjà pris par d'autres vidéos de la chaîne. Aucun créneau n'est inventé comme venant de l'analyste.

## 4. Type de notification « à publier »

- **Besoin (facultatif)** : un `NotificationKind` `publish_manual` dans `lib/providers/notify.ts`. Aujourd'hui la notification manuelle utilise `validation_waiting` (c'est bien une action qui attend l'humain).

## 5. Données de démonstration

- `prisma/seed-demo.ts` crée des `Publication` sans `Video.publishJson` : le panneau affiche alors « Textes en préparation » pour ces vidéos. Pour voir l'écran complet en démo, renseigner `publishJson` avec une sortie conforme à `agents/09-publication/schema.ts` (voir `makeOutput()` dans `fixtures.ts`) et `qaJson`.

## 6. À noter dans `docs/decisions.md` (décisions du fork)

- **Mots-clés** (`{{MOTS_CLES}}`) : rangés dans `Agent.settings` de l'agent 9, clés `motsCles` (une ligne par mot-clé) et `motsClesMisAJour`, comme les signaux du veilleur. Aucun champ à ajouter. Liste vide : la variable dit « AUCUNE LISTE FOURNIE… ».
- **Fuseau** : les créneaux `AAAA-MM-JJTHH:MM` sont lus et affichés à l'heure locale du serveur (variable `TZ`), comme le planning du lundi. L'appli et le worker doivent avoir le même `TZ`.
- **`Video.publishJson`** = sortie normalisée de l'agent 9 (`schema.ts`), modifiable ensuite depuis la page de l'agent. Les étiquettes y sont toujours recopiées du rapport qualité (`readPublicationLabels`), au moment de l'agent comme à chaque enregistrement de l'humain ; le formulaire n'a aucun champ d'étiquette. Pour lire ce champ ailleurs : `parseTexts` (`ui/overview.ts`) ou `outputSchema`.
- **Publications créées** : une par plateforme de `Channel.platforms` (les trois si la liste est vide), en `SCHEDULED`, mode `MANUAL` tant qu'aucun fournisseur n'est prêt. `createMany` + `skipDuplicates` puis mise à jour des seules lignes encore `SCHEDULED` : une reprise ne crée aucun doublon et ne touche pas une publication déjà partie. Refus en code sans V3 approuvée (en plus du trigger SQL), avant tout appel au modèle (`buildVariables`) et dans `onSuccess`.
- **Vidéo `PUBLISHED`** dès sa première publication (manuelle ou par API) ; les autres plateformes restent programmées et partent ensuite. Attendre les trois bloquerait la vidéo si une plateforme est abandonnée.
- **Textes modifiés par l'humain** : seules les limites des plateformes (`HARD_LIMITS`, hashtags valides, texte non vide, créneau valide) s'appliquent ; les règles éditoriales du prompt (150 à 300 caractères, 3 à 5 mots de couverture…) ne s'imposent qu'au modèle.

## À savoir (rien à faire)

- **Contrôles en code** (chaque refus renvoyé au modèle) : TikTok légende 150 à 300 caractères avec le mot-clé principal (`mots_cles_vises[0]`) dans la 1re phrase, 3 à 5 hashtags, couverture de 3 à 5 mots, commentaire épinglé qui pose une question ; Instagram légende de 1 à 3 phrases, 1 à 5 hashtags, couverture de 3 à 5 mots ; YouTube titre de 40 à 70 caractères avec le mot-clé dans les trois premiers mots, description de 2 phrases (3 au plus), exactement 3 hashtags, commentaire épinglé ; limites des plateformes ; hashtags valides et hors du texte ; textes différents d'une plateforme à l'autre ; aucune autre plateforme citée ; 1 à 10 mots-clés ; créneaux valides, futurs, à 14 jours au plus et décalés d'au moins une heure.
- **Recalculs dans `normalize`** : étiquettes IA et contenu de marque recopiés du rapport qualité (le modèle ne peut pas les changer), `idee_id` repris de l'idée, hashtags normalisés (`#`, sans espace, sans doublon), mots-clés nettoyés.
- **`schema.ts` et `prompt.md`** : inchangés.
