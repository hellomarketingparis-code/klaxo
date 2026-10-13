# KLAXO

**Jouer : https://hellomarketingparis-code.github.io/klaxo/**

Jeu d'action et d'exploration en ville, en pixel art vu du dessus, pour navigateur. Gratuit, en solo ou en ligne avec les autres joueurs (sans aucune discussion), jouable hors ligne après le premier chargement. Chaque semaine, une nouvelle mission satirique inspirée d'un fait d'actualité réel apparaît au kiosque de la ville.

Tout est généré par le code : la ville, les bâtiments, les voitures, les personnages, les sons et la musique. Le dépôt ne contient aucune image ni aucun fichier audio, à part les icônes de l'application, elles-mêmes dessinées par un script.

> Le nom « KLAXO » est une proposition. Sa disponibilité (marque, nom de domaine) n'a pas été vérifiée.

## Lancer le jeu

Il faut Node.js 20 ou plus récent.

```bash
npm install
npm run dev        # serveur de développement : http://localhost:5173
```

Pour la version de production :

```bash
npm run build      # vérifie les types, compile dans dist/ et génère le service worker
npm run preview    # sert dist/ sur http://localhost:4173
```

## Commandes utiles

| Commande | Effet |
| --- | --- |
| `npm test` | 81 tests automatisés de la simulation (ville, circulation, police, missions, sauvegarde, données) |
| `npm run test:e2e` | 34 vérifications dans un vrai navigateur (Chromium), clavier et tactile. Lancer `npm run build` avant. |
| `npm run validate:data` | Valide tous les fichiers de `public/data` |
| `npm run weekly` | Génère la mission de la semaine à partir des flux d'actualité |
| `npm run build:single` | Produit `single/klaxo.html` : tout le jeu dans un seul fichier, sans mode hors ligne |
| `npm run icons` | Redessine les icônes de l'application |
| `npm run schemas` | Régénère les schémas JSON de `schemas/` |
| `npx tsx tools/dump-map.ts carte.png` | Exporte la carte de la ville en image |

## Ce que contient cette version

Jouable dès maintenant :

- Une ville de 320 × 240 tuiles en cinq quartiers (Downtown, Old Town, Business District, Industrial Zone, Residential Hills) : 124 carrefours, 200 tronçons de rue, 65 carrefours à feux, 442 bâtiments, parkings, parcs, port, plage, 12 lieux secrets.
- Un personnage personnalisable (teint, coiffure, vêtements, accessoire, pseudonyme), à pied ou en voiture.
- Sept véhicules au comportement distinct : citadine, berline, sportive, taxi, fourgon, camion, voiture de police.
- Une circulation autonome qui suit les voies, s'arrête aux feux, cède le passage, contourne les obstacles et klaxonne.
- Des habitants avec des routines : ils marchent, attendent au passage piéton, discutent, regardent les accidents, fuient le danger. Sept profils.
- Une police à cinq niveaux de recherche : témoins, patrouilles, poursuite en voiture et à pied, interception, barrages, arrestation et amende. On la sème en restant hors de vue ou en repeignant sa voiture.
- Trois missions d'histoire aux mécaniques différentes : livraison fragile chronométrée, filature, infiltration.
- Huit types d'événements de rue aléatoires, jamais déclenchés pendant une mission.
- Une économie : argent virtuel, niveaux, concessionnaire, garages, boutique de vêtements, 14 succès, statistiques.
- Une mission d'actualité hebdomadaire et des changements dans la ville (robots dans les rues, prix, éclairage, décorations, répliques).
- Sauvegarde automatique locale (IndexedDB), export et import de fichier.
- Commandes clavier, tactiles et manette. Interface adaptée au téléphone en paysage.
- Fonctionnement hors ligne (PWA) et installation sur l'écran d'accueil.
- Jeu en ligne, pair-à-pair et gratuit : on croise les autres joueurs dans la ville (à pied ou en voiture), on entend leur klaxon et on fait les missions ensemble (invitation, objets ramassés et étapes partagés, récompense pour chacun). Villes publiques de 8 joueurs, en nombre illimité, et groupes privés par code. Aucune discussion : les noms sont attribués au hasard et aucun texte saisi par un joueur ne circule. Voir [docs/EN-LIGNE.md](docs/EN-LIGNE.md).
- Un avertissement « jeu de fiction » à l'accueil, avant la première partie et sur chaque mission d'actualité.

Prévu, pas encore fait :

- Compte utilisateur, sauvegarde dans le cloud, classement mondial, poursuites de police partagées entre joueurs. L'architecture les permet (voir `src/save/SaveSystem.ts`, interface `KV`), rien n'est implémenté.
- Intérieurs de bâtiments, activités supplémentaires, davantage de missions d'histoire.
- Traduction : l'interface et les missions sont en français.

## Ce qui a été testé, et ce qui ne l'a pas été

Testé automatiquement dans cet environnement :

- La simulation complète sans affichage : 81 tests, dont 16 pour le jeu en ligne (format des messages, villes pleines, mission complète en équipe sur un réseau simulé), dont un pilote automatique qui conduit réellement de l'épicerie à l'hôtel pour la mission 1, une filature menée de bout en bout, et l'infiltration.
- Le jeu compilé dans Chromium (Playwright) : les 15 critères de validation de la première version, la sauvegarde après rechargement, le fonctionnement hors ligne, les données invalides, un téléphone émulé (écran 844 × 390, tactile multipoint) et deux onglets qui jouent ensemble (se voir, se suivre, mission en équipe, klaxon, départ).

Vérifié en ligne le 13 octobre 2026 : le jeu publié sur GitHub Pages démarre avec sa mission de la semaine et son mode hors ligne ; le robot hebdomadaire a lu les 11 flux d'actualité (240 titres), produit une mission valide, l'a enregistrée dans le dépôt et a republié le jeu.

Non testé, à vérifier sur de vrais appareils :

- **Safari sur iPhone et Chrome sur un vrai téléphone Android.** Seule une émulation tactile dans Chromium a été exécutée.
- **Les performances sur un téléphone modeste.** La seule mesure disponible vient d'un rendu logiciel sans carte graphique (environ 49 images par seconde). Elle ne dit rien d'un appareil précis.
- **Le son.** Le code audio s'exécute sans erreur, mais personne n'a écouté le résultat.
- **La réécriture des textes par une IA** (facultative, nécessite une clé d'API).
- **La manette**, codée mais non testée.
- **Le jeu en ligne entre deux vrais appareils sur internet.** La logique de jeu à plusieurs est testée (réseau simulé et deux onglets), mais la mise en relation par les relais publics n'a pas pu être essayée depuis cet environnement, qui bloque ces relais. Voir [docs/EN-LIGNE.md](docs/EN-LIGNE.md) pour le test à faire.
- **Le plaisir de jeu.** Les réglages (vitesses, chronomètres, sévérité de la police) ont été calibrés par simulation, pas par des joueurs.

## Organisation du code

```
src/
  engine/     constantes, hasard déterministe, mathématiques, bus d'événements
  map/        génération de la ville, réseau routier, recherche de chemin, peinture des chunks
  world/      World : la simulation complète, sans dépendance à l'affichage
  player/     joueur à pied
  vehicles/   catalogue et physique des véhicules
  traffic/    circulation autonome
  npc/        habitants : apparences, routines, répliques
  police/     niveau de recherche, unités, barrages
  missions/   format des missions, validation stricte, exécution
  weekly/     modificateurs hebdomadaires du monde, événements de rue
  economy/    argent, niveaux, succès
  save/       IndexedDB, export, import
  assets/     sprites dessinés par le code, police bitmap, palette
  scenes/     GameScene (Phaser 3) : affichage, lumières, caméra
  ui/         interface HTML : accueil, HUD, menus, boutiques, tactile
  audio/      sons et musique synthétisés
  input/      clavier, tactile, manette
  net/        jeu en ligne : format des messages, transports (pair-à-pair, local, mémoire), villes, coopération
public/data/  missions et réglages modifiables sans toucher au code
tools/        générateur hebdomadaire, validation, schémas, icônes, service worker
tests/        tests de la simulation        e2e/  tests dans le navigateur
schemas/      schémas JSON des fichiers de données
docs/         déploiement, format des missions, guide de développement avec une IA
```

Le principe central : `World` simule la ville sans rien afficher, `GameScene` l'affiche, `UI` gère l'interface HTML. Les trois communiquent par un bus d'événements. C'est ce qui permet de tester le jeu sans navigateur.

## Taille et coûts

- Premier chargement : environ 1,7 Mo (430 ko compressés), tout compris.
- Aucun serveur de jeu, aucune base de données, aucune API appelée pendant une partie.
- Hébergement statique : GitHub Pages et Cloudflare Pages ont une offre gratuite, soumise à leurs limites de trafic et de bande passante. Ce n'est pas une gratuité illimitée. Sur GitHub Pages gratuit, le dépôt doit être **public**.
- Génération hebdomadaire : gratuite avec les modèles intégrés (GitHub Actions est gratuit pour un dépôt public). La réécriture par IA est facultative : de l'ordre de un millième de dollar par semaine au tarif affiché en octobre 2026.

Le détail chiffré, avec les sources, est dans [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md#coûts).

## Documentation

- [Mettre le jeu en ligne](docs/DEPLOIEMENT.md)
- [Format des missions et des données](docs/MISSIONS.md)
- [Développer les prochaines versions avec une IA](docs/GUIDE-IA.md)
