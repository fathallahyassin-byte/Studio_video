# Besoins de l'agent 10 hors de son dossier

Ce que le fork de l'analyste n'a pas pu faire lui-même, avec le pourquoi. Par ordre d'importance.

## 1. Import quotidien des statistiques (étape 8) — bloquant pour avoir un rapport

Sans `Stat`, l'analyste ne tourne pas (voir § 2). Ce qu'il attend de l'import :

- **Une ligne `Stat` par publication et par jour** (`@@unique([publicationId, date])`), avec les **valeurs cumulées depuis la mise en ligne** à la date du relevé (pas l'incrément du jour). L'analyste lit le dernier relevé de chaque publication (`date <= maintenant`), comme l'écran Statistiques.
- `completionRate` entre 0 et 1, `avgWatchTimeS` en secondes.
- **`Publication.publishedAt` renseigné** pour toute publication `PUBLISHED` : c'est lui qui sert à la fenêtre de 4 semaines et à l'exclusion des vidéos de moins de 72 h. Une publication sans date n'est jamais comparée.
- **Fréquence** : une fois par jour, et **avant 6 h le lundi** (le planning lance l'analyse à 6 h, `jobs/schedule.ts`). Idéalement à 5 h le lundi.
- **Colonnes demandées par le prompt et absentes de `Stat`** : `retention_3s`, `commentaires`, `part_trafic_recherche`. Aujourd'hui le code les signale au modèle dans `colonnes_absentes`. Si les API les donnent, ajouter `retention3s Float?`, `comments Int?`, `searchTrafficShare Float?` à `Stat` ; je les brancherai dans `stats.ts` / `variables.ts`.

## 2. Pas assez de données : terminer la tâche au lieu de la relancer toutes les heures

Décision prise dans ce fork : **précondition, le modèle n'est jamais appelé** quand aucune publication des 28 derniers jours n'a à la fois plus de 72 h et un relevé. Un texte « pas de données » aurait poussé le modèle à remplir quand même 3 enseignements, 2 expériences et un verdict, donc à inventer.

`buildVariables` lève `NotEnoughDataError` (dans `agents/10-analyste/definition.ts`), sous-classe de `AgentPreconditionError`. Aujourd'hui, `jobs/handlers.ts` la traite comme toute précondition : relance toutes les heures, alerte à la première prise. Ça marche (l'analyse part dès que les statistiques arrivent), mais :

- la tâche de la semaine reste en file indéfiniment, et la semaine suivante en crée une autre : deux analyses peuvent partir ensemble sur les mêmes données ;
- l'alerte « Analyste ne peut pas démarrer » arrive chaque lundi tant qu'aucune vidéo n'est publiée.

**Demande** : dans `classifyError` (`jobs/handlers.ts`), avant le cas `AgentPreconditionError`, ajouter

```ts
if (error instanceof NotEnoughDataError) return { kind: "done", note: reason };
```

(import depuis `@/agents/10-analyste/definition`), ou mieux une classe générique `AgentSkippedError` dans `lib/agents/errors.ts` dont `NotEnoughDataError` hériterait. Pas d'alerte : le panneau affiche déjà « Pas encore de statistiques à analyser ». Le bouton « Lancer l'analyse » permet de relancer à la main.

## 3. `requestAnalysisRerun` dans `lib/pipeline/service.ts`

« Lancer l'analyse » réutilise `requestAnalysis` (une tâche par semaine ISO, partagée avec le planning du lundi). Quand celle de la semaine est déjà **terminée** (DONE ou FAILED), le bouton crée une relance `analyse:<chaîne>:<semaine>:relance-N` directement dans `AgentJob` (`agents/10-analyste/humanPorts.ts`, `queueRerun`), et refuse s'il y a déjà une analyse en file ou en cours.

**Demande** : déplacer `queueRerun` dans `lib/pipeline/service.ts` (à côté de `requestAnalysis`, comme `requestRender`), pour que toute la création de tâches reste dans le pipeline. Je remplacerai alors l'implémentation du port.

## 4. Créneaux pour l'agent 9 (`{{CRENEAUX}}`)

Le prompt de l'agent 10 ne produit pas de liste de créneaux : le créneau n'est qu'une dimension de ses comparaisons. Pour `{{CRENEAUX}}` de l'agent 9, je propose de **ne pas passer par le modèle** : l'agent 9 (ou `lib/`) peut appeler le calcul en code de l'analyste.

- `buildSnapshot` (`agents/10-analyste/snapshot.ts`) produit `groups` ; les entrées `dimension: "creneau"` donnent, pour chaque créneau « jour heure » (heure locale du serveur, ex. « mardi 18 h »), le nombre de publications comparables et l'indice médian (1 = médiane de la plateforme).
- Si le fork 9 veut ce format, il suffit d'exporter une fonction `recommendedSlots(channelId)` ; je peux l'écrire dans mon dossier (lecture seule de la base via `loadPeriod`) si la session principale me le demande. À trancher avec le fork 9 (le créneau par plateforme serait plus juste : à ajouter alors à `GroupStat`).

## 5. Backlog : le veilleur ne lit pas `maj_backlog`

Le rapport contient `maj_backlog` (`prioriser`, `abandonner`, `series`), affiché sur le panneau, mais aucun agent ne le lit. Le veilleur (agent 2) ne lit que `enseignements` du dernier `AnalystReport` (`agents/02-veilleur/prismaStore.ts`).

**Demande (fork 2 ou session principale)** : ajouter `maj_backlog` du dernier rapport dans `{{APPRENTISSAGES}}` ou `{{BACKLOG_EXISTANT}}` du veilleur (« à prioriser », « à abandonner », « à décliner en série »).

## 6. Décisions à reporter dans `docs/decisions.md`

- **« Appliquer à la bible » adopte directement la nouvelle version** (pas de brouillon). L'humain voit et coche les lignes ajoutées avant de cliquer ; seule la liste `apprentissages` change ; l'ancienne version reste dans l'historique de l'écran Bible et « Remettre en service » la rétablit en un clic. Un brouillon aurait demandé un second geste et serait devenu périmé à la moindre édition de la bible active.
- Nouvelle version : auteur `AGENT_10`, note « Apprentissages de l'analyste (2026-W48), ajoutés à la vN », lignes préfixées `[2026-W48]`, ligne « aucun pour l'instant » du modèle retirée, doublons ignorés. Une transaction : création de la version, `appliedBibleVersionId` posé seulement s'il était vide (sinon tout est annulé), adoption. Un double clic ne crée qu'une version.
- Classement : indice d'une publication = moyenne de (vues / médiane) et (vue complète / médiane) de sa plateforme ; indice d'une vidéo = moyenne de ses plateformes. Top et flop : 3 au plus chacun, `ceil(n/2)` et `floor(n/2)` pour n vidéos comparables, le top toujours au-dessus du flop.
- Le modèle ne cite que des pourcentages présents dans les données calculées (à 1 point près) ; sinon la sortie est refusée et renvoyée avec la liste des chiffres en trop.
- « Clore » une expérience en cours (RUNNING → DONE) depuis le panneau, en plus de « Lancer ».

## 7. Facultatif

- `Video.publishedAt` n'existe pas : le créneau est lu sur chaque `Publication`. Rien à faire si ça convient.
- Fuseau horaire : les créneaux sont en heure locale du serveur (`TZ`), comme le planning du worker. À fixer (`TZ=Europe/Paris`) sur l'hébergement (étape 9).
