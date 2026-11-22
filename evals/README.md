# Jeu de test des prompts

`ideas.json` contient 10 idées de référence. La commande `npm run eval -- --agent 4` fait trois choses :
1. elle repasse ces idées dans l'agent avec la version de prompt en cours d'édition ;
2. elle valide chaque sortie (schéma + contrôles en code) ;
3. elle affiche, à côté de la sortie de la version en production : le taux de validité, la durée et le nombre de mots (pour le scénariste), et le coût.

Remplace les idées d'exemple par de vraies idées de ta niche dès qu'elle est choisie.
