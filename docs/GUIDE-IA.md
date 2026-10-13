# Développer les prochaines versions avec une IA

Ce projet a été écrit par une IA et il est organisé pour qu'une IA puisse le poursuivre. Ce guide décrit la méthode qui fonctionne.

## L'outil adapté

Utilisez un assistant qui a accès au dossier du projet et à un terminal (Claude Code, par exemple). Il doit pouvoir lire les fichiers, les modifier, lancer les tests et lire leur résultat. Une simple conversation qui renvoie des morceaux de code ne suffit pas pour un projet de cette taille.

## La boucle de travail

Demandez toujours la même séquence, et refusez un résultat qui en saute une étape :

1. lire les fichiers concernés avant de modifier quoi que ce soit ;
2. faire la modification ;
3. `npm run typecheck` ;
4. `npm test` ;
5. `npm run build` puis `npm run test:e2e` ;
6. corriger et recommencer jusqu'à ce que tout passe ;
7. dire ce qui a été testé et ce qui ne l'a pas été.

Du code qui compile ne prouve pas qu'il est jouable. Les tests de `tests/` font réellement tourner la ville ; ceux de `e2e/` pilotent le vrai jeu dans un navigateur et enregistrent des captures dans `e2e/captures/`. Demandez à l'IA de regarder ces captures quand elle touche à l'affichage.

## Où intervenir

| Pour… | Regarder |
| --- | --- |
| ajouter une mission d'histoire | `public/data/missions/story.json`, format dans `docs/MISSIONS.md`. Aucun code à écrire. |
| ajouter une catégorie d'actualité | `tools/weekly/templates.ts` |
| ajouter une mécanique de mission | `src/missions/schema.ts`, `validate.ts`, `MissionRunner.ts`, puis `tools/make-schemas.ts` |
| ajouter un véhicule | `src/vehicles/specs.ts` et le dessin dans `src/assets/textures.ts` |
| changer l'apparence de la ville | `src/map/painter.ts` |
| changer le plan de la ville | `src/map/generator.ts` |
| régler la circulation | `src/traffic/TrafficSystem.ts` |
| régler la police | `src/police/PoliceSystem.ts` et `WantedSystem.ts` |
| modifier l'interface | `src/ui/` et `src/ui/styles.css` |
| ajouter un son | `src/audio/AudioSystem.ts` |

## Les règles à rappeler à l'IA

Copiez-les au début de vos demandes.

- La simulation (`src/world`, `map`, `vehicles`, `traffic`, `npc`, `police`, `missions`, `economy`) ne doit jamais importer Phaser ni toucher au DOM. C'est ce qui la rend testable.
- Toute nouvelle règle de jeu arrive avec son test dans `tests/`.
- Les données ne contiennent jamais de code. Une nouvelle possibilité passe par une mécanique ou une action ajoutée au moteur et à la validation.
- Pas de fichier image ni audio : tout est dessiné ou synthétisé par le code.
- Pas de serveur, pas d'appel réseau pendant une partie.
- La ville est déterministe (graine fixe dans `src/engine/config.ts`). Modifier le générateur déplace des lieux : relancer `npm run validate:data` et les tests, qui signalent toute mission devenue infaisable.
- Changer le format de sauvegarde demande d'augmenter `SAVE_VERSION` et de gérer les anciennes sauvegardes dans `World.restore`.

## Outils de mise au point

Dans la console du navigateur, `__klaxo.debug` donne :

```js
__klaxo.debug.state()          // position, mission, argent, niveau de recherche…
__klaxo.debug.tp('hotel')      // téléporte le joueur vers un lieu
__klaxo.debug.car('sport')     // fait apparaître un véhicule
__klaxo.debug.wanted(3)        // fixe le niveau de recherche
__klaxo.debug.money(5000)
__klaxo.debug.event('race')    // déclenche un événement de rue
```

En ligne de commande :

```bash
npx tsx tools/dump-map.ts carte.png                 # plan de la ville
npx tsx tools/debug-sim.ts x_centre 90 radar.png    # état de la circulation après 90 s simulées
node e2e/shot.mjs /tmp menu,spawn,hotel:0:30        # captures du jeu à différents endroits
```

## Exemples de demandes qui marchent

Une bonne demande nomme le résultat attendu, la façon de le vérifier et les limites.

> Ajoute une quatrième mission d'histoire dans `story.json`, débloquée après « Opération néon ». Elle doit utiliser l'étape `passengers` et l'étape `lose_wanted`. Ajoute un test dans `tests/gameplay.test.ts` qui la termine. Lance `npm run validate:data`, `npm test`, puis dis-moi ce qui passe.

> Les piétons traversent trop souvent au rouge. Mesure d'abord le phénomène dans un test, corrige `PedSystem.ts`, et montre le chiffre avant et après.

> Ajoute un véhicule « scooter » : entrée dans `specs.ts`, dessin dans `textures.ts`, présence dans la circulation d'Old Town. Fais une capture avec `e2e/shot.mjs` et vérifie qu'il est lisible à l'écran.

À éviter : « améliore le jeu », « rends-le plus beau ». Sans critère vérifiable, l'IA produit des changements qu'on ne peut pas juger.

## Prochaines étapes suggérées

1. Tester sur un vrai iPhone et un vrai téléphone Android, puis corriger ce qui en ressort.
2. Faire jouer quelques personnes et ajuster vitesses, chronomètres et sévérité de la police.
3. Lancer une première fois le générateur hebdomadaire avec le réseau et corriger la liste des flux.
4. Agrandir la ville : les dimensions sont dans `src/engine/config.ts`, les artères dans `generator.ts`.
5. Ajouter des missions d'histoire et des activités (courses de taxi libres, livraisons répétables).
6. Sauvegarde dans le cloud : écrire une implémentation de l'interface `KV` de `src/save/SaveSystem.ts`.
