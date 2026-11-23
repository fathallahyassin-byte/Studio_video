# Besoins de l'agent 1 hors de son dossier

## 1. Mettre une tâche de l'agent 1 en file depuis `lib/pipeline` : FAIT

- **Intégré** : `requestStrategy(deps, { channelId, jobKey, payload })` dans `lib/pipeline/service.ts` crée la tâche `AGENT` de l'agent 1 (sans vidéo, formulaire en payload) et renvoie `{ queued: false }` si la clé existe déjà. `requestWeekly` (veille, analyse) passe par la même fonction interne. `createPrismaLaunchPorts().enqueueStrategy` (`ports.ts`) l'appelle.
- **Pourquoi** : `requestWeekly` était privée, sans payload, avec une clé par semaine ISO ; l'agent 1 a une clé par formulaire (`strategie:<chaîne>:<jour>:<empreinte>`, `launch.ts`).

## 2. Partager l'activation d'une bible avec l'écran Bible : FAIT

- **Intégré** : `activateBibleVersion(db, { channelId, versionId })` dans `lib/bible/store.ts` (pointeur `Channel.activeBibleVersionId` et `Channel.niche`, aucune `BibleVersion` modifiée). L'écran Bible (« Remettre en service ») et « Adopter cette bible » (`createPrismaAdoptionPorts().activateBible`) l'appellent tous les deux.

## 3. Relier un brouillon à sa tâche par une colonne : FAIT

- **Intégré** : `BibleVersion.sourceJobId String? @unique` (migration `20261123120000_strategist_needs`). `onSuccess` enregistre l'id de la tâche dans le brouillon et le retrouve par cette colonne à la reprise ; la note du brouillon ne sert plus qu'à l'affichage (« Proposée par le stratège de niche : « … » »).
- **Pourquoi** : l'idempotence reposait sur la fin de la note ; la contrainte unique la garantit en base, même avec deux workers.

## 4. Rappel mensuel : FAIT

- **Intégré** : `sendDueReminders` (`jobs/schedule.ts`), appelé par le worker avec le planning : le 1ᵉʳ du mois à partir de 9 h (rattrapé le reste du mois), une notification `reminder` « Analyse des niches du mois » avec le lien vers la page de l'agent 1. Rien si l'agent 1 est désactivé ou si une analyse a déjà été lancée dans le mois. Une ligne `Reminder` (clé `strategie:<chaîne>:<AAAA-MM>`) est écrite avant l'envoi : un redémarrage ne renvoie jamais le rappel. Pas de tâche automatique : le formulaire est relu par l'humain.

## 5. Payload invalide : ne pas réessayer toutes les heures : FAIT

- **Intégré** : `AgentInputError` (`lib/agents/errors.ts`, sous-classe d'`AgentPreconditionError`). `jobs/handlers.ts` (`classifyError`) termine la tâche en `FAILED` et alerte l'humain au lieu de la remettre en file. `readStrategyPayload` (`payload.ts`) la lève.

## À savoir (rien à faire)

- **Notification du brouillon** : à la création du brouillon, `onSuccess` envoie une notification `validation_waiting` (« Bible proposée : à adopter », lien vers la page de l'agent). Elle n'est pas renvoyée quand `onSuccess` est rejoué.
- **Contrôles en code ajoutés**, tous tirés du prompt : niches uniques avec public et angle ; 12 candidates si moins de 8 pistes ; une justification par note ; top 3 = les 3 meilleurs scores recalculés (égalité avec le 3ᵉ acceptée) ; 10 titres distincts et 3 comptes ou formats à étudier par niche du top 3 ; niche recommandée dans le top 3, avec une raison et au moins un risque ; plan de test de 20 vidéos en 4 semaines avec un critère chiffré ; bible lisible par `checkBible`, sans `{{…}}` restant, avec toutes les clés du modèle sur deux niveaux (`chaine`, `chaine.nom`…). Les notes hors de 1 à 5 sont déjà refusées par `schema.ts`.
- **`{{CONTRAINTES}}`** ajoute « Langue : français (fr-FR) » : le prompt la cite parmi les contraintes et le modèle de bible fixe `langue: fr-FR`. Le formulaire n'a pas de champ « centres d'intérêt » (AGENT.md ne le demande pas) : les pistes en tiennent lieu.
- **Adoption** : la nouvelle `BibleVersion` est créée par `onSuccess` (brouillon, auteur `AGENT_1`, non active) ; « Adopter cette bible » ne fait que déplacer le pointeur de la chaîne, après avoir vérifié que la version est un brouillon de l'agent 1 de la même chaîne, lisible et sans `{{…}}`. L'écran Bible montre déjà ces brouillons avec un bouton « Adopter cette bible ».
