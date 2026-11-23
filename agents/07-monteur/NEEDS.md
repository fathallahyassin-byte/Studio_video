# Besoins de l'agent 7 hors de son dossier

État au 23 novembre 2026 : les points 1, 2, 4 et 6 sont intégrés par la session principale (voir `docs/decisions.md`, « Rendu Remotion sur le worker, stockage S3, besoins du monteur »). Restent ouverts : point 3 (facultatif).

## 1. Rendu Remotion — intégré

- Composition `Montage` dans `remotion/` (1080×1920, 30 i/s, `inputProps` = `Video.timelineJson` tel quel).
- Rendu sur le worker : `lib/render/localRenderer.ts` (H.264 + AAC 48 kHz), MP4 envoyé au stockage S3 (`lib/providers/s3.ts`).
- Tâche `RENDER` (`jobs/render.ts`) : refus si un plan est `manquant` ou si la musique n'a pas d'`Asset` MUSIC licencié, `Asset` RENDER idempotent (`Asset.generationKey`), puis `RENDER_DONE` → contrôle qualité.
- « Lancer le rendu » : `renderAvailability()` est actif dès que S3 est configuré ; `requestRender()` remet la tâche en file via `requestRender` de `lib/pipeline/service.ts`.
- Conventions de la timeline lues par la composition (imposées en code par ce dossier) :
  - temps calés sur l'image (multiples de 1/30 s, arrondis au millième) ;
  - piste vidéo continue de 0 à `duree_totale_s` ; `src: ""` + `manquant: false` = plan de texte animé dessiné par la composition ;
  - `sous_titres` : une entrée par mot ; `mots` = groupe affiché (1 à 4 mots, 2 lignes de 18 caractères au plus : `MAX_LINE_CHARS` dans `subtitles.ts`, à ajuster si la police change), `mot_actif` = mot mis en évidence ;
  - `audio` : une `voix` à 0 s et 0 dB, au plus une `musique` à 0 s avec `volume_db` et `ducking` du plan sonore.

## 2. Remotion Player dans le panneau — intégré

- `ui/TimelineBrowser.tsx` affiche le Player (même composition que le rendu) ; cliquer un bloc de la frise y déplace la lecture. Lien vers le dernier MP4 rendu.

## 3. Voix, horodatage et médias absents : décisions prises (rien à faire), et ce qui reste

- **Voix ou horodatage mot à mot absents → précondition (aucun appel au modèle).** Le worker garde la tâche, réessaie toutes les heures et alerte une fois. Le panneau liste ces vidéos sous « Montages en attente ».
- **Fichier visuel d'un plan absent** : `{{MEDIAS}}` dit « MANQUANT » au modèle, `src`/`manquant` sont imposés en code depuis les `Asset`, puis `onSuccess` enregistre la timeline et bloque la vidéo au montage avec la liste des plans. « Relancer l'étape » refait le montage une fois les fichiers ajoutés. Aujourd'hui tout plan `stock`, `image_ia_animee` ou `video_ia` est dans ce cas (aucun générateur ni banque branché : `agents/05-directeur-artistique/NEEDS.md` § 1 et § 4).
- **Musique** : utilisée seulement avec une licence ; sinon montage sans musique et alerte. **Effets sonores** : aucun fichier d'effet n'existe, ils ne sont pas placés et une alerte les compte.
- **Ouvert (facultatif)** : un moyen pour l'humain d'ajouter le fichier d'un plan (upload vers S3 → `Asset` IMAGE/VIDEO avec `planId` et licence), et un type d'`Asset` (ou une banque) pour les effets sonores.

## 4. Livrable de l'agent 6 — intégré

- `readAudioDeliverable()` (`sources.ts`) lit le bloc `production` avec `parseStoredAudioPlan` de `agents/06-voix-son/audioPlan.ts`, et les `Asset` VOICE / MUSIC en secours (sans horodatage).
- Son modifié pendant le montage (« Régénérer la voix », piste choisie) : `restartEdit` (`lib/pipeline/service.ts`) efface la timeline et relance le monteur ; `recordTimeline` n'enregistre pas une timeline dont la voix ou la musique ne sont plus celles de la vidéo.

## 5. Ce qui lit la timeline ailleurs

- `schema.ts` est inchangé. L'agent 8 la parse avec ce schéma et lit `duree_totale_s` ; la composition `Montage` la lit telle quelle.

## 6. Budget — tranché

- Le rendu local ne coûte rien (pas de fournisseur payant) : pas d'estimation avant rendu. À ajouter dans `jobs/render.ts` si le rendu passe un jour sur Remotion Lambda (CLAUDE.md §5.7).
