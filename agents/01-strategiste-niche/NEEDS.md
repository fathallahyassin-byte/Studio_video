# Besoins de l'agent 1 hors de son dossier

## 1. Mettre une tâche de l'agent 1 en file depuis `lib/pipeline`

- **Demande** : ajouter à `lib/pipeline/service.ts` une fonction publique, par exemple
  `requestStrategy(deps, { channelId, jobKey, payload })`, qui crée une `AgentJob` (`kind: "AGENT"`, `agentId: 1`, `videoId: null`, `payload`) et renvoie `{ queued: false }` sur un conflit de `jobKey` (P2002), comme `requestWeekly`.
- **Pourquoi** : `requestWeekly` est privée, ne prend pas de payload et impose une clé par semaine ISO. L'agent 1 a besoin du formulaire en payload et d'une clé par formulaire (`strategie:<chaîne>:<jour>:<empreinte du formulaire>`, voir `launch.ts`).
- **Repli en place** : `createPrismaLaunchPorts().enqueueStrategy` (`ports.ts`) crée la ligne `AgentJob` lui-même. Ce n'est pas un contournement : la ligne `AgentJob` est la file, le worker la prend comme les autres. Une fois la fonction ajoutée, il suffit que ce port l'appelle.

## 2. Partager l'activation d'une bible avec l'écran Bible

- **Demande** : extraire de `app/(dashboard)/bible/actions.ts` (`activateBibleVersion`) une fonction `activateBibleVersion(db, { channelId, versionId })` dans `lib/bible/store.ts`, qui ne fait que déplacer `Channel.activeBibleVersionId` (et recopier `chaine.niche` dans `Channel.niche`).
- **Pourquoi** : « Adopter cette bible » (page de l'agent 1) et « Remettre en service » (écran Bible) font la même écriture. Le fork ne peut pas importer proprement une Server Action d'`app/`, qui appelle elle-même `requireOwner` et `revalidatePath`.
- **Repli en place** : `createPrismaAdoptionPorts().activateBible` (`ports.ts`) refait la même mise à jour de `Channel`. Aucune `BibleVersion` n'est modifiée.

## 3. Relier un brouillon à sa tâche par une colonne

- **Demande** : ajouter `BibleVersion.sourceJobId String? @unique` (id de l'`AgentJob` qui a produit la version, null pour les versions humaines).
- **Pourquoi** : l'idempotence d'`onSuccess` (un seul brouillon par tâche, même rejoué après un crash) repose aujourd'hui sur la note du brouillon, qui se termine par `(tâche <jobId>)` (`draft.ts`, `draftMarker` dans `ports.ts`). Une colonne unique la garantirait en base, même avec deux workers, et simplifierait la lecture du panneau (`ui/loadStrategy.ts` retrouve la tâche par la `jobKey` de l'AgentRun, puis le brouillon par la note).
- **Repli en place** : la note. Le numéro de version est calculé dans une transaction et `@@unique([channelId, version])` refuse un doublon simultané.

## 4. Rappel mensuel

- **Demande** : dans le planning du worker (`jobs/`), le 1ᵉʳ de chaque mois, une notification « Relancer l'analyse des niches » avec le lien `/agents/01-strategiste-niche`. Pas de tâche automatique : le formulaire (pistes, temps, budget, objectif) doit être relu par l'humain avant chaque analyse.
- **Pourquoi** : AGENT.md prévoit un déclenchement manuel « au lancement, puis une fois par mois ». Le formulaire de la page reprend les réponses de la dernière analyse : relancer prend un clic.

## 5. Payload invalide : ne pas réessayer toutes les heures

- **Demande** : distinguer dans `jobs/handlers.ts` une erreur d'entrée définitive (par exemple une sous-classe `AgentInputError` d'`AgentPreconditionError`) qui termine la tâche en `FAILED` avec une alerte, au lieu de la remettre en file toutes les heures.
- **Pourquoi** : un payload refusé par Zod (`payload.ts`, `readStrategyPayload`) ne deviendra jamais valide. Aujourd'hui, `AgentPreconditionError` → nouvel essai dans 1 h, sans fin. Priorité faible : la Server Action valide le formulaire avec le même schéma avant la mise en file, ce cas ne vient que d'une tâche créée à la main.

## À savoir (rien à faire)

- **Notification du brouillon** : à la création du brouillon, `onSuccess` envoie une notification `validation_waiting` (« Bible proposée : à adopter », lien vers la page de l'agent). Elle n'est pas renvoyée quand `onSuccess` est rejoué. Un type dédié (`bible_draft`) serait plus juste si les notifications sont un jour filtrées par type.
- **Contrôles en code ajoutés**, tous tirés du prompt : niches uniques avec public et angle ; 12 candidates si moins de 8 pistes ; une justification par note ; top 3 = les 3 meilleurs scores recalculés (égalité avec le 3ᵉ acceptée) ; 10 titres distincts et 3 comptes ou formats à étudier par niche du top 3 ; niche recommandée dans le top 3, avec une raison et au moins un risque ; plan de test de 20 vidéos en 4 semaines avec un critère chiffré ; bible lisible par `checkBible`, sans `{{…}}` restant, avec toutes les clés du modèle sur deux niveaux (`chaine`, `chaine.nom`…). Les notes hors de 1 à 5 sont déjà refusées par `schema.ts`.
- **`{{CONTRAINTES}}`** ajoute « Langue : français (fr-FR) » : le prompt la cite parmi les contraintes et le modèle de bible fixe `langue: fr-FR`. Le formulaire n'a pas de champ « centres d'intérêt » (AGENT.md ne le demande pas) : les pistes en tiennent lieu.
- **Adoption** : la nouvelle `BibleVersion` est créée par `onSuccess` (brouillon, auteur `AGENT_1`, non active) ; « Adopter cette bible » ne fait que déplacer le pointeur de la chaîne, après avoir vérifié que la version est un brouillon de l'agent 1 de la même chaîne, lisible et sans `{{…}}`. L'écran Bible montre déjà ces brouillons avec un bouton « Adopter cette bible ».
