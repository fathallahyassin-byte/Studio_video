# Besoins de l'agent 4 hors de son dossier

## 1. Passer le contexte de l'appel à `normalize` et `controls` : FAIT

- **Intégré** : `normalize(sortie, input, ctx)` (éventuellement asynchrone) et `controls(sortie, input, ctx)` dans `agents/_shared/types.ts`, appelés par `lib/agents/runAgent.ts` avec le contexte de l'appel. `definition.ts` n'a plus de `WeakMap` : la cible vient de `ctx.bible`, les faits sont relus dans le dossier de la vidéo.
- **Pourquoi** : le recomptage des mots dépend du débit de la bible, que `normalize` ne recevait pas.

## 2. Exposer le débit de la voix dans `checkBible` : FAIT

- **Intégré** : `BibleFields.debitVoix` (`format_video.debit_voix_mots_par_s`), lu par `checkBible`, réécrit par `applyBibleFields` et modifiable dans le formulaire de la bible. `variables.ts` ne relit plus le YAML.

## 3. Afficher faits et compteurs en V2 : FAIT

- **Intégré** : le détail V2 de « À valider » affiche les mêmes briques que le panneau (`ui/ScriptParts.tsx`) : compteurs recalculés et écart avec la cible de la bible active, 3 accroches, frise minutée, beats avec ids de faits cliquables. `lib/dashboard/queries.ts` renvoie `review` (`toScriptContent`) au lieu du script brut.

## À savoir (rien à faire)

- **Contrôles en code ajoutés** au-delà des faits et du nombre de mots, tous tirés du prompt : frise sans trou ni chevauchement (tolérance 0,05 s), de 0 s à une fin comprise dans `duree_cible_s` ; structure accroche (fin ≤ 3 s) → contexte → révélations (3 au plus) → chute → boucle ; phrases de 12 mots au plus ; texte écran de 3 à 6 mots par beat ; 3 accroches de types différents, sans « Salut », « Dans cette vidéo » ni « Le saviez-vous » ; `idee_id` identique à celui de l'idée. Tous les refus partent dans un même message de relance.
- **Note de l'humain** (correction V2 ou reprise) : ajoutée à `{{IDEE}}` sous l'intitulé « CORRECTION DEMANDÉE PAR L'HUMAIN », suivie du script précédent s'il existe. Pas dans `{{APPRENTISSAGES}}`, que le prompt présente comme les enseignements de l'analyste.
- **`{{DUREE_S}}`** vaut le milieu exact de `duree_cible_s` : 77.5 avec le modèle de bible ([65, 90]). Avec 2,6 mots/s, la cible est de 192 à 211 mots.
- **`{{DERNIERS_SCRIPTS}}`** : un résumé par script publié (titre, ouverture et son type, ordre des rôles, dernière phrase), pas le JSON complet, pour limiter les tokens.
- **Données de démo** : les scripts de `lib/demo/demoData.ts` ont des textes écran de 2 mots (« Pourquoi jaune ? ») et un nombre de mots qui ne correspond pas à leur durée. Ils restent lisibles par le schéma ; seuls les nouveaux scripts de l'agent sont contrôlés. En V2, leurs compteurs affichent donc « hors tolérance ».
