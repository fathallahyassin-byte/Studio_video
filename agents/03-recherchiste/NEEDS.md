# Besoins de l'agent 3 hors de son dossier

## 1. Saisir les sources de l'humain pour `{{SOURCES}}` : FAIT (session principale)

- **Intégré** : champ `Video.researchSources` (migration `20261122170000_research_sources`), saisie dans « À valider » pour une vidéo bloquée en recherche (une URL http(s) par ligne, enregistrées avant « Relancer l'étape »), et `loadHumanSources` dans `ports.ts` lit ce champ.

### Demande d'origine

- **Quoi** : un champ pour stocker les liens que j'ajoute à une vidéo, par exemple `Video.researchSources String[] @default([])` (ou un modèle `VideoSource { id, videoId, url, note, createdAt }`), et un petit formulaire pour les ajouter : sur la carte de la vidéo en Production, ou dans le détail d'une vidéo bloquée dans Validations. Chaque URL est validée par Zod (http ou https uniquement).
- **Pourquoi** : `AGENT.md` prévoit « liens que j'ajoute sur la page de la vidéo », mais aucun champ n'existe. Pour l'instant `{{SOURCES}}` vaut toujours « aucune source fournie » (`ports.ts`, `loadHumanSources` renvoie `[]`).
- **Conséquence à connaître** : sans source et sans outil de recherche, le prompt interdit d'inventer une URL. Le modèle écrira donc souvent « source à trouver », et le code force alors la confiance « faible ». Si aucun fait n'est « eleve » ou « moyen », la vidéo est bloquée (« aucun fait assez fiable ») et le scénariste n'est pas lancé. Le parcours normal sera donc : vidéo bloquée → j'ajoute des liens → « Relancer l'étape ».
- **Côté fork, une fois le champ en place** : remplacer le corps de `loadHumanSources` dans `agents/03-recherchiste/ports.ts` (une ligne). `formatSourcesVariable` et ses tests sont déjà prêts.

## 2. Outil de recherche web pour le recherchiste (à décider)

- **Quoi** : permettre à `LlmProvider` d'activer, agent par agent, l'outil de recherche web côté serveur de Claude (réglage dans `Agent.settings`, par exemple `{ "webSearch": true }`).
- **Pourquoi** : le prompt parle de « sources fournies par l'humain ou un outil de recherche ». Avec un outil de recherche, le recherchiste peut citer de vraies URL au lieu de « source à trouver », et beaucoup moins de vidéos seront bloquées.
- **À noter** : c'est un coût en plus par appel. D'après CLAUDE.md §13, il faut l'inscrire dans `docs/decisions.md` et avoir l'accord du propriétaire avant de l'activer.

## 3. Suggestion : afficher le dossier là où l'humain décide

- **Quoi** : dans le détail d'une vidéo bloquée par le recherchiste (Validations, `NEEDS_FIX` avec `blockedAt = RESEARCH`), ajouter un lien vers `/agents/03-recherchiste`. En V2, afficher en option les faits du dossier à côté des beats du script.
- **Pourquoi** : l'humain voit l'angle de remplacement dans la raison du blocage, mais pas les faits ni les sources. Pour lire `Video.dossierJson` ailleurs, on peut ajouter `parseDossier` dans `lib/dashboard/payloads.ts` (schéma : `agents/03-recherchiste/schema.ts`).
