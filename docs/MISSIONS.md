# Missions et données

Tout ce qui change d'une semaine à l'autre vit dans `public/data/`. Le moteur ne fait qu'interpréter ces fichiers avec une liste fermée de mécaniques. Aucun code n'est jamais exécuté depuis une donnée : une propriété ou une mécanique inconnue fait rejeter le fichier entier.

| Fichier | Rôle |
| --- | --- |
| `missions/story.json` | Les missions de l'histoire |
| `missions/weekly.json` | La mission d'actualité en cours |
| `missions/archive/index.json` et `archive/AAAA-Wnn.json` | Les anciens numéros, rejouables au kiosque |
| `world/weekly-changes.json` | Les changements temporaires de la ville |
| `world/events.json` | Fréquence et récompense des événements de rue |

Après toute modification : `npm run validate:data`. Les schémas JSON de `schemas/` permettent aussi la validation dans un éditeur.

## Écrire une mission

```json
{
  "schema": 1,
  "id": "story-04-exemple",
  "kind": "story",
  "title": "Titre court",
  "summary": "Une ou deux phrases pour les menus.",
  "giver": { "name": "Prénom", "profile": "shopkeeper", "at": { "poi": "marche" } },
  "requires": { "missions": ["story-03-neon"] },
  "intro": [
    { "who": "giver", "text": "Réplique du donneur de mission." },
    { "who": "player", "text": "Réplique du joueur." }
  ],
  "steps": [
    { "type": "get_vehicle", "objective": "Trouve un véhicule" },
    { "type": "goto", "objective": "Rejoins la plage", "target": { "poi": "plage" }, "radius": 4 }
  ],
  "punchline": { "title": "La chute", "text": "Affichée en grand à la réussite." },
  "outro": [{ "who": "giver", "text": "Le mot de la fin." }],
  "reward": { "money": 600, "xp": 140 }
}
```

`kind` vaut `story`, `weekly` ou `side`. Les missions d'histoire s'enchaînent grâce à `requires`. Une mission `weekly` porte en plus un bloc `news` (titre réel, source, lien https, date, catégorie).

### Lieux

Un lieu est soit un point d'intérêt nommé, avec un décalage facultatif en tuiles : `{ "poi": "hotel", "dx": 2 }`, soit des coordonnées en tuiles : `{ "x": 150, "y": 102 }`. La validation refuse un lieu inconnu ou inaccessible à pied.

Points d'intérêt disponibles : `kiosk`, `mairie`, `gare`, `police`, `parc`, `clothes`, `m2_giver` (Radio Bouchon), `dealer`, `banque`, `hotel`, `tour`, `wazou`, `marche`, `musee`, `m1_shop` (Chez Gégé), `m3_bar` (Le Flamant Rose), `garage_old`, `garage_ind`, `usine`, `depot`, `port`, `m3_warehouse`, `m3_item`, `m3_observe`, `m1_dest`, `villa`, `plage`, `jetee`, `quai_nord`, `quai_sud`, `belvedere`, `spawn`, et les carrefours `x_centre`, `x_nord`, `x_est`, `x_ouest`, `x_sud`, `x_indus`.

### Les treize mécaniques (étapes)

Toutes acceptent `objective` (obligatoire), `timeLimit` en secondes, `failIf` (`detected`, `wanted`), `onStart`, `onComplete`, `events` (actions déclenchées après `at` secondes) et `checkpoint` (point de reprise).

| `type` | Paramètres | Réussie quand |
| --- | --- | --- |
| `talk` | `npc`, `lines` | le joueur parle au personnage. `"who": "npc"` désigne ce personnage. |
| `goto` | `target`, `radius`, `mode` | le joueur atteint le lieu |
| `pickup` | `target`, `item` | le joueur ramasse l'objet (interaction, à pied) |
| `get_vehicle` | `vehicle` (facultatif) | le joueur est au volant |
| `deliver` | `target`, `radius`, `mode`, `item`, `fragile: { max }` | le joueur s'arrête au lieu. `fragile` compte les chocs. |
| `tail` | `vehicle`, `color`, `route`, `speed`, `min`, `max`, `objectiveFollow` | la cible arrive au bout de son trajet, joueur à bonne distance |
| `observe` | `target`, `radius`, `seconds`, `mode`, `label` (nom de la jauge) | le joueur reste sur place le temps demandé |
| `leave` | `target`, `radius` | le joueur s'est éloigné |
| `lose_wanted` | aucun | le niveau de recherche est retombé à zéro |
| `collect` | `targets`, `item`, `radius`, `mode` | tous les objets sont ramassés, dans n'importe quel ordre |
| `checkpoints` | `targets`, `radius`, `mode` | tous les points sont franchis dans l'ordre |
| `passengers` | `fares: [{ name, from, to, line, profile }]` | tous les passagers sont déposés |
| `wait` | `seconds` | le temps est écoulé |

`mode` vaut `any`, `foot` ou `vehicle`.

### Les treize actions

Utilisables dans `setup`, `onStart`, `onComplete` et `events` : `toast`, `say` (message d'un personnage), `dialog`, `reveal` (carton de révélation), `spawn_npc`, `spawn_vehicle`, `spawn_guards` (rondes définies par la carte), `despawn`, `wanted`, `sfx`, `world` (effet temporaire : `traffic`, `pedestrians`, `lights_blink`, `robots`), `zombies` et `cure_zombies`.

### Les zombies

- `{ "do": "zombies", "at": lieu, "count": 1 à 10, "spread": 1 à 12, "aggro": 3 à 40 }` fait apparaître des zombies autour d'un lieu (`spread` : dispersion en tuiles, 5 par défaut). Ils déambulent, puis poursuivent le joueur à moins de `aggro` tuiles (9 par défaut). Au plus 30 zombies à la fois.
- Ils mordent le joueur à pied. En voiture, il ne risque rien : un zombie renversé tombe puis se relève, sans attirer la police.
- Un coup de klaxon (130 px) ou un cri à pied (72 px, touche d'action) les fait reculer deux à trois secondes.
- `"bites": 1 à 9`, au niveau de la mission, fixe le nombre de morsures tolérées (3 par défaut). Au-delà, la mission échoue. La jauge « Morsures » s'affiche tant que des zombies sont présents.
- `{ "do": "cure_zombies" }` les rend tous à leur vie d'habitants ordinaires.

Exemple complet : la mission `story-04-zombies` de `story.json`.

### Ce que la validation refuse

- Une mécanique, une action ou une propriété inconnue.
- Un lieu inexistant ou inaccessible.
- Un texte trop long ou contenant `<` ou `>`.
- Une récompense supérieure à 5 000 unités ou 1 000 XP.
- Un chronomètre trop court pour la distance à parcourir.
- Plus de 12 étapes, plus de 8 actions par liste.

Une mission refusée est ignorée et consignée dans Pause → Options → Journal de validation. Le jeu continue avec les autres.

## Changements hebdomadaires de la ville

`world/weekly-changes.json` contient une liste de changements, chacun avec `id`, `type`, `label`, `start` et `end`. Hors de sa période, un changement est sans effet.

| `type` | Paramètres | Effet |
| --- | --- | --- |
| `lighting` | `factor` 0,2 à 1,5, `district` facultatif | intensité des lampadaires et des enseignes |
| `prices` | `factor` 0,5 à 3 | prix des boutiques et des garages |
| `traffic` | `factor` 0,2 à 2 | densité de la circulation |
| `pedestrians` | `factor` 0,2 à 2 | densité des piétons |
| `robots` | `share` 0 à 0,6 | part de robots parmi les passants |
| `decor` | `kind` : `garlands`, `banners`, `flags` ; `district` facultatif | décorations au-dessus des rues |
| `chatter` | `lines` | répliques supplémentaires des habitants |
| `billboard` | `text`, 14 caractères, majuscules sans accents | texte des panneaux sur les toits |
| `lights_mode` | `mode` : `blink` ou `normal` | feux de circulation clignotants |

Quartiers : `hills`, `business`, `downtown`, `oldtown`, `industrial`.

## Événements de rue

`world/events.json` règle les huit événements : `breakdown`, `lift`, `courier`, `mystery_car`, `race`, `roadworks`, `lost_item`, `taxi_shift`. Pour chacun : `weight` (fréquence relative), `districts` (multiplicateur par quartier), `minLevel`, `reward`, `xp`, `enabled`. `cooldown` fixe l'intervalle en secondes entre deux événements.

## Le générateur hebdomadaire

`npm run weekly` exécute `tools/weekly/generate.ts` :

1. lit les flux de `tools/weekly/feeds.json` et garde les titres des huit derniers jours ;
2. écarte les sujets tragiques (liste dans `templates.ts`) et classe les autres en neuf catégories ;
3. préfère un fait repris par plusieurs sources, et une catégorie différente des trois dernières semaines ;
4. construit la mission et les changements de la ville à partir du modèle de la catégorie ;
5. si une clé d'API est présente, fait réécrire les textes par une IA ;
6. valide tout ; en cas d'échec, n'écrit rien ;
7. écrit `weekly.json`, l'archive, l'index et `weekly-changes.json`, plus un journal dans `tools/weekly/logs/`.

Options : `--date 2026-10-11`, `--dry` (n'écrit rien), `--fixture dossier` (flux locaux), `--no-llm`, et `--manual "titre|source|https://lien|2026-10-08|catégorie"` pour choisir le sujet à la main.

Règles éditoriales appliquées par les modèles : le fait cité est réel et lié à sa source ; les personnages et organisations de la mission sont fictifs ; pas d'accusation contre une personne réelle ; pas de tragédie tournée en divertissement.

Pour ajouter une catégorie : une entrée dans `KEYWORDS` et un `case` dans `buildWeekly` (`tools/weekly/templates.ts`). Le test `tests/weekly.test.ts` vérifie automatiquement que chaque catégorie produit une mission valide.
