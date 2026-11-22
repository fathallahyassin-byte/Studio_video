# Travailler avec un fork par agent

## Qui fait quoi

**Session principale (avant les forks)** : étapes 1 à 3 de la feuille de route, plus :
- `agents/_shared/` (types, contrat), `lib/agents/runAgent.ts`, `agents/registry.ts` avec les 11 entrées provisoires ;
- la page générique `app/(dashboard)/agents/[slug]/page.tsx` : en-tête, modèle, éditeur de prompt, historique des AgentRun, puis `<Panel />` de l'agent ;
- les interfaces de `lib/providers/` (même vides) et la machine à états.

**Un fork par agent (ensuite)** : il ne modifie **que** `agents/NN-slug/**`.

## Lancer un fork

1. Crée une branche et un worktree :
   ```bash
   git worktree add ../studio-04 -b agent/04-scenariste
   ```
2. Ouvre Claude Code dans `../studio-04` et donne-lui ce message :
   > Tu travailles uniquement sur `agents/04-scenariste/`. Lis `CLAUDE.md`, `docs/FORKS.md`, `agents/_shared/README.md` et `agents/04-scenariste/AGENT.md`, puis implémente l'agent jusqu'à ce que tous ses critères d'acceptation soient cochés. Si tu as besoin de modifier quelque chose hors de ce dossier, écris-le dans `NEEDS.md` au lieu de le faire.
3. Quand les tests passent : merge dans `main`, puis supprime le worktree.

## Règles

- Un fork ne touche jamais `prisma/schema.prisma`, `lib/`, `app/` hors de son panneau, ni `agents/_shared/`, ni le dossier d'un autre agent.
- Un besoin partagé (champ en base, méthode de provider, composant UI) va dans `NEEDS.md`. La session principale l'intègre, puis le fork fait un rebase sur `main`.
- `prompt.md` ne change pas sans mon accord.

## Ordre conseillé

1. **Agents texte** : 2 (veilleur), 3 (recherchiste), 4 (scénariste), 8 (contrôle qualité). C'est la boucle idée → script → GO, testable sans médias.
2. **Agents médias** : 5 et 6 en parallèle, puis 7 (monteur). Il faut d'abord les providers TTS, image et vidéo et le rendu Remotion (session principale).
3. 9 (publication), puis 10 (analyste).
4. 1 (stratège de niche), quand la boucle tourne.
5. 0 (orchestrateur), seulement si besoin.

Deux à trois forks en même temps maximum : au-delà, les `NEEDS.md` s'accumulent plus vite que la session principale ne les traite.
