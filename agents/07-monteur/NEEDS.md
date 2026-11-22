# Besoins de l'agent 7 hors de son dossier

Pour la session principale. Rien ici n'a été modifié par le fork.

## 1. Rendu Remotion (étape 6 de la feuille de route)

- **Quoi** :
  - Installer Remotion (dépendance lourde : à noter dans `docs/decisions.md`, avec le choix Remotion Lambda ou machine dédiée, CLAUDE.md §8 bis).
  - Une composition `Montage` 1080×1920, 30 i/s, dont les `inputProps` sont **exactement** `Video.timelineJson` (schéma `agents/07-monteur/schema.ts`), durée = `duree_totale_s × 30` images. Conventions déjà imposées en code :
    - temps calés sur l'image (multiples de 1/30 s, arrondis au millième) ;
    - piste vidéo continue de 0 à `duree_totale_s`, sans trou ni chevauchement ; `src: ""` + `manquant: false` = plan de **texte animé** que la composition dessine elle-même (texte écran du storyboard / piste `texte`) ;
    - `manquant: true` n'arrive jamais au rendu (la vidéo est bloquée au montage, voir § 3) — la composition peut quand même afficher un aplat neutre par sécurité ;
    - `sous_titres` : **une entrée par mot** ; `mots` = groupe affiché (1 à 4 mots, constant sur les entrées du groupe), `mot_actif` = mot à mettre en évidence ; 2 lignes de 18 caractères au plus (`MAX_LINE_CHARS` dans `subtitles.ts`, à ajuster à la police réelle), dans la zone sûre (rien dans les 20 % du bas) ;
    - `audio` : une `voix` à 0 s et 0 dB, au plus une `musique` à 0 s avec `volume_db` = `mixage.musique_sous_voix_db` et `ducking` du plan sonore ; la composition fait la baisse de la musique pendant la parole ;
    - `texte` : entrée et sortie animées de 0,3 s au plus (prompt) ; `position` ∈ `haut` / `centre` / autre (= bas de la zone sûre).
  - Un `RenderProvider` réel dans `lib/providers/render.ts` (+ fabrique `getRenderProvider(): RenderProvider | null`).
  - La tâche `RENDER` de `jobs/handlers.ts` : lire `timelineJson`, **refuser** une timeline avec un plan `manquant` ou une musique sans `Asset` licencié (CLAUDE.md §8), appeler `render({ compositionId: "Montage", inputProps: timeline })`, enregistrer un `Asset` `RENDER` (`url`, `provider`, `durationS`), ajouter le coût à `Video.totalCost`, puis `completeStage(..., "RENDER_DONE")` → `QA`. Clé d'idempotence par vidéo + tentative (un rendu réussi n'est jamais relancé).
  - Puis remplacer dans `agents/07-monteur/render.ts` : le corps de `renderAvailability()` (activé quand un fournisseur existe) et la dernière ligne de `requestRender()` par la (re)mise en file de la tâche `RENDER` (ex. une fonction `requestRender(deps, videoId)` dans `lib/pipeline/service.ts`, refusée hors de l'étape `RENDER`).
- **Pourquoi** : rien de tout cela n'existe ; le fork n'a le droit ni d'ajouter Remotion ni de toucher `jobs/` ou `lib/`. En attendant, la vidéo passe bien en `RENDER` après le montage et la tâche `RENDER` attend (« Rendu Remotion pas encore branché »).

## 2. Remotion Player dans le panneau

- **Quoi** : une fois Remotion installé, remplacer la prévisualisation statique (`Preview` dans `ui/TimelineBrowser.tsx`, qui montre l'image à l'instant choisi avec le curseur) par `<Player component={Montage} inputProps={timeline} compositionWidth={1080} compositionHeight={1920} fps={30} durationInFrames=… />`. Je peux le faire dans un nouveau passage du fork si tu préfères.
- **Pourquoi** : AGENT.md demande un lecteur Remotion ; Remotion n'est pas installé.

## 3. Voix, horodatage et médias absents : décisions prises

- **Voix ou horodatage mot à mot absents → précondition (aucun appel au modèle).** `buildVariables` lève `AgentPreconditionError` avec un message clair (« Voix absente… », « Horodatage mot à mot absent… ») ; le worker garde la tâche, réessaie toutes les heures et alerte une fois. Sans eux, les sous-titres ne peuvent pas être recalés et la timeline serait inutilisable : un appel payant pour rien. Le panneau liste ces vidéos sous « Montages en attente » avec ce qui manque.
- **Durée mesurée absente → déduite de la fin du dernier mot**, avec l'alerte « Durée de la voix non mesurée ».
- **Fichier visuel d'un plan absent → texte explicite au modèle** (`{{MEDIAS}}` : « MANQUANT … "src": "", "manquant": true »), `src`/`manquant` imposés en code depuis les `Asset` (le modèle n'écrit jamais une URL retenue), alerte dans la timeline. Puis `onSuccess` enregistre la timeline et **bloque** la vidéo au montage (`blockVideo`, raison « Média manquant pour P02… ») au lieu de `EDIT_DONE` : un rendu troué ne sert à rien. « Relancer l'étape » refait le montage une fois les fichiers ajoutés. Aujourd'hui, tout plan `stock`, `image_ia_animee` ou `video_ia` est dans ce cas (aucun générateur ni banque branché, cf. `agents/05-directeur-artistique/NEEDS.md` § 1 et § 4) ; seuls les plans `texte_anime` passent.
- **Musique** : utilisée seulement avec une licence non vide ; sinon montage sans musique et alerte. **Effets sonores** : aucun fichier d'effet n'existe (pas de type d'`Asset` pour eux), ils ne sont pas placés et une alerte les compte.
- **À faire côté session principale (facultatif)** : un moyen pour l'humain d'ajouter le fichier d'un plan (upload → `Asset` IMAGE/VIDEO avec `planId` et licence) ; et un type d'`Asset` `SFX` (ou une banque) si tu veux les effets.

## 4. Dépendance au format du livrable de l'agent 6 (en cours dans son fork)

- **Quoi** : le monteur lit la voix, sa durée, l'horodatage et la musique dans **une seule fonction**, `readAudioDeliverable()` de `agents/07-monteur/sources.ts`. Elle attend, dans `Video.audioJson`, à côté de la sortie du modèle (`agents/06-voix-son/schema.ts` de `main`), un bloc :
  ```json
  "production": {
    "voix": { "url": "…", "duree_s": 31.4, "mots": [{ "word": "Ton", "startS": 0, "endS": 0.31 }] },
    "musique": { "url": "…", "licence": "…" }
  }
  ```
  C'est le format en cours dans le fork de l'agent 6 (`audioPlan.ts`). À défaut, elle prend le dernier `Asset` VOICE (`url`, `durationS`) et MUSIC (`url`, `license`), **sans horodatage** (aucune colonne ne le stocke).
- **Pourquoi** : sur `main`, l'agent 6 n'écrit encore ni voix ni horodatage. Si son format final diffère, seule cette fonction change (et `makeAudioJson` dans `fixtures.ts`). Si l'horodatage est stocké ailleurs (colonne ou `Asset`), dis-le-moi.

## 5. Ce qui lit la timeline ailleurs

- `schema.ts` est **inchangé**. `Video.timelineJson` contient la sortie normalisée : l'agent 8 (`agents/08-controle-qualite/variables.ts`) la parse avec ce schéma et lit `duree_totale_s` ; il n'y a rien à adapter. À noter pour lui : `sous_titres` a une entrée par mot (voir § 1), et `alertes` contient les alertes ajoutées en code.

## 6. Plafond mensuel et budget par vidéo

- **Pourquoi c'est ici** : le monteur ne fait qu'un appel LLM (pas de génération payante) ; le contrôle du budget avant le rendu (coût Remotion Lambda) devra se faire dans la tâche `RENDER` (CLAUDE.md §5.7).
