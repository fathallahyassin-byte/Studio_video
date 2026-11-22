# Besoins de l'agent 4 hors de son dossier

## 1. Passer le contexte de l'appel à `normalize` et `controls` (contrat `agents/_shared/types.ts`)

- **Quoi** : donner `ctx: AgentContext` (au moins `bible`) à `normalize(output, input, ctx)` et `controls(output, input, ctx)`, comme à `buildVariables` et `onSuccess`. `runAgent` l'a déjà sous la main (`prepared.ctx`).
- **Pourquoi** : le scénariste recompte les mots avec le débit de la bible (`format_video.debit_voix_mots_par_s`) et la durée visée. Aujourd'hui `normalize` ne reçoit pas la bible : `definition.ts` garde la cible et les faits lus par `buildVariables` dans une `WeakMap` indexée par l'objet `input` (le même pour toute l'exécution de `runAgent`). Ça marche et ça ne fuit pas, mais ça repose sur un détail d'implémentation de `runAgent`.
- **Côté fork, une fois fait** : supprimer la `WeakMap` de `definition.ts` et relire la cible depuis `ctx.bible` (environ 10 lignes).

## 2. Exposer le débit de la voix dans `checkBible` (`lib/bible/bible.ts`)

- **Quoi** : ajouter `debitVoix: number` (ou `wordsPerSecond`) à `BibleFields`, lu dans `format_video.debit_voix_mots_par_s`, que le schéma valide déjà.
- **Pourquoi** : `checkBible` ne renvoie que `dureeMin` et `dureeMax`. `variables.ts` relit donc le YAML une deuxième fois (`yaml.parse` + un petit schéma Zod) pour le débit.
- **Côté fork, une fois fait** : `parseScriptTarget` lit `checked.fields.debitVoix` et le second parsing disparaît.

## 3. Suggestion : V2 avec les faits et les compteurs

- **Quoi** : dans le détail V2 de « À valider », afficher sous chaque beat ses ids de faits cliquables (fait, confiance, source) et les compteurs mots / durée / écart, comme le panneau `/agents/04-scenariste`. Les fonctions pures sont prêtes : `toScriptView`, `computeCounters`, `formatGap` dans `agents/04-scenariste/ui/scripts.ts`, et `parseScriptTarget` dans `variables.ts`.
- **Pourquoi** : c'est en V2 que l'humain décide avant toute génération payante. Il voit les beats, mais pas les faits qu'ils citent ni l'écart à la durée cible.

## À savoir (rien à faire)

- **Contrôles en code ajoutés** au-delà des faits et du nombre de mots, tous tirés du prompt : frise sans trou ni chevauchement (tolérance 0,05 s), de 0 s à une fin comprise dans `duree_cible_s` ; structure accroche (fin ≤ 3 s) → contexte → révélations (3 au plus) → chute → boucle ; phrases de 12 mots au plus ; texte écran de 3 à 6 mots par beat ; 3 accroches de types différents, sans « Salut », « Dans cette vidéo » ni « Le saviez-vous » ; `idee_id` identique à celui de l'idée. Tous les refus partent dans un même message de relance.
- **Note de l'humain** (correction V2 ou reprise) : ajoutée à `{{IDEE}}` sous l'intitulé « CORRECTION DEMANDÉE PAR L'HUMAIN », suivie du script précédent s'il existe. Pas dans `{{APPRENTISSAGES}}`, que le prompt présente comme les enseignements de l'analyste.
- **`{{DUREE_S}}`** vaut le milieu exact de `duree_cible_s` : 77.5 avec le modèle de bible ([65, 90]). Avec 2,6 mots/s, la cible est de 192 à 211 mots.
- **`{{DERNIERS_SCRIPTS}}`** : un résumé par script publié (titre, ouverture et son type, ordre des rôles, dernière phrase), pas le JSON complet, pour limiter les tokens.
- **Données de démo** : les scripts de `lib/demo/demoData.ts` ont des textes écran de 2 mots (« Pourquoi jaune ? ») et un nombre de mots qui ne correspond pas à leur durée. Ils restent lisibles par le schéma ; seuls les nouveaux scripts de l'agent sont contrôlés.
