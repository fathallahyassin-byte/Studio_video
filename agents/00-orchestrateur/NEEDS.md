# Besoins de l'agent 0 hors de son dossier

L'orchestrateur est implémenté dans ce dossier mais **n'est déclenché nulle part** : aucune tâche `AgentJob` n'est créée pour l'agent 0. Tant que les points 1 et 2 ne sont pas intégrés, l'activer n'a aucun effet (c'est voulu : désactivé par défaut, CLAUDE.md §5.8).

## 1. Déclenchement par le pipeline (`lib/pipeline/service.ts`) — à brancher

**Quand** : à chaque changement d'étape d'une vidéo, dans la même transaction que `createStageJobs` (dans `applyEvent`), si et seulement si `Agent.active` de l'agent 0 est vrai (lu dans la transaction).

**Sur quelles vidéos** : la vidéo de la transition, pour toute étape d'arrivée **sauf** `IDEA` (transitoire), `REJECTED` et `PUBLISHED` (rien à proposer ; l'analyste a son propre planning). Les étapes humaines (`AWAITING_V1/V2/V3`, `NEEDS_FIX`) sont incluses : c'est là que l'orchestrateur rédige le résumé de 5 lignes et la question à l'humain, affichés sur sa page.

**Tâche créée** : `{ jobKey: "${transitionId}:agent-0", kind: "AGENT", agentId: 0, channelId, videoId, stage: <étape d'arrivée>, transitionId, note }`.
- Clé par transition : au plus une exécution par passage dans une étape, jamais de doublon après un redémarrage (même principe que les autres agents).
- `stage` renseigné : `handleJob` ignore déjà la tâche si la vidéo a changé d'étape entre-temps (proposition périmée).
- La tâche est indépendante de celle de l'agent de l'étape (pas d'attente entre les deux) : l'orchestrateur ne bloque jamais la production.

**Fréquence et coût** : au plus une exécution par transition, soit une douzaine par vidéo menée jusqu'à la publication. Aucune tâche planifiée (cron) n'est nécessaire. Le coût s'ajoute à `Video.totalCost` comme pour les autres agents (à noter dans `docs/decisions.md`).

**Pourquoi pas dans le worker (`jobs/schedule.ts`)** : un balayage périodique créerait des tâches sans lien avec un passage d'étape (clé d'idempotence floue, propositions en double). La transaction de `applyEvent` est l'endroit où la tâche ne peut être ni perdue ni doublée.

## 2. Agent désactivé : tâche ignorée sans alerte (`jobs/handlers.ts`)

Aujourd'hui, une tâche d'un agent inactif lève `AgentPreconditionError` dans `runAgent` → `retry` toutes les heures avec une alerte à la première prise. Pour l'agent 0 (désactivé par défaut), il faudrait plutôt, avant `runAgentJob` : si `job.agentId === 0` et l'agent est inactif → `{ kind: "done", note: "Ignorée : orchestrateur désactivé." }`.

Ce dossier limite déjà le problème : l'interrupteur « Désactivé » annule les tâches de l'agent 0 encore en file (`activation.ts`, `AgentJob.status = FAILED`, `lastError = "Annulée : orchestrateur désactivé."`). Si la session principale préfère que seule la file touche à `AgentJob`, déplacer cette annulation dans `lib/queue/`.

## 3. Trois échecs de l'orchestrateur : ne pas bloquer la vidéo (`lib/agents/runAgent.ts`)

`runAgent` appelle `markNeedsFix(videoId)` au 3ᵉ échec, quel que soit l'agent. Pour l'orchestrateur :
- à une étape humaine (`AWAITING_V1/V2/V3`), `blockVideo` lève une `TransitionError` (ces étapes ne sont pas dans `WORKING_STAGES`) : la tâche est réessayée jusqu'à `MAX_JOB_ATTEMPTS`, puis abandonnée ;
- à une étape de travail, un agent qui ne fait que **conseiller** mettrait la vidéo en `NEEDS_FIX` alors que l'agent de l'étape a peut-être réussi.

Proposition : un champ facultatif dans `AgentDefinition` (ex. `advisory: true`) qui, au 3ᵉ échec, alerte l'humain (`agent_failed`, lien vers `/agents/00-orchestrateur`) **sans** appeler `markNeedsFix`. Le critère d'AGENT.md « puis NEEDS_FIX » est respecté aujourd'hui par le comportement commun de `runAgent` (testé dans `definition.test.ts`) ; ce point demande ton arbitrage.

## 4. Facultatif : notifier la question posée à l'humain

La question (`question_humain`) est enregistrée dans la sortie de l'`AgentRun` et affichée sur la page de l'agent pour les vidéos bloquées. Les étapes humaines notifient déjà via le pipeline. Si tu veux en plus une notification quand l'orchestrateur pose une question hors étape humaine, il faut une clé de dédoublonnage (ex. une ligne `Reminder` de clé `orchestrateur:<jobKey>`, ou un `onSuccess` qui reçoit le `Notifier`) pour que `onSuccess` reste idempotent. Non fait ici.

## 5. `docs/decisions.md`

Ajouter une entrée « Orchestrateur (agent 0) » : il ne fait aucune transition et ses ports sont en lecture seule ; sa proposition est la sortie de l'`AgentRun` (aucune autre écriture) ; destinataires permis par étape (l'humain seul aux validations V1/V2/V3 et à `NEEDS_FIX`, l'agent que la machine lance sinon) ; vocabulaire de décision refusé dans la consigne d'un agent ; `BUDGET_PAR_VIDEO` absent = texte explicite et non précondition (l'orchestrateur ne dépense rien, les agents 5 et 6 refusent déjà toute génération sans budget) ; l'adresse de l'humain n'est jamais envoyée au fournisseur LLM (« humain » à la place).
